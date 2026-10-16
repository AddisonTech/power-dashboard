"""Alarm management aligned with ANSI/ISA-18.2.

Each configured alarm point runs the ISA 18.2 alarm state model:

    A  NORMAL      process normal, nothing to acknowledge
    B  UNACK       process abnormal, alarm not yet acknowledged
    C  ACKED       process abnormal, alarm acknowledged by the operator
    D  RTN_UNACK   process returned to normal before anyone acknowledged it
    F  SHELVED     temporarily removed from service by the operator (time limited)
    G  SUPPRESSED  suppressed by design, based on plant state

Transitions:

    NORMAL    --condition-->    UNACK
    UNACK     --acknowledge-->  ACKED
    UNACK     --clears-->       RTN_UNACK
    ACKED     --clears-->       NORMAL
    RTN_UNACK --acknowledge-->  NORMAL
    RTN_UNACK --condition-->    UNACK      (re-alarm)
    any of A to D --shelve-->   SHELVED    --unshelve or timer--> UNACK or NORMAL
    any of A to D --design rule--> SUPPRESSED --rule clears--> UNACK or NORMAL

Conditions use a deadband (hysteresis) and on/off delays so a noisy value
near the setpoint does not chatter. Every transition is written to the
alarm journal through registered listeners.

This module is pure Python with no I/O so it can be tested in isolation.
"""

import threading
from collections import deque
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, Iterable, List, Optional

from config import ALARM_PRIORITIES, SHELVE_MAX_MIN


class AlarmState(str, Enum):
    NORMAL = "NORMAL"
    UNACK = "UNACK"
    ACKED = "ACKED"
    RTN_UNACK = "RTN_UNACK"
    SHELVED = "SHELVED"
    SUPPRESSED = "SUPPRESSED"


STATE_LABELS = {
    AlarmState.NORMAL: "Normal",
    AlarmState.UNACK: "Unacknowledged",
    AlarmState.ACKED: "Acknowledged",
    AlarmState.RTN_UNACK: "Returned to normal, unacknowledged",
    AlarmState.SHELVED: "Shelved",
    AlarmState.SUPPRESSED: "Suppressed by design",
}

# States shown on the operator's active alarm list
ANNUNCIATED = (AlarmState.UNACK, AlarmState.ACKED, AlarmState.RTN_UNACK)
# States that still need an acknowledgement
NEEDS_ACK = (AlarmState.UNACK, AlarmState.RTN_UNACK)

# Journal event types
EV_ALARM = "ALARM"
EV_ACK = "ACK"
EV_RTN = "RTN"
EV_SHELVE = "SHELVE"
EV_UNSHELVE = "UNSHELVE"
EV_SUPPRESS = "SUPPRESS"
EV_UNSUPPRESS = "UNSUPPRESS"

# ISA 18.2 performance targets for annunciated alarms per operator per 10 minutes
RATE_ACCEPTABLE = 1
RATE_MANAGEABLE = 2
RATE_FLOOD = 10
RATE_WINDOW_S = 600


class AlarmActionError(Exception):
    """An operator action is not valid in the alarm's current state."""


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds")


class AlarmPoint:
    """Runtime state for one configured alarm."""

    def __init__(self, definition: Dict[str, Any], meter_name: str):
        self.d = definition
        self.tag: str = definition["tag"]
        self.meter_name = meter_name
        self.state = AlarmState.NORMAL
        self.condition = False
        self._on_count = 0
        self._off_count = 0
        self.value: Optional[float] = None
        self.alarm_value: Optional[float] = None
        self.activated_at: Optional[float] = None
        self.ack_at: Optional[float] = None
        self.ack_by: Optional[str] = None
        self.rtn_at: Optional[float] = None
        self.shelved_at: Optional[float] = None
        self.shelved_until: Optional[float] = None
        self.shelved_by: Optional[str] = None
        self.shelve_reason: Optional[str] = None
        self.suppress_reason: Optional[str] = None
        self.evaluated = False

    # Condition with deadband and debounce -----------------------------------

    def _raw(self, value) -> bool:
        kind, sp, db = self.d["kind"], self.d["setpoint"], self.d.get("deadband", 0.0)
        if kind == "DISCRETE":
            return bool(value) == bool(sp)
        if kind in ("HI", "HIHI"):
            return value > (sp - db if self.condition else sp)
        if kind in ("LO", "LOLO"):
            return value < (sp + db if self.condition else sp)
        raise ValueError(f"Unknown alarm kind {kind}")

    def in_alarm_now(self) -> bool:
        """Current value against the setpoint, ignoring deadband and delays."""
        if self.value is None:
            return False
        was, self.condition = self.condition, False
        try:
            return self._raw(self.value)
        finally:
            self.condition = was

    def update_condition(self, value) -> bool:
        """Feed a new value. Returns the debounced condition."""
        self.value = value
        raw = self._raw(value)
        if raw:
            self._off_count = 0
            if not self.condition:
                self._on_count += 1
                if self._on_count > self.d.get("on_delay", 0):
                    self.condition = True
                    self._on_count = 0
        else:
            self._on_count = 0
            if self.condition:
                self._off_count += 1
                if self._off_count > self.d.get("off_delay", 0):
                    self.condition = False
                    self._off_count = 0
        return self.condition

    def to_dict(self) -> Dict[str, Any]:
        d = self.d
        pr = d["priority"]
        return {
            "tag": self.tag,
            "meter_id": d["meter_id"],
            "meter_name": self.meter_name,
            "message": d["message"],
            "kind": d["kind"],
            "parameter": d["parameter"],
            "priority": pr,
            "priority_label": ALARM_PRIORITIES[pr]["label"],
            "state": self.state.value,
            "state_label": STATE_LABELS[self.state],
            "condition_active": self.condition,
            "value": _num(self.value),
            "alarm_value": _num(self.alarm_value),
            "setpoint": d["setpoint"],
            "unit": d.get("unit", ""),
            "activated_at": _iso(self.activated_at) if self.activated_at else None,
            "ack_at": _iso(self.ack_at) if self.ack_at else None,
            "ack_by": self.ack_by,
            "rtn_at": _iso(self.rtn_at) if self.rtn_at else None,
            "shelved_at": _iso(self.shelved_at) if self.shelved_at else None,
            "shelved_until": _iso(self.shelved_until) if self.shelved_until else None,
            "shelved_by": self.shelved_by,
            "shelve_reason": self.shelve_reason,
            "suppress_reason": self.suppress_reason,
            "consequence": d.get("consequence"),
            "response": d.get("response"),
        }


def _num(v):
    if isinstance(v, bool):
        return int(v)
    return v


class AlarmManager:
    """Evaluates alarm points against readings and handles operator actions."""

    def __init__(self, definitions: Iterable[Dict[str, Any]], meter_names: Dict[str, str]):
        self.points: Dict[str, AlarmPoint] = {
            d["tag"]: AlarmPoint(d, meter_names.get(d["meter_id"], d["meter_id"]))
            for d in definitions
        }
        self._listeners: List[Callable[[Dict[str, Any]], None]] = []
        self._recent_alarms: deque = deque()
        self._lock = threading.RLock()

    # Listeners --------------------------------------------------------------

    def add_listener(self, fn: Callable[[Dict[str, Any]], None]):
        self._listeners.append(fn)

    def _emit(self, p: AlarmPoint, event: str, now: float, operator: str = "system",
              note: Optional[str] = None):
        if event == EV_ALARM:
            self._recent_alarms.append(now)
        record = {
            "epoch": now,
            "timestamp": _iso(now),
            "tag": p.tag,
            "meter_id": p.d["meter_id"],
            "meter_name": p.meter_name,
            "event": event,
            "state": p.state.value,
            "priority": p.d["priority"],
            "value": _num(p.value),
            "setpoint": p.d["setpoint"],
            "unit": p.d.get("unit", ""),
            "message": p.d["message"],
            "operator": operator,
            "note": note,
        }
        for fn in self._listeners:
            fn(record)

    # Scan evaluation --------------------------------------------------------

    def evaluate(self, readings: Dict[str, Dict[str, Any]], now: float) -> bool:
        """Evaluate every alarm point against one scan. Returns True if anything changed."""
        changed = False
        with self._lock:
            for p in self.points.values():
                before = p.state
                self._evaluate_point(p, readings, now)
                changed = changed or p.state != before
        return changed

    def _evaluate_point(self, p: AlarmPoint, readings, now: float):
        reading = readings.get(p.d["meter_id"])
        value = reading.get(p.d["parameter"]) if reading else None
        if value is None:
            return  # bad or missing data: hold the last state
        condition = p.update_condition(value)

        # Time limited shelving
        if p.state == AlarmState.SHELVED:
            if p.shelved_until is not None and now >= p.shelved_until:
                self._unshelve(p, now, "system", "Shelve time expired")
            return

        # Designed (state based) suppression
        rule = p.d.get("suppress")
        suppressed = False
        if rule:
            src = readings.get(rule["meter_id"])
            if src is not None and src.get(rule["parameter"]) is not None:
                suppressed = bool(src.get(rule["parameter"])) == bool(rule["equals"])
            else:
                suppressed = p.state == AlarmState.SUPPRESSED
        first_scan = not p.evaluated
        p.evaluated = True
        if suppressed and p.state != AlarmState.SUPPRESSED:
            p.state = AlarmState.SUPPRESSED
            p.suppress_reason = rule.get("reason")
            if not first_scan:  # starting up suppressed is not an event
                self._emit(p, EV_SUPPRESS, now, note=p.suppress_reason)
            return
        if p.state == AlarmState.SUPPRESSED:
            if suppressed:
                return
            p.suppress_reason = None
            self._return_to_service(p, now, EV_UNSUPPRESS, "system", "Suppression condition cleared")
            return

        # Core ISA 18.2 state model
        if p.state == AlarmState.NORMAL and condition:
            self._annunciate(p, now)
        elif p.state == AlarmState.RTN_UNACK and condition:
            self._annunciate(p, now)
        elif p.state == AlarmState.UNACK and not condition:
            p.state = AlarmState.RTN_UNACK
            p.rtn_at = now
            self._emit(p, EV_RTN, now)
        elif p.state == AlarmState.ACKED and not condition:
            p.state = AlarmState.NORMAL
            p.rtn_at = now
            self._emit(p, EV_RTN, now)

    def _annunciate(self, p: AlarmPoint, now: float):
        p.state = AlarmState.UNACK
        p.activated_at = now
        p.alarm_value = p.value
        p.ack_at = p.ack_by = p.rtn_at = None
        self._emit(p, EV_ALARM, now)

    def _return_to_service(self, p: AlarmPoint, now: float, event: str, operator: str, note: str):
        # Re-evaluate from the live value so a stale debounced condition from
        # while the alarm was out of service does not annunciate.
        p.condition = p.in_alarm_now()
        p.state = AlarmState.NORMAL
        self._emit(p, event, now, operator, note)
        if p.condition:
            self._annunciate(p, now)

    # Operator actions -------------------------------------------------------

    def _get(self, tag: str) -> AlarmPoint:
        if tag not in self.points:
            raise KeyError(tag)
        return self.points[tag]

    def acknowledge(self, tag: str, now: float, operator: str = "operator") -> Dict[str, Any]:
        with self._lock:
            p = self._get(tag)
            if p.state == AlarmState.UNACK:
                p.state = AlarmState.ACKED
            elif p.state == AlarmState.RTN_UNACK:
                p.state = AlarmState.NORMAL
            else:
                raise AlarmActionError(f"{tag} is {STATE_LABELS[p.state].lower()}, nothing to acknowledge")
            p.ack_at, p.ack_by = now, operator
            self._emit(p, EV_ACK, now, operator)
            return p.to_dict()

    def shelve(self, tag: str, minutes: float, now: float, operator: str = "operator",
               reason: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            p = self._get(tag)
            if p.state in (AlarmState.SHELVED, AlarmState.SUPPRESSED):
                raise AlarmActionError(f"{tag} is {STATE_LABELS[p.state].lower()}")
            if not 0 < minutes <= SHELVE_MAX_MIN:
                raise AlarmActionError(f"Shelve time must be between 1 and {SHELVE_MAX_MIN} minutes")
            p.state = AlarmState.SHELVED
            p.shelved_at = now
            p.shelved_until = now + minutes * 60
            p.shelved_by = operator
            p.shelve_reason = (reason or "").strip() or "Shelved by operator"
            self._emit(p, EV_SHELVE, now, operator, f"{p.shelve_reason} ({minutes:g} min)")
            return p.to_dict()

    def unshelve(self, tag: str, now: float, operator: str = "operator") -> Dict[str, Any]:
        with self._lock:
            p = self._get(tag)
            if p.state != AlarmState.SHELVED:
                raise AlarmActionError(f"{tag} is not shelved")
            self._unshelve(p, now, operator, "Unshelved by operator")
            return p.to_dict()

    def _unshelve(self, p: AlarmPoint, now: float, operator: str, note: str):
        p.shelved_at = p.shelved_until = p.shelved_by = p.shelve_reason = None
        self._return_to_service(p, now, EV_UNSHELVE, operator, note)

    # Views ------------------------------------------------------------------

    def alarm_list(self) -> List[Dict[str, Any]]:
        """Every alarm point that is not NORMAL, highest priority and newest first."""
        with self._lock:
            items = [p.to_dict() for p in self.points.values() if p.state != AlarmState.NORMAL]
        items.sort(key=lambda a: (a["priority"], -(_ts(a["activated_at"]))))
        return items

    def definitions(self) -> List[Dict[str, Any]]:
        out = []
        for p in self.points.values():
            d = {k: v for k, v in p.d.items() if k != "suppress"}
            d["meter_name"] = p.meter_name
            d["priority_label"] = ALARM_PRIORITIES[d["priority"]]["label"]
            d["suppression"] = p.d["suppress"]["reason"] if p.d.get("suppress") else None
            out.append(d)
        return out

    def alarm_rate(self, now: float) -> int:
        with self._lock:
            while self._recent_alarms and self._recent_alarms[0] < now - RATE_WINDOW_S:
                self._recent_alarms.popleft()
            return len(self._recent_alarms)

    def summary(self, now: float) -> Dict[str, Any]:
        with self._lock:
            states = [p.state for p in self.points.values()]
            annunciated = [p for p in self.points.values() if p.state in ANNUNCIATED]
            unacked = [p for p in annunciated if p.state in NEEDS_ACK]
            rate = self.alarm_rate(now)
            top = min(unacked, key=lambda p: (p.d["priority"], -(p.activated_at or 0)), default=None)

        if rate >= RATE_FLOOD:
            rate_status = "Flood"
        elif rate > RATE_MANAGEABLE:
            rate_status = "Above target"
        elif rate > RATE_ACCEPTABLE:
            rate_status = "Manageable"
        else:
            rate_status = "Acceptable"

        by_priority = {str(k): 0 for k in ALARM_PRIORITIES}
        for p in annunciated:
            by_priority[str(p.d["priority"])] += 1

        return {
            "annunciated": len(annunciated),
            "in_alarm": states.count(AlarmState.UNACK) + states.count(AlarmState.ACKED),
            "unacknowledged": len(unacked),
            "acknowledged": states.count(AlarmState.ACKED),
            "rtn_unack": states.count(AlarmState.RTN_UNACK),
            "shelved": states.count(AlarmState.SHELVED),
            "suppressed": states.count(AlarmState.SUPPRESSED),
            "by_priority": by_priority,
            "alarm_rate_10min": rate,
            "rate_status": rate_status,
            "highest_unacked": top.to_dict() if top else None,
            "configured": len(states),
        }


def _ts(iso: Optional[str]) -> float:
    if not iso:
        return 0.0
    return datetime.fromisoformat(iso).timestamp()
