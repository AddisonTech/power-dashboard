"""The triage tie-in: run the BMS Alarm Triage Agent on the latest event.

The dashboard raises the alarm flood; the agent cuts it to a short ranked
list. This module finds the window around the most recent alarm event,
exports the alarm journal and trend history for it (triage_export.py), and
hands that document to the agent, which is installed as a package pinned to
its 0.2.2 release commit.

Light enough for a free hosting tier: the agent is imported on first use
rather than at startup, one run happens at a time, a window that has not
changed since the last run returns the stored result, and a run over one
event takes tens of milliseconds once imported.

The agent writes its explanations with its template writer. Claude Haiku
writes them only if TRIAGE_ANTHROPIC_KEY is set in the environment, and the
hosted demo does not set it. Strictly read only: the agent receives a copy of
the journal and history and has no path back to the alarm manager or any
meter.
"""

import logging
import threading
import time
from typing import Any, Dict, Optional

import triage_export

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: Dict[str, Any] = {"key": None, "value": None}


class NoEvent(Exception):
    """There is no alarm event in the journal to triage."""


class AgentUnavailable(Exception):
    """The triage agent package is not installed."""


class BadInput(Exception):
    """The agent refused the export. Its message names the entry."""


class BadZone(Exception):
    """The time zone is not an IANA name."""


def check_zone(name: Optional[str]) -> str:
    """The viewer's IANA zone, or UTC. Refuses anything else."""
    from bms_alarm_triage import display

    name = (name or "").strip() or display.DEFAULT_ZONE
    try:
        display.zone(name)
    except display.UnknownTimeZone as exc:
        raise BadZone(str(exc)) from exc
    return name


def zone_labels(name: str, epochs) -> Dict[str, Any]:
    """The zone's label for every UTC offset the window touches.

    The browser converts each time itself and looks its label up here by
    offset, so a header the browser formats and a sentence the agent wrote
    carry the same label, EDT next to EDT, even across a daylight saving
    change and in zones a browser would only call GMT+2.
    """
    from datetime import datetime, timezone

    from bms_alarm_triage import display

    tz = display.zone(name)
    labels = {}
    for epoch in epochs:
        if epoch is None:
            continue
        moment = datetime.fromtimestamp(epoch, timezone.utc)
        offset = moment.astimezone(tz).strftime("%z")
        labels[f"{offset[:3]}:{offset[3:]}"] = display.label(moment, tz)
    return {"name": name, "labels": labels}


def _service():
    try:
        import bms_triage_service
    except ImportError as exc:  # pragma: no cover - only without the dependency
        raise AgentUnavailable("The triage agent is not installed on this server") from exc
    return bms_triage_service


def _key(journal: Dict[str, Any]) -> tuple:
    entries = journal["journal"]
    samples = sum(len(s["samples"]) for s in journal["series"])
    return (journal["window"]["start"], journal["window"]["end"], len(entries),
            entries[-1].get("id") if entries else None, samples)


def run(now: float, start: Optional[float] = None, end: Optional[float] = None,
        time_zone: Optional[str] = None) -> Dict[str, Any]:
    """Triage the latest event, or an explicit window, with its text in one zone."""
    zone_name = check_zone(time_zone)
    if start is None or end is None:
        event = triage_export.latest_event(now)
        if event is None:
            raise NoEvent("No alarm event in the journal yet. Trigger a demo event first.")
        journal = triage_export.build_journal(event["start"], event["end"], journal_from=event["first_alarm"])
    else:
        event = {"first_alarm": None, "last_alarm": None, "start": start, "end": end, "settled": now >= end}
        journal = triage_export.build_journal(start, end)

    window = {
        "start": triage_export.iso(event["start"]),
        "end": triage_export.iso(event["end"]),
        "first_alarm": triage_export.iso(event["first_alarm"]) if event["first_alarm"] else None,
        "last_alarm": triage_export.iso(event["last_alarm"]) if event["last_alarm"] else None,
        "settled": event["settled"],
    }
    if not any(e["event"] == "ALARM" for e in journal["journal"]):
        raise NoEvent("No alarms in that window.")

    zone = zone_labels(zone_name, [event["start"], event["first_alarm"], event["last_alarm"], event["end"]])
    key = (_key(journal), zone_name)
    with _lock:
        if _cache["key"] == key:
            return {**_cache["value"], "cached": True}
        service = _service()
        from bms_alarm_triage.errors import TriageError

        started = time.perf_counter()
        try:
            result = service.triage(journal, time_zone=zone_name)
        except TriageError as exc:
            raise BadInput(str(exc)) from exc
        elapsed = time.perf_counter() - started
        value = {"event": window, "zone": zone, "triage": result,
                 "elapsed_ms": round(elapsed * 1000, 1), "cached": False}
        _cache["key"], _cache["value"] = key, value
    logger.info("Triage: %d journal entries to %d ranked item(s) in %.0f ms (%s)",
                result["counts"].get("journal_entries", 0), result["counts"]["ranked_items"],
                elapsed * 1000, result["writer"]["name"])
    return value


def clear_cache():
    with _lock:
        _cache["key"] = _cache["value"] = None
