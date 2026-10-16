"""FastAPI application entry point for Power Dashboard."""

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import config
import database
import triage
import triage_export
from alarms import AlarmActionError
from collector import Collector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    collector = Collector()
    app.state.collector = collector
    await collector.start()
    logger.info("Power Dashboard %s started (data source: %s)", config.VERSION, collector.source)
    yield
    await collector.stop()
    database.close()


app = FastAPI(
    title="Power Dashboard API",
    description="Real-time data center electrical power monitoring with ISA 18.2 alarm management",
    version=config.VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _collector(request: Request) -> Collector:
    return request.app.state.collector


def _operator(name: Optional[str]) -> str:
    name = (name or "").strip()[:40]
    return name or "operator"


class OperatorAction(BaseModel):
    operator: Optional[str] = None


class ShelveRequest(BaseModel):
    minutes: float = Field(15, gt=0, le=config.SHELVE_MAX_MIN)
    reason: Optional[str] = Field(None, max_length=200)
    operator: Optional[str] = None


# ---------------------------------------------------------------------------
# Health and configuration
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health(request: Request):
    c = _collector(request)
    return {
        "status": "ok" if c.ready else "starting",
        "version": config.VERSION,
        "data_source": c.source,
        "uptime_s": round(c.clock() - c.started_at, 1),
        "clients": len(c.clients),
    }


@app.get("/api/config")
def get_config(request: Request):
    c = _collector(request)
    return {
        "version": config.VERSION,
        "data_source": c.source,
        "poll_interval_s": config.POLL_INTERVAL,
        "history_interval_s": config.HISTORY_INTERVAL,
        "retention_days": config.RETENTION_DAYS,
        "shelve_durations_min": config.SHELVE_DURATIONS_MIN,
        "shelve_max_min": config.SHELVE_MAX_MIN,
        "priorities": config.ALARM_PRIORITIES,
        "meters": config.METERS,
    }


# ---------------------------------------------------------------------------
# Meters
# ---------------------------------------------------------------------------

@app.get("/api/meters")
def list_meters(request: Request):
    latest = _collector(request).latest
    return [{**m, "current_reading": latest.get(m["id"], {})} for m in config.METERS]


@app.get("/api/meters/{meter_id}")
def meter_detail(meter_id: str, request: Request):
    if meter_id not in config.METERS_BY_ID:
        raise HTTPException(status_code=404, detail="Meter not found")
    reading = _collector(request).latest.get(meter_id, {})
    return {**config.METERS_BY_ID[meter_id], "current_reading": reading}


@app.get("/api/meters/{meter_id}/history")
def meter_history(meter_id: str, period: str = "1h"):
    if meter_id not in config.METERS_BY_ID:
        raise HTTPException(status_code=404, detail="Meter not found")
    if period not in database.PERIODS:
        raise HTTPException(status_code=400, detail="period must be 1h, 24h, or 7d")
    return database.get_meter_history(meter_id, period)


@app.get("/api/system/status")
def system_status(request: Request):
    return _collector(request).system_status()


# ---------------------------------------------------------------------------
# Alarms (ISA 18.2)
# ---------------------------------------------------------------------------

@app.get("/api/alarms")
def alarms(request: Request):
    return _collector(request).alarm_payload()


@app.get("/api/alarms/history")
def alarm_history(limit: int = 200, tag: Optional[str] = None):
    return database.get_alarm_events(min(max(limit, 1), 1000), tag)


@app.get("/api/alarms/definitions")
def alarm_definitions(request: Request):
    return _collector(request).alarms.definitions()


async def _alarm_action(request: Request, fn, *args, **kwargs):
    c = _collector(request)
    try:
        result = fn(*args, now=c.clock(), **kwargs)
    except KeyError:
        raise HTTPException(status_code=404, detail="Alarm tag not found")
    except AlarmActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await c.broadcast_alarms()
    return result


@app.post("/api/alarms/{tag}/acknowledge")
async def acknowledge(tag: str, request: Request, body: Optional[OperatorAction] = None):
    c = _collector(request)
    return await _alarm_action(request, c.alarms.acknowledge, tag,
                               operator=_operator(body.operator if body else None))


@app.post("/api/alarms/{tag}/shelve")
async def shelve(tag: str, body: ShelveRequest, request: Request):
    c = _collector(request)
    return await _alarm_action(request, c.alarms.shelve, tag, body.minutes,
                               operator=_operator(body.operator), reason=body.reason)


@app.post("/api/alarms/{tag}/unshelve")
async def unshelve(tag: str, request: Request, body: Optional[OperatorAction] = None):
    c = _collector(request)
    return await _alarm_action(request, c.alarms.unshelve, tag,
                               operator=_operator(body.operator if body else None))


# ---------------------------------------------------------------------------
# Demo (simulation only)
# ---------------------------------------------------------------------------

@app.get("/api/demo")
def demo(request: Request):
    c = _collector(request)
    return {**c.demo_info(), "active_scenario": c.sim.scenario_info(c.clock()) if c.sim else None}


@app.post("/api/demo/events/{name}")
async def trigger_event(name: str, request: Request):
    c = _collector(request)
    try:
        info = c.trigger_event(name)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown scenario")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return info


# ---------------------------------------------------------------------------
# Alarm journal export and triage
#
# The export is the alarm journal and trend history for a window, in the
# triage agent's input format (bms-triage-journal, version 1). POST
# /api/triage runs the agent on the window around the most recent event and
# returns the ranked list: root cause first, its consequences collapsed
# under it, trend evidence, the next step, and which writer wrote the text.
# ---------------------------------------------------------------------------

def _epoch(text: Optional[str], name: str) -> Optional[float]:
    if text in (None, ""):
        return None
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{name} must be an ISO 8601 time")
    if moment.tzinfo is None:
        raise HTTPException(status_code=400, detail=f"{name} needs a timezone offset")
    return moment.timestamp()


def _window(request: Request, start: Optional[str], end: Optional[str], minutes: Optional[float]):
    now = _collector(request).clock()
    t0, t1 = _epoch(start, "start"), _epoch(end, "end")
    if t0 is None and t1 is None:
        span = (minutes or 60) * 60
        t1, t0 = now, now - span
    elif t0 is None or t1 is None:
        raise HTTPException(status_code=400, detail="Give both start and end, or neither")
    if t1 <= t0:
        raise HTTPException(status_code=400, detail="end must be after start")
    if t1 - t0 > config.EXPORT_MAX_MINUTES * 60:
        raise HTTPException(status_code=400, detail=f"The window is limited to {config.EXPORT_MAX_MINUTES} minutes")
    return t0, t1


@app.get("/api/export/journal")
def export_journal(request: Request, start: Optional[str] = None, end: Optional[str] = None,
                   minutes: Optional[float] = None):
    """Alarm journal and trend history for a window, in the triage agent's format."""
    if minutes is not None and not 0 < minutes <= config.EXPORT_MAX_MINUTES:
        raise HTTPException(status_code=400, detail=f"minutes must be 1 to {config.EXPORT_MAX_MINUTES}")
    t0, t1 = _window(request, start, end, minutes)
    doc = triage_export.build_journal(t0, t1)
    name = "alarm-journal-" + datetime.fromtimestamp(t1, timezone.utc).strftime("%Y%m%d-%H%M%S") + ".json"
    return JSONResponse(doc, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/triage/event")
def triage_event(request: Request):
    """The most recent alarm event, if any. Cheap; used to offer the triage button."""
    event = triage_export.latest_event(_collector(request).clock())
    if event is None:
        return {"event": None}
    return {"event": {
        "first_alarm": triage_export.iso(event["first_alarm"]),
        "last_alarm": triage_export.iso(event["last_alarm"]),
        "start": triage_export.iso(event["start"]),
        "end": triage_export.iso(event["end"]),
        "alarms": event["alarms"],
        "settled": event["settled"],
    }}


class TriageRequest(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None


@app.post("/api/triage")
def run_triage(request: Request, body: Optional[TriageRequest] = None):
    """Run the triage agent on the latest event (or a given window)."""
    now = _collector(request).clock()
    start = end = None
    if body and (body.start or body.end):
        start, end = _window(request, body.start, body.end, None)
    try:
        return triage.run(now, start, end)
    except triage.NoEvent as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except triage.AgentUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except triage.BadInput as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ---------------------------------------------------------------------------
# WebSocket live feed
#
# On connect the server sends a "snapshot" with everything the UI needs. After
# that it pushes "readings" every scan and "alarms" whenever the alarm list
# changes. Clients may send {"type": "ping"} and get {"type": "pong"} back.
# ---------------------------------------------------------------------------

@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    c: Collector = websocket.app.state.collector
    await websocket.accept()
    await websocket.send_text(json.dumps({"type": "snapshot", "data": c.snapshot()},
                                         separators=(",", ":")))
    c.register(websocket)
    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        c.unregister(websocket)
