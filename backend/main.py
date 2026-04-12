"""FastAPI application entry point for Power Dashboard."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from database import (
    init_db, get_all_meters, get_latest_readings, get_meter_history,
    get_active_alarms, get_alarm_history, acknowledge_alarm
)
from collector import (
    collection_loop, register_ws_client, unregister_ws_client,
    get_latest_readings_cache, broadcast_readings
)
from config import METERS, WS_INTERVAL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(collection_loop())
    logger.info("Power Dashboard collection loop started")
    yield
    task.cancel()


app = FastAPI(
    title="Power Dashboard API",
    description="Real-time Electrical Power Monitoring System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# REST Endpoints

@app.get("/api/meters")
def list_meters():
    meters = get_all_meters()
    readings_cache = get_latest_readings_cache()
    result = []
    for m in meters:
        reading = readings_cache.get(m["id"], {})
        result.append({**m, "current_reading": reading})
    return result


@app.get("/api/meters/{meter_id}")
def meter_detail(meter_id: int):
    meters = {m["id"]: m for m in get_all_meters()}
    if meter_id not in meters:
        raise HTTPException(status_code=404, detail="Meter not found")
    reading = get_latest_readings_cache().get(meter_id, {})
    return {**meters[meter_id], "current_reading": reading}


@app.get("/api/meters/{meter_id}/history")
def meter_history(meter_id: int, period: str = "1h"):
    if period not in ("1h", "24h", "7d"):
        raise HTTPException(status_code=400, detail="period must be 1h, 24h, or 7d")
    return get_meter_history(meter_id, period)


@app.get("/api/alarms")
def active_alarms():
    return get_active_alarms()


@app.get("/api/alarms/history")
def alarms_history(limit: int = 200):
    return get_alarm_history(limit)


@app.post("/api/alarms/{alarm_id}/acknowledge")
def ack_alarm(alarm_id: int, ack_by: str = "operator"):
    acknowledge_alarm(alarm_id, ack_by)
    return {"status": "acknowledged", "alarm_id": alarm_id}


@app.get("/api/system/status")
def system_status():
    cache = get_latest_readings_cache()
    active = get_active_alarms()

    total_power = sum(r.get("power_kw", 0) for r in cache.values())
    pf_values = [r["power_factor"] for r in cache.values() if r.get("power_factor")]
    avg_pf = round(sum(pf_values) / len(pf_values), 4) if pf_values else 0.0

    critical_count = sum(1 for a in active if a["priority"] == 1)
    high_count = sum(1 for a in active if a["priority"] == 2)

    if critical_count > 0:
        health = "critical"
    elif high_count > 0:
        health = "warning"
    elif len(active) > 0:
        health = "caution"
    else:
        health = "normal"

    return {
        "health": health,
        "total_power_kw": round(total_power, 2),
        "avg_power_factor": avg_pf,
        "active_alarm_count": len(active),
        "critical_alarm_count": critical_count,
        "high_alarm_count": high_count,
        "meter_count": len(METERS),
        "meters_online": len(cache),
    }


# WebSocket

@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    await websocket.accept()
    register_ws_client(websocket)
    try:
        while True:
            # Keep connection alive; data is pushed by broadcast_readings
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
    finally:
        unregister_ws_client(websocket)
