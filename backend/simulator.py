"""Modbus device simulator for Power Dashboard.

Generates realistic electrical meter readings using sine-wave modulation,
Gaussian noise, and occasional fault injection to simulate real power meters.
"""

import math
import random
import time
from datetime import datetime, timezone
from typing import Dict, Any

from config import METERS


class MeterSimulator:
    """Simulates a single power meter with realistic electrical values."""

    def __init__(self, meter_cfg: dict):
        self.meter_id = meter_cfg["id"]
        self.name = meter_cfg["name"]
        self.nominal_voltage = meter_cfg["nominal_voltage"]
        self.nominal_current = meter_cfg["nominal_current"]

        # Internal state
        self._energy_kwh = random.uniform(1000, 50000)
        self._phase_offset = random.uniform(0, 2 * math.pi)
        self._drift = 0.0
        self._fault_active = False
        self._fault_type = None
        self._fault_counter = 0
        self._last_demand_window = []
        self._start_time = time.time()

        # Load profile: base load as fraction of nominal
        self._base_load = random.uniform(0.45, 0.72)

    def _inject_fault(self):
        """Occasionally inject a fault condition."""
        if not self._fault_active and random.random() < 0.0015:
            self._fault_type = random.choice([
                "voltage_sag", "current_spike", "pf_drop", "freq_deviation"
            ])
            self._fault_active = True
            self._fault_counter = random.randint(3, 12)

        if self._fault_active:
            self._fault_counter -= 1
            if self._fault_counter <= 0:
                self._fault_active = False
                self._fault_type = None

    def read(self) -> Dict[str, Any]:
        """Return a simulated meter reading."""
        self._inject_fault()

        t = time.time() - self._start_time

        # Base voltage: 480V nominal with slow sine oscillation + noise
        v_swing = math.sin(t / 47 + self._phase_offset) * 3.5
        v_noise = random.gauss(0, 0.4)
        voltage = self.nominal_voltage + v_swing + v_noise

        # Current: follows a daily load profile approximated with a sine wave
        load_cycle = 0.82 + 0.18 * math.sin(t / 3600 * math.pi - math.pi / 2)
        i_base = self.nominal_current * self._base_load * load_cycle
        i_noise = random.gauss(0, i_base * 0.015)
        current = max(0.0, i_base + i_noise)

        # Power factor
        pf_base = 0.92 + math.sin(t / 120 + self._phase_offset) * 0.025
        pf = min(1.0, max(0.70, pf_base + random.gauss(0, 0.005)))

        # Frequency
        freq = 60.0 + math.sin(t / 23) * 0.08 + random.gauss(0, 0.03)

        # Apply faults
        if self._fault_active:
            ft = self._fault_type
            p = self._fault_counter / 12
            if ft == "voltage_sag":
                voltage *= (0.88 + 0.07 * p)
            elif ft == "current_spike":
                current *= (1.25 - 0.15 * p)
            elif ft == "pf_drop":
                pf *= (0.78 + 0.12 * p)
            elif ft == "freq_deviation":
                freq += (0.6 - 0.3 * p) * random.choice([-1, 1])

        # Power
        power_kw = (voltage * current * pf * math.sqrt(3)) / 1000.0

        # Demand (15-minute rolling average approximation)
        self._last_demand_window.append(power_kw)
        if len(self._last_demand_window) > 180:
            self._last_demand_window.pop(0)
        demand_kw = sum(self._last_demand_window) / len(self._last_demand_window)

        # Energy accumulation
        self._energy_kwh += power_kw * (5 / 3600)

        return {
            "meter_id": self.meter_id,
            "voltage": round(voltage, 2),
            "current": round(current, 2),
            "power_kw": round(power_kw, 2),
            "power_factor": round(pf, 4),
            "energy_kwh": round(self._energy_kwh, 2),
            "frequency": round(freq, 3),
            "demand_kw": round(demand_kw, 2),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


class DeviceSimulator:
    """Manages all meter simulators."""

    def __init__(self):
        self._meters: Dict[int, MeterSimulator] = {}
        for cfg in METERS:
            self._meters[cfg["id"]] = MeterSimulator(cfg)

    def read_all(self) -> Dict[int, Dict[str, Any]]:
        return {mid: m.read() for mid, m in self._meters.items()}

    def read_meter(self, meter_id: int) -> Dict[str, Any]:
        if meter_id not in self._meters:
            raise ValueError(f"Meter {meter_id} not found")
        return self._meters[meter_id].read()
