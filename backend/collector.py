"""Background data collection service."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Set

from simulator import DeviceSimulator
from database import insert_reading, prune_old_readings
from alarm_engine import process_reading
from config import POLL_INTERVAL

logger = logging.getLogger(__name__)

_simulator = DeviceSimulator()
_latest_readings: dict = {}
_websocket_clients: Set = set()


def get_latest_readings_cache() -> dict:
    return _latest_readings


def register_ws_client(ws):
    _websocket_clients.add(ws)


def unregister_ws_client(ws):
    _websocket_clients.discard(ws)


async def broadcast_readings():
    """Push latest readings to all connected WebSocket clients."""
    if not _websocket_clients or not _latest_readings:
        return
    payload = json.dumps({"type": "readings", "data": list(_latest_readings.values())})
    dead = set()
    for ws in _websocket_clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    for ws in dead:
        _websocket_clients.discard(ws)


async def collection_loop():
    """Main polling loop: read all meters, store, process alarms, broadcast."""
    prune_counter = 0
    while True:
        try:
            readings = _simulator.read_all()
            for meter_id, reading in readings.items():
                insert_reading(reading)
                process_reading(reading)
                _latest_readings[meter_id] = reading

            await broadcast_readings()
            prune_counter += 1
            if prune_counter >= 720:  # every hour at 5s interval
                prune_old_readings(days=7)
                prune_counter = 0

        except Exception as exc:
            logger.error("Collection loop error: %s", exc)

        await asyncio.sleep(POLL_INTERVAL)
