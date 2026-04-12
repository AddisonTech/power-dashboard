"""Alarm processing engine aligned with ISA 18.2 principles."""

from typing import Dict, Any
from config import ALARM_THRESHOLDS, METERS
from database import upsert_alarm, clear_alarm

# Build nominal lookup from config
_NOMINALS = {m["id"]: m for m in METERS}


def _get_nominal(meter_id: int, key: str) -> float:
    return _NOMINALS[meter_id][key]


def process_reading(reading: Dict[str, Any]):
    """Evaluate a single reading against alarm thresholds."""
    mid = reading["meter_id"]
    nom_v = _get_nominal(mid, "nominal_voltage")
    nom_i = _get_nominal(mid, "nominal_current")

    v = reading["voltage"]
    i = reading["current"]
    pf = reading["power_factor"]
    freq = reading["frequency"]

    t = ALARM_THRESHOLDS

    # --- Voltage alarms ---
    if v > nom_v * t["voltage_high_critical"]:
        upsert_alarm(mid, "voltage", "High Voltage Critical",
                     v, nom_v * t["voltage_high_critical"], priority=1)
    elif v > nom_v * t["voltage_high_warning"]:
        upsert_alarm(mid, "voltage", "High Voltage Warning",
                     v, nom_v * t["voltage_high_warning"], priority=2)
        clear_alarm(mid, "voltage")  # clear critical if only warning now
    elif v < nom_v * t["voltage_low_critical"]:
        upsert_alarm(mid, "voltage", "Low Voltage Critical",
                     v, nom_v * t["voltage_low_critical"], priority=1)
    elif v < nom_v * t["voltage_low_warning"]:
        upsert_alarm(mid, "voltage", "Low Voltage Warning",
                     v, nom_v * t["voltage_low_warning"], priority=2)
    else:
        clear_alarm(mid, "voltage")

    # --- Current alarms ---
    if i > nom_i * t["current_high_critical"]:
        upsert_alarm(mid, "current", "Overcurrent Critical",
                     i, nom_i * t["current_high_critical"], priority=1)
    elif i > nom_i * t["current_high_warning"]:
        upsert_alarm(mid, "current", "High Current Warning",
                     i, nom_i * t["current_high_warning"], priority=2)
    else:
        clear_alarm(mid, "current")

    # --- Power factor alarms ---
    if pf < t["pf_low_critical"]:
        upsert_alarm(mid, "power_factor", "Low Power Factor Critical",
                     pf, t["pf_low_critical"], priority=1)
    elif pf < t["pf_low_warning"]:
        upsert_alarm(mid, "power_factor", "Low Power Factor Warning",
                     pf, t["pf_low_warning"], priority=3)
    else:
        clear_alarm(mid, "power_factor")

    # --- Frequency alarms ---
    if freq > t["freq_high_critical"] or freq < t["freq_low_critical"]:
        upsert_alarm(mid, "frequency", "Frequency Deviation Critical",
                     freq, 60.0, priority=1)
    elif freq > t["freq_high_warning"] or freq < t["freq_low_warning"]:
        upsert_alarm(mid, "frequency", "Frequency Deviation Warning",
                     freq, 60.0, priority=3)
    else:
        clear_alarm(mid, "frequency")
