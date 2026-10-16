"""Scan loop: read the data source, evaluate alarms, store history, push to clients."""

import asyncio
import json
import logging
import random
import time
from typing import Any, Callable, Dict, List, Optional, Set

import config
import database
from alarms import ANNUNCIATED, NEEDS_ACK, AlarmManager, AlarmState
from simulator import SCENARIOS, FacilitySimulator

logger = logging.getLogger(__name__)

BACKFILL_STEP_S = 60.0
BACKFILL_EVENT_STEP_S = 5.0  # finer steps while an event plays out
SIM_OPERATOR = "operator (simulated)"


class Collector:
    """Owns the live state of the system and the set of WebSocket clients."""

    def __init__(self, source: str = None, clock: Callable[[], float] = time.time):
        self.source = (source or config.DATA_SOURCE)
        self.clock = clock
        self.started_at = clock()
        self.meter_names = {m["id"]: m["name"] for m in config.METERS}
        self.alarms = AlarmManager(config.ALARM_POINTS, self.meter_names)
        self.alarms.add_listener(database.insert_alarm_event)
        self.latest: Dict[str, Dict[str, Any]] = {}
        self.clients: Set[Any] = set()
        self.ready = False
        self.scan_count = 0
        self._last_history = 0.0
        self._last_prune = 0.0
        self._task: Optional[asyncio.Task] = None

        self.sim: Optional[FacilitySimulator] = None
        self.modbus = None
        if self.source == "modbus":
            from modbus_source import ModbusSource, load_config
            self.modbus = ModbusSource(load_config(config.MODBUS_CONFIG))
        else:
            self.source = "simulator"
            seed = int(config.SIM_SEED) if config.SIM_SEED else None
            self.sim = FacilitySimulator(
                seed=seed,
                event_interval=(config.SIM_EVENT_MIN, config.SIM_EVENT_MAX),
                first_event_delay=config.SIM_FIRST_EVENT,
            )

    @property
    def simulated(self) -> bool:
        return self.sim is not None

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------

    def initialize(self):
        """Prepare storage. A simulated demo starts fresh with backfilled history."""
        database.init_db(reset=self.simulated)
        if self.simulated and config.BACKFILL_HOURS > 0:
            t0 = time.perf_counter()
            self.backfill(config.BACKFILL_HOURS, self.clock())
            logger.info("Backfilled %.0f h of simulated history in %.2f s",
                        config.BACKFILL_HOURS, time.perf_counter() - t0)

    def backfill(self, hours: float, now: float):
        """Run the simulator over the past few hours so trends and history are populated.

        Events are spaced out the way a real site sees them, and a simulated
        operator acknowledges alarms shortly after they annunciate.
        """
        sim = self.sim
        live_interval, live_first = sim.event_interval, sim.first_event_delay
        sim.event_interval, sim.first_event_delay = (1800.0, 5400.0), 600.0
        rng = random.Random(sim.rng.random())

        events: List[Dict[str, Any]] = []
        mgr = AlarmManager(config.ALARM_POINTS, self.meter_names)
        mgr.add_listener(events.append)
        rows: List[Dict[str, Any]] = []

        t = now - hours * 3600
        quiet_from = now - 900  # no new events in the last 15 minutes
        while t < now:
            sim.auto_events = t < quiet_from
            readings = sim.step(t)
            rows.extend(readings.values())
            mgr.evaluate(readings, t)
            for p in mgr.points.values():
                if p.state in NEEDS_ACK and p.activated_at is not None \
                        and t - p.activated_at >= rng.uniform(30, 150):
                    mgr.acknowledge(p.tag, t, SIM_OPERATOR)
            t += BACKFILL_EVENT_STEP_S if sim.scenario else BACKFILL_STEP_S

        database.insert_readings(rows)
        database.insert_alarm_events(events)
        sim.auto_events = True
        sim.event_interval, sim.first_event_delay = live_interval, live_first
        sim.schedule_event_at(now + live_first)  # first live event soon after startup
        self._last_history = now

    async def start(self):
        self.initialize()
        await self.scan_once()
        self.ready = True
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self.modbus:
            self.modbus.close()

    # ------------------------------------------------------------------
    # Scan loop
    # ------------------------------------------------------------------

    async def _run(self):
        while True:
            started = self.clock()
            await asyncio.sleep(max(0.05, config.POLL_INTERVAL - (self.clock() - started)))
            try:
                await self.scan_once()
            except Exception:
                logger.exception("Scan failed")

    async def scan_once(self, now: Optional[float] = None) -> Dict[str, Dict[str, Any]]:
        now = self.clock() if now is None else now
        if self.sim:
            readings = self.sim.step(now)
        else:
            readings = await self.modbus.read_all(now)
        self.latest.update(readings)
        self.scan_count += 1

        alarms_changed = self.alarms.evaluate(readings, now)

        if now - self._last_history >= config.HISTORY_INTERVAL:
            database.insert_readings(r for r in readings.values() if r.get("voltage") is not None)
            self._last_history = now
        if now - self._last_prune >= 3600:
            database.prune(config.RETENTION_DAYS, now)
            self._last_prune = now

        await self.broadcast({"type": "readings", "data": {
            "readings": list(readings.values()),
            "system": self.system_status(now),
        }})
        if alarms_changed or self.scan_count % 5 == 0:
            await self.broadcast_alarms(now)
        return readings

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    def alarm_payload(self, now: Optional[float] = None) -> Dict[str, Any]:
        now = self.clock() if now is None else now
        return {"alarms": self.alarms.alarm_list(), "summary": self.alarms.summary(now)}

    def system_status(self, now: Optional[float] = None) -> Dict[str, Any]:
        now = self.clock() if now is None else now
        r = self.latest
        facility_kw = r.get("MSB-1", {}).get("power_kw") or 0.0
        it_kw = sum((r.get(m["id"], {}).get("power_kw") or 0.0)
                    for m in config.METERS if m["type"] == "pdu")
        ups_runtime = [r[u].get("battery_runtime_min") for u in ("UPS-A", "UPS-B")
                       if u in r and r[u].get("battery_runtime_min") is not None]

        on_battery = any(r.get(u, {}).get("on_battery") for u in ("UPS-A", "UPS-B"))

        in_alarm = [p for p in self.alarms.points.values()
                    if p.state in (AlarmState.UNACK, AlarmState.ACKED)]
        priorities = {p.d["priority"] for p in in_alarm}
        if 1 in priorities:
            health = "critical"
        elif 2 in priorities:
            health = "warning"
        elif priorities:
            health = "caution"
        else:
            health = "normal"

        online = sum(1 for v in r.values() if v.get("comm_ok", True))
        return {
            "health": health,
            "data_source": self.source,
            "simulated": self.simulated,
            "facility_kw": round(facility_kw, 1),
            "it_kw": round(it_kw, 1),
            "pue": round(facility_kw / it_kw, 2) if facility_kw > 0 and it_kw > 0 and not on_battery else None,
            "power_source": r.get("ATS-1", {}).get("position"),
            "utility_status": r.get("UTIL-1", {}).get("status"),
            "generator_status": r.get("GEN-1", {}).get("status"),
            "ups_min_runtime_min": min(ups_runtime) if ups_runtime else None,
            "annunciated_alarms": sum(1 for p in self.alarms.points.values() if p.state in ANNUNCIATED),
            "meter_count": len(config.METERS),
            "meters_online": online,
            "scenario": self.sim.scenario_info(now) if self.sim else None,
            "server_time": now,
        }

    def demo_info(self) -> Dict[str, Any]:
        return {
            "simulated": self.simulated,
            "events_enabled": self.simulated and config.DEMO_EVENTS_ENABLED,
            "scenarios": [{"name": k, **v} for k, v in SCENARIOS.items()] if self.simulated else [],
            "poll_interval_s": config.POLL_INTERVAL,
            "version": config.VERSION,
        }

    def snapshot(self) -> Dict[str, Any]:
        now = self.clock()
        return {
            "meters": config.METERS,
            "readings": list(self.latest.values()),
            "system": self.system_status(now),
            "demo": self.demo_info(),
            **self.alarm_payload(now),
        }

    # ------------------------------------------------------------------
    # Demo events
    # ------------------------------------------------------------------

    def trigger_event(self, name: str) -> Dict[str, Any]:
        if not self.simulated or not config.DEMO_EVENTS_ENABLED:
            raise PermissionError("Demo events are only available in simulation mode")
        now = self.clock()
        info = self.sim.trigger(name, now)
        return info

    # ------------------------------------------------------------------
    # WebSocket clients
    # ------------------------------------------------------------------

    def register(self, ws):
        self.clients.add(ws)

    def unregister(self, ws):
        self.clients.discard(ws)

    async def _send(self, ws, text: str):
        try:
            await asyncio.wait_for(ws.send_text(text), timeout=5)
        except Exception:
            self.clients.discard(ws)

    async def broadcast(self, message: Dict[str, Any]):
        if not self.clients:
            return
        text = json.dumps(message, separators=(",", ":"))
        await asyncio.gather(*(self._send(ws, text) for ws in list(self.clients)))

    async def broadcast_alarms(self, now: Optional[float] = None):
        await self.broadcast({"type": "alarms", "data": self.alarm_payload(now)})
