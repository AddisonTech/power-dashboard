"""Alarm journal and trend history export, in the triage agent's input format.

The BMS Alarm Triage Agent reads one vendor-neutral JSON document per run
(format "bms-triage-journal", version 1): the alarm journal for a time
window, every alarm point with its limit, priority and meaning, the
equipment topology, and the trend history behind each point. This module
builds that document straight from the SQLite history and journal, so the
same export a person can download is what the triage endpoint hands the
agent.

Point ids are "<site>/<meter>/<alarm>", for example SIM-DC/UPS-A/ONBATT, and
each point names the series it is measured on, "<site>/<meter>/<parameter>",
so the load high and load very high alarms on one PDU share one series.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import config
import database

FORMAT = "bms-triage-journal"
FORMAT_VERSION = 1

KINDS = {"HI": "high", "HIHI": "high", "LO": "low", "LOLO": "low", "DISCRETE": "discrete"}


def iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds")


def point_id(tag: str) -> str:
    meter, _, alarm = tag.partition(".")
    return f"{config.TRIAGE_SITE}/{meter}/{alarm.replace('.', '_')}"


def series_id(meter_id: str, parameter: str) -> str:
    return f"{config.TRIAGE_SITE}/{meter_id}/{parameter}"


def _point(d: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": point_id(d["tag"]),
        "equipment": d["meter_id"],
        "signal": d.get("signal", ""),
        "kind": KINDS[d["kind"]],
        "limit": d["setpoint"],
        "deadband": d.get("deadband", 0),
        "priority": d["priority"],
        "units": d.get("unit", ""),
        "series": series_id(d["meter_id"], d["parameter"]),
        "description": d["message"],
    }


def _units(parameter: str) -> str:
    return {"voltage": "V", "frequency": "Hz", "load_pct": "%", "battery_soc": "%", "current": "A"}.get(parameter, "")


def build_journal(start: float, end: float, journal_from: Optional[float] = None) -> Dict[str, Any]:
    """The journal document for one window.

    journal_from, when given, starts the journal entries later than the
    trend history, so the history shows the plant before an event without
    pulling in the tail of an earlier one.
    """
    definitions = config.ALARM_POINTS
    by_tag = {d["tag"]: d for d in definitions}

    entries = []
    for row in database.get_alarm_events_window(journal_from if journal_from is not None else start, end):
        if row["tag"] not in by_tag:
            continue  # an alarm since removed from the database
        entries.append({
            "id": f"J{row['id']:07d}",
            "time": row["timestamp"],
            "point": point_id(row["tag"]),
            "event": row["event"],
            "value": row["value"],
            "operator": row["operator"],
            "note": row["note"],
        })

    wanted = {(d["meter_id"], d["parameter"]) for d in definitions}
    parameters = sorted({parameter for _meter, parameter in wanted})
    samples: Dict[str, List[list]] = {}
    for row in database.get_readings_window(start, end, parameters):
        for meter_id, parameter in ((row["meter_id"], p) for p in parameters):
            if (meter_id, parameter) not in wanted:
                continue
            value = row.get(parameter)
            if value is None:
                continue
            samples.setdefault(series_id(meter_id, parameter), []).append([row["timestamp"], value])

    series = [
        {"id": key, "units": _units(key.rsplit("/", 1)[-1]), "samples": values}
        for key, values in sorted(samples.items())
    ]

    return {
        "format": FORMAT,
        "version": FORMAT_VERSION,
        "source": f"power-dashboard {config.VERSION}",
        "site": config.TRIAGE_SITE,
        # Padded by a second so millisecond rounding never puts a sample outside it
        "window": {"start": iso(start - 1), "end": iso(end + 1)},
        "equipment": [
            {"id": m["id"], "type": m["type"], "fed_from": m["parent_id"]} for m in config.METERS
        ],
        "points": [_point(d) for d in definitions],
        "journal": entries,
        "series": series,
    }


def latest_event(now: float, lookback_s: float = 7 * 86400) -> Optional[Dict[str, float]]:
    """The most recent alarm event: its first alarm, last alarm, and window.

    Alarms closer together than TRIAGE_EVENT_GAP_S are one event, so an
    outage's dozen alarms over two minutes are one event and the PDU
    overload an hour earlier is another. The window runs from TRIAGE_PRE_S
    before the first alarm to TRIAGE_POST_S after the last, or to now if
    that is sooner, and never longer than TRIAGE_MAX_WINDOW_S.
    """
    epochs = database.get_alarm_epochs(now - lookback_s, now)
    if not epochs:
        return None
    last = epochs[0]
    first = last
    for epoch in epochs[1:]:
        if first - epoch > config.TRIAGE_EVENT_GAP_S:
            break
        first = epoch
    first = max(first, last - config.TRIAGE_MAX_WINDOW_S + config.TRIAGE_PRE_S)
    start = first - config.TRIAGE_PRE_S
    end = min(now, last + config.TRIAGE_POST_S)
    return {
        "first_alarm": first,
        "last_alarm": last,
        "start": start,
        "end": end,
        "alarms": sum(1 for e in epochs if e >= first),
        "settled": now >= last + config.TRIAGE_POST_S,
    }
