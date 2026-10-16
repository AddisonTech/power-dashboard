"""FastAPI application entry point for Power Dashboard."""

import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config
import database
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
