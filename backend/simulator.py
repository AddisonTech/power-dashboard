"""Data center power system simulator.

Models a small 2N data center so the public demo runs without hardware:

    Utility ---+
               +--> ATS --> Main Switchboard --+--> UPS A --> PDU A1, PDU A2
    Generator -+                               +--> UPS B --> PDU B1, PDU B2
                                               +--> Mechanical panel

Values are computed bottom up so they stay physically consistent: IT load at
each PDU rolls up through transformer and UPS losses to the switchboard, and
the switchboard load appears on whichever source the ATS has selected.

Equipment behaves like the real thing: the generator cranks and warms up, the
ATS waits for a stable source before transferring, UPS systems ride through on
battery and recharge afterward, and cooling load drops out and restarts when
the switchboard loses power.

Scenarios inject abnormal conditions (utility outage, voltage sag, PDU
overload, low power factor) so the alarm system has something to show. They
fire automatically at random intervals and can be triggered on demand.
"""

import math
import random
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from config import METERS, METERS_BY_ID, NOMINAL_FREQUENCY

SQRT3 = math.sqrt(3)

SCENARIOS = {
    "utility_outage": {
        "label": "Utility outage",
        "description": "Utility power is lost. UPS systems carry the IT load on battery, the "
                       "generator starts, the ATS transfers, then retransfers when utility returns.",
    },
    "voltage_sag": {
        "label": "Utility voltage sag",
        "description": "A short utility voltage dip to about 85 percent. UPS systems ride "
                       "through on battery for a few seconds.",
    },
    "pdu_overload": {
        "label": "PDU overload",
        "description": "New servers push one PDU past its load alarm limits, then the load "
                       "is rebalanced.",
    },
    "pf_drop": {
        "label": "Low power factor",
        "description": "The cooling plant capacitor bank drops out and the mechanical panel "
                       "power factor falls below its alarm limit.",
    },
}

# Base IT load per PDU (kW) and the cooling load ratio
_PDU_BASE_KW = {"PDU-A1": 74.0, "PDU-A2": 66.0, "PDU-B1": 71.0, "PDU-B2": 63.0}
_PDU_EFFICIENCY = 0.975
_UPS_EFFICIENCY = 0.955
_UPS_BATTERY_KWH = 50.0
_UPS_CHARGE_KW = 10.0
_HOUSE_KW = 18.0
_MECH_RATIO = 0.48

# Equipment timing (seconds)
_GEN_START_DELAY = 2.0      # utility must be bad this long before engine start
_GEN_CRANK_TIME = 6.0       # crank to rated voltage and frequency
_ATS_GEN_STABLE = 4.0       # generator must be stable before transfer
_ATS_RETRANSFER = 30.0      # utility must be stable before retransfer
_GEN_COOLDOWN = 30.0        # unloaded run after retransfer
_UPS_WALK_IN = 3.0          # rectifier walk in after input returns
_MECH_RESTART = 20.0        # cooling equipment restart ramp


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds")


class FacilitySimulator:
    """Stateful simulator. Call step(now) once per scan."""

    def __init__(self, seed: Optional[int] = None, auto_events: bool = True,
                 event_interval: Tuple[float, float] = (150.0, 360.0),
                 first_event_delay: float = 25.0):
        self.rng = random.Random(seed)
        self.auto_events = auto_events
        self.event_interval = event_interval
        self.first_event_delay = first_event_delay

        self._t_last: Optional[float] = None
        self._next_event_at: Optional[float] = None
        self.scenario: Optional[Dict[str, Any]] = None

        # Slow random walks (Ornstein Uhlenbeck) keep values drifting naturally
        self._walk: Dict[str, float] = {k: 0.0 for k in (
            "util_v", "util_f", "gen_v", "mech", "mech_pf", *_PDU_BASE_KW.keys())}

        # Meter registers
        sizes = {"utility": 1.2e6, "generator": 4.0e3, "ats": 1.2e6, "switchgear": 1.2e6,
                 "ups": 4.5e5, "panel": 4.0e5, "pdu": 2.0e5}
        self._energy = {m["id"]: sizes[m["type"]] * self.rng.uniform(0.6, 1.4) for m in METERS}
        self._demand: Dict[str, Optional[float]] = {m["id"]: None for m in METERS}

        # Equipment state
        self.gen_state = "STANDBY"
        self._gen_since = 0.0
        self._gen_running_since: Optional[float] = None
        self.ats_position = "UTILITY"
        self._transfer_at: Optional[float] = None
        self._util_bad_since: Optional[float] = None
        self._util_good_since: Optional[float] = 0.0
        self._source_ok_since: Optional[float] = 0.0
        self._mech_restart_since: Optional[float] = None
        self.ups = {
            side: {"soc": 100.0, "on_battery": False, "input_ok_since": 0.0}
            for side in ("UPS-A", "UPS-B")
        }

    # ------------------------------------------------------------------
    # Scenarios
    # ------------------------------------------------------------------

    def trigger(self, name: str, now: float, **params) -> Dict[str, Any]:
        """Start a scenario. Raises KeyError if unknown, RuntimeError if busy."""
        if name not in SCENARIOS:
            raise KeyError(name)
        if self.scenario is not None:
            raise RuntimeError(f"Scenario '{self.scenario['name']}' is still running")

        rng = self.rng
        if name == "utility_outage":
            p = {"duration": params.get("duration", rng.uniform(90, 150))}
        elif name == "voltage_sag":
            p = {"duration": params.get("duration", rng.uniform(4, 8)),
                 "depth": params.get("depth", rng.uniform(0.84, 0.875))}
        elif name == "pdu_overload":
            ramp = params.get("ramp", 40.0)
            hold = params.get("hold", rng.uniform(60, 90))
            p = {"pdu": params.get("pdu", rng.choice(list(_PDU_BASE_KW))),
                 "target_pct": params.get("target_pct", rng.uniform(86, 95)),
                 "ramp": ramp, "hold": hold, "duration": 2 * ramp + hold}
        else:  # pf_drop
            p = {"duration": params.get("duration", rng.uniform(70, 130)),
                 "pf": params.get("pf", rng.uniform(0.78, 0.82))}

        self.scenario = {"name": name, "label": SCENARIOS[name]["label"],
                         "started_at": now, "params": p}
        return self.scenario_info(now)

    def scenario_info(self, now: float) -> Optional[Dict[str, Any]]:
        if self.scenario is None:
            return None
        return {
            "name": self.scenario["name"],
            "label": self.scenario["label"],
            "started_at": _iso(self.scenario["started_at"]),
            "elapsed_s": round(now - self.scenario["started_at"], 1),
        }

    def _scenario_elapsed(self, name: str, now: float) -> Optional[float]:
        if self.scenario and self.scenario["name"] == name:
            return now - self.scenario["started_at"]
        return None

    def _update_scenario(self, now: float):
        sc = self.scenario
        if sc is not None:
            elapsed = now - sc["started_at"]
            done = elapsed >= sc["params"]["duration"]
            if sc["name"] == "utility_outage":
                done = done and self.ats_position == "UTILITY" and self.gen_state == "STANDBY"
            if done:
                self.scenario = None
                self._schedule_next(now)

        if self._next_event_at is None:
            self._next_event_at = now + self.first_event_delay

        if self.auto_events and self.scenario is None and now >= self._next_event_at:
            weights = {"voltage_sag": 0.3, "pdu_overload": 0.25, "pf_drop": 0.25,
                       "utility_outage": 0.2}
            name = self.rng.choices(list(weights), weights=list(weights.values()))[0]
            self.trigger(name, now)

    def _schedule_next(self, now: float):
        lo, hi = self.event_interval
        self._next_event_at = now + self.rng.uniform(lo, hi)

    def schedule_event_at(self, at: float):
        """Set the time of the next automatic event."""
        self._next_event_at = at

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _ou(self, key: str, dt: float, sigma: float, tau: float) -> float:
        """Advance an Ornstein Uhlenbeck random walk with mean 0."""
        decay = math.exp(-dt / tau)
        x = self._walk[key] * decay + sigma * math.sqrt(1 - decay * decay) * self.rng.gauss(0, 1)
        self._walk[key] = x
        return x

    def _noise(self, sigma: float) -> float:
        return self.rng.gauss(0, sigma)

    def _register(self, mid: str, kw: float, dt: float) -> Tuple[float, float]:
        self._energy[mid] += max(kw, 0.0) * dt / 3600.0
        d = self._demand[mid]
        d = kw if d is None else d + (kw - d) * min(1.0, dt / 900.0)  # 15 min demand
        self._demand[mid] = d
        return self._energy[mid], d

    # ------------------------------------------------------------------
    # Main step
    # ------------------------------------------------------------------

    def step(self, now: float) -> Dict[str, Dict[str, Any]]:
        dt = 2.0 if self._t_last is None else min(max(now - self._t_last, 0.0), 3600.0)
        self._t_last = now
        self._update_scenario(now)

        hour = (now % 86400) / 3600.0
        it_profile = 1.0 + 0.04 * math.sin(2 * math.pi * (hour - 10) / 24)
        temp_profile = 1.0 + 0.12 * math.sin(2 * math.pi * (hour - 9) / 24)

        # --- Utility source ------------------------------------------------
        outage_t = self._scenario_elapsed("utility_outage", now)
        util_available = not (outage_t is not None and outage_t < self.scenario["params"]["duration"])
        sag_t = self._scenario_elapsed("voltage_sag", now)
        v_factor = 1.0
        if sag_t is not None and sag_t < self.scenario["params"]["duration"]:
            v_factor = self.scenario["params"]["depth"]

        util_walk_v = self._ou("util_v", dt, 2.5, 600)
        util_walk_f = self._ou("util_f", dt, 0.012, 120)
        if util_available:
            v_util = (482.0 + util_walk_v + self._noise(0.6)) * v_factor
            f_util = NOMINAL_FREQUENCY + util_walk_f + self._noise(0.004)
        else:
            v_util, f_util = 0.0, 0.0
        util_ok = v_util >= 0.80 * 480.0  # ATS normal source dropout

        if util_ok:
            self._util_bad_since = None
            if self._util_good_since is None:
                self._util_good_since = now
        else:
            self._util_good_since = None
            if self._util_bad_since is None:
                self._util_bad_since = now

        # --- Generator and ATS controller -----------------------------------
        start_signal = (self._util_bad_since is not None and now - self._util_bad_since >= _GEN_START_DELAY) \
            or self.ats_position == "GENERATOR"

        if self.gen_state == "STANDBY" and start_signal:
            self.gen_state, self._gen_since = "CRANKING", now
        elif self.gen_state == "CRANKING":
            if not start_signal:
                self.gen_state, self._gen_since = "STANDBY", now
            elif now - self._gen_since >= _GEN_CRANK_TIME:
                self.gen_state, self._gen_since = "RUNNING", now
                self._gen_running_since = now
        elif self.gen_state == "RUNNING" and not start_signal and self.ats_position == "UTILITY":
            self.gen_state, self._gen_since = "COOLDOWN", now
        elif self.gen_state == "COOLDOWN":
            if start_signal:
                self.gen_state, self._gen_since = "RUNNING", now
                self._gen_running_since = now
            elif now - self._gen_since >= _GEN_COOLDOWN:
                self.gen_state, self._gen_since = "STANDBY", now
                self._gen_running_since = None

        gen_running = self.gen_state in ("RUNNING", "COOLDOWN")
        if self.ats_position == "UTILITY" and not util_ok and self.gen_state == "RUNNING" \
                and now - self._gen_running_since >= _ATS_GEN_STABLE:
            self.ats_position, self._transfer_at = "GENERATOR", now
        elif self.ats_position == "GENERATOR" and util_ok \
                and now - self._util_good_since >= _ATS_RETRANSFER:
            self.ats_position, self._transfer_at = "UTILITY", now

        gen_walk_v = self._ou("gen_v", dt, 1.5, 60)
        if gen_running:
            v_gen = 480.0 + gen_walk_v + self._noise(0.8)
            f_gen = NOMINAL_FREQUENCY + self._noise(0.04)
            if self.ats_position == "GENERATOR" and self._transfer_at is not None:
                since = now - self._transfer_at
                if since < 6.0:  # frequency dip from the block load step
                    f_gen -= 1.2 * math.exp(-since / 1.5)
        elif self.gen_state == "CRANKING":
            ramp = min(1.0, (now - self._gen_since) / _GEN_CRANK_TIME)
            v_gen, f_gen = 480.0 * ramp, NOMINAL_FREQUENCY * ramp
        else:
            v_gen, f_gen = 0.0, 0.0

        if self.ats_position == "UTILITY":
            v_src, f_src = v_util, f_util
        else:
            v_src, f_src = v_gen, f_gen
        src_live = v_src >= 0.5 * 480.0
        if src_live:
            if self._source_ok_since is None:
                self._source_ok_since = now
        else:
            self._source_ok_since = None

        # --- PDUs (IT load) --------------------------------------------------
        readings: Dict[str, Dict[str, Any]] = {}
        overload_t = self._scenario_elapsed("pdu_overload", now)
        ups_out: Dict[str, Dict[str, float]] = {"UPS-A": {"kw": 0.0, "kvar": 0.0},
                                                 "UPS-B": {"kw": 0.0, "kvar": 0.0}}
        it_total = 0.0
        for pdu, base in _PDU_BASE_KW.items():
            cfg = METERS_BY_ID[pdu]
            walk = self._ou(pdu, dt, 0.025, 1800)
            kw = base * it_profile * (1 + walk) * (1 + self._noise(0.006))
            if overload_t is not None and self.scenario["params"]["pdu"] == pdu:
                p = self.scenario["params"]
                target_kw = cfg["rated_kva"] * p["target_pct"] / 100.0 * 0.98
                shape = min(1.0, overload_t / p["ramp"],
                            max(0.0, (p["duration"] - overload_t) / p["ramp"]))
                kw = kw * (1 - shape) + target_kw * shape
            pf = min(0.995, 0.98 + self._noise(0.003))
            kva = kw / pf
            v = 208.0 * (1 - 0.012 * kva / cfg["rated_kva"]) + self._noise(0.25)
            side = "UPS-A" if pdu.startswith("PDU-A") else "UPS-B"
            kw_in = kw / _PDU_EFFICIENCY
            ups_out[side]["kw"] += kw_in
            ups_out[side]["kvar"] += kw_in * math.tan(math.acos(0.97))
            it_total += kw
            readings[pdu] = self._reading(pdu, now, dt, v, kva, kw, pf, f_src or NOMINAL_FREQUENCY,
                                          status="Normal")

        # --- UPS -------------------------------------------------------------
        input_ok = 0.88 * 480.0 <= v_src <= 1.12 * 480.0 and 55.0 <= f_src <= 65.0
        ups_in_kw = 0.0
        for side, st in self.ups.items():
            cfg = METERS_BY_ID[side]
            if input_ok:
                if st["input_ok_since"] is None:
                    st["input_ok_since"] = now
            else:
                st["input_ok_since"] = None
            st["on_battery"] = st["input_ok_since"] is None or now - st["input_ok_since"] < _UPS_WALK_IN

            out_kw = ups_out[side]["kw"]
            out_kva = math.hypot(out_kw, ups_out[side]["kvar"])
            if st["on_battery"]:
                st["soc"] = max(0.0, st["soc"] - out_kw / 0.96 * dt / 3600.0 / _UPS_BATTERY_KWH * 100.0)
                in_kw = 0.0
            else:
                charge = _UPS_CHARGE_KW if st["soc"] < 100.0 else 0.0
                st["soc"] = min(100.0, st["soc"] + charge * dt / 3600.0 / _UPS_BATTERY_KWH * 100.0)
                in_kw = out_kw / _UPS_EFFICIENCY + charge
            ups_in_kw += in_kw
            runtime = st["soc"] / 100.0 * _UPS_BATTERY_KWH / max(out_kw, 1.0) * 60.0
            v_out = 480.0 + self._noise(0.4)
            readings[side] = self._reading(
                side, now, dt, v_out, out_kva, out_kw, out_kw / out_kva if out_kva else 1.0,
                NOMINAL_FREQUENCY if st["on_battery"] else (f_src or NOMINAL_FREQUENCY),
                status="On Battery" if st["on_battery"] else "Online",
                on_battery=st["on_battery"], battery_soc=round(st["soc"], 1),
                battery_runtime_min=round(runtime, 1), input_kw=round(in_kw, 1),
            )

        # --- Mechanical panel (not on UPS) -----------------------------------
        cfg = METERS_BY_ID["MECH-1"]
        mech_walk = self._ou("mech", dt, 0.04, 900)
        pf_walk = self._ou("mech_pf", dt, 0.008, 300)
        mech_pf = 0.90 + pf_walk + self._noise(0.002)
        pf_t = self._scenario_elapsed("pf_drop", now)
        if pf_t is not None:
            p = self.scenario["params"]
            shape = min(1.0, pf_t / 10.0, max(0.0, (p["duration"] - pf_t) / 10.0))
            mech_pf = mech_pf * (1 - shape) + (p["pf"] + self._noise(0.004)) * shape
        if src_live:
            if self._mech_restart_since is not None:
                ramp = min(1.0, (now - self._mech_restart_since) / _MECH_RESTART)
                if ramp >= 1.0:
                    self._mech_restart_since = None
            else:
                ramp = 1.0
            mech_kw = _MECH_RATIO * it_total * temp_profile * (1 + mech_walk) * ramp
            mech_status = "Restarting" if ramp < 1.0 else "Normal"
            house_kw = _HOUSE_KW
        else:
            self._mech_restart_since = now
            mech_kw, house_kw, mech_status = 0.0, 0.0, "De-energized"
        mech_kva = mech_kw / mech_pf
        mech_v = v_src * (1 - 0.006 * mech_kva / cfg["rated_kva"]) if src_live else 0.0
        readings["MECH-1"] = self._reading("MECH-1", now, dt, mech_v, mech_kva, mech_kw,
                                           mech_pf if mech_kw > 0 else 0.0, f_src, status=mech_status)

        # --- Main switchboard and ATS ----------------------------------------
        total_kw = ups_in_kw + mech_kw + house_kw
        total_kvar = ups_in_kw * math.tan(math.acos(0.99)) \
            + mech_kw * math.tan(math.acos(max(mech_pf, 0.5))) \
            + house_kw * math.tan(math.acos(0.95))
        total_kva = math.hypot(total_kw, total_kvar)
        msb_pf = total_kw / total_kva if total_kva else 0.0
        msb_v = v_src * (1 - 0.004 * total_kva / 1330.0) if src_live else 0.0
        readings["MSB-1"] = self._reading("MSB-1", now, dt, msb_v, total_kva, total_kw, msb_pf, f_src,
                                          status="Energized" if src_live else "De-energized")
        on_gen = self.ats_position == "GENERATOR"
        readings["ATS-1"] = self._reading(
            "ATS-1", now, dt, v_src, total_kva, total_kw, msb_pf, f_src,
            status="On Generator" if on_gen else "On Utility",
            position=self.ats_position, on_emergency=on_gen,
        )

        # --- Sources ---------------------------------------------------------
        util_load = (total_kva, total_kw, msb_pf) if not on_gen else (0.0, 0.0, 0.0)
        util_status = "Failed" if not util_available else ("Sag" if v_factor < 1.0 else "Normal")
        readings["UTIL-1"] = self._reading("UTIL-1", now, dt, v_util, *util_load, f_util,
                                           status=util_status, source_failed=not util_available)
        gen_load = (total_kva, total_kw, msb_pf) if on_gen else (0.0, 0.0, 0.0)
        readings["GEN-1"] = self._reading("GEN-1", now, dt, v_gen, *gen_load, f_gen,
                                          status=self.gen_state.title(),
                                          running=self.gen_state == "RUNNING",
                                          gen_state=self.gen_state)

        return {m["id"]: readings[m["id"]] for m in METERS}

    def _reading(self, mid: str, now: float, dt: float, voltage: float, kva: float, kw: float,
                 pf: float, freq: float, status: str, **extra) -> Dict[str, Any]:
        cfg = METERS_BY_ID[mid]
        current = kva * 1000.0 / (SQRT3 * voltage) if voltage > 1.0 else 0.0
        energy, demand = self._register(mid, kw, dt)
        return {
            "meter_id": mid,
            "timestamp": _iso(now),
            "epoch": round(now, 3),
            "voltage": round(max(voltage, 0.0), 1),
            "current": round(current, 1),
            "power_kw": round(kw, 1),
            "power_factor": round(pf, 3),
            "frequency": round(max(freq, 0.0), 2),
            "energy_kwh": round(energy, 1),
            "demand_kw": round(demand, 1),
            "load_pct": round(current / cfg["rated_current"] * 100.0, 1),
            "status": status,
            **extra,
        }
