"""Modbus TCP data source for real power meters.

Enabled with DATA_SOURCE=modbus. The device map is a JSON file (see
modbus_config.example.json) that lists each meter's host, unit id, and the
register for every value. Requires the optional dependency in
requirements-modbus.txt (pymodbus).

Readings come back in the same shape the simulator produces, so the alarm
engine, history, and front end work unchanged. A meter that fails to answer
is reported with status "Comm Fail" and empty values; alarms on that meter
hold their last state until communication returns.
"""

import json
import logging
import struct
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from config import METERS_BY_ID

logger = logging.getLogger(__name__)

REGISTER_COUNT = {"int16": 1, "uint16": 1, "int32": 2, "uint32": 2, "float32": 2, "bool": 1}
NUMERIC_FIELDS = ("voltage", "current", "power_kw", "power_factor", "frequency",
                  "energy_kwh", "demand_kw", "load_pct")


def decode(registers: List[int], data_type: str, word_order: str = "big") -> float:
    """Decode raw 16 bit registers into a value."""
    if data_type == "bool":
        return bool(registers[0])
    if data_type == "uint16":
        return registers[0]
    if data_type == "int16":
        return struct.unpack(">h", struct.pack(">H", registers[0]))[0]
    words = list(registers[:2])
    if word_order == "little":
        words.reverse()
    raw = struct.pack(">HH", *words)
    fmt = {"int32": ">i", "uint32": ">I", "float32": ">f"}[data_type]
    return struct.unpack(fmt, raw)[0]


def load_config(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    for dev in cfg.get("devices", []):
        if dev["meter_id"] not in METERS_BY_ID:
            raise ValueError(f"Modbus device references unknown meter {dev['meter_id']}")
    return cfg


class ModbusSource:
    """Polls every configured device once per scan."""

    def __init__(self, cfg: Dict[str, Any], client_factory=None):
        self.cfg = cfg
        self.defaults = cfg.get("defaults", {})
        self._clients: Dict[str, Any] = {}
        if client_factory is None:
            from pymodbus.client import AsyncModbusTcpClient  # optional dependency

            def client_factory(host, port, timeout):
                return AsyncModbusTcpClient(host, port=port, timeout=timeout)
        self._factory = client_factory

    async def _client(self, host: str, port: int):
        key = f"{host}:{port}"
        client = self._clients.get(key)
        if client is None:
            client = self._factory(host, port, self.defaults.get("timeout", 2.0))
            self._clients[key] = client
        if not client.connected:
            await client.connect()
        return client

    async def _read_register(self, client, unit: int, spec: Dict[str, Any]):
        function = spec.get("function", "holding")
        address = spec["address"]
        dtype = spec.get("type", "float32")
        count = REGISTER_COUNT[dtype]
        if function == "coil":
            rr = await client.read_coils(address, count=1, slave=unit)
        elif function == "discrete":
            rr = await client.read_discrete_inputs(address, count=1, slave=unit)
        elif function == "input":
            rr = await client.read_input_registers(address, count=count, slave=unit)
        else:
            rr = await client.read_holding_registers(address, count=count, slave=unit)
        if rr.isError():
            raise IOError(f"Modbus error reading {address}: {rr}")
        if function in ("coil", "discrete"):
            return bool(rr.bits[0])
        value = decode(rr.registers, dtype, spec.get("word_order", self.defaults.get("word_order", "big")))
        if isinstance(value, bool):
            return value
        return value * spec.get("scale", 1.0)

    async def read_device(self, dev: Dict[str, Any], now: float) -> Dict[str, Any]:
        mid = dev["meter_id"]
        reading: Dict[str, Any] = {
            "meter_id": mid,
            "timestamp": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="milliseconds"),
            "epoch": round(now, 3),
            **{f: None for f in NUMERIC_FIELDS},
        }
        try:
            client = await self._client(dev["host"], dev.get("port", self.defaults.get("port", 502)))
            for field, spec in dev["registers"].items():
                reading[field] = await self._read_register(client, dev.get("unit_id", 1), spec)
        except Exception as exc:  # comm failure: report it, keep polling others
            logger.warning("Modbus read failed for %s: %s", mid, exc)
            return {**reading, **{f: None for f in NUMERIC_FIELDS}, "status": "Comm Fail", "comm_ok": False}

        rated = METERS_BY_ID[mid]["rated_current"]
        if reading["load_pct"] is None and reading["current"] is not None and rated:
            reading["load_pct"] = round(reading["current"] / rated * 100.0, 1)
        reading["status"] = dev.get("status_label", "Online")
        reading["comm_ok"] = True
        return reading

    async def read_all(self, now: float) -> Dict[str, Dict[str, Any]]:
        out = {}
        for dev in self.cfg.get("devices", []):
            out[dev["meter_id"]] = await self.read_device(dev, now)
        return out

    def close(self):
        for client in self._clients.values():
            try:
                client.close()
            except Exception:
                pass
