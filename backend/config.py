"""System configuration for Power Dashboard.

Runtime settings come from environment variables so the same code runs the
public demo (simulated data) and a real site (Modbus TCP polling).
"""

import os

VERSION = "1.1.0"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    return float(raw) if raw not in (None, "") else default


# ---------------------------------------------------------------------------
# Runtime settings
# ---------------------------------------------------------------------------

# "simulator" (default, used by the public demo) or "modbus"
DATA_SOURCE = os.getenv("DATA_SOURCE", "simulator").strip().lower()

# Path to the Modbus device map (only used when DATA_SOURCE=modbus)
MODBUS_CONFIG = os.getenv("MODBUS_CONFIG", "modbus_config.json")

# Scan rate for the live feed and alarm evaluation (seconds)
POLL_INTERVAL = _env_float("POLL_INTERVAL", 2.0)

# How often a scan is written to the history table (seconds)
HISTORY_INTERVAL = _env_float("HISTORY_INTERVAL", 10.0)

# SQLite database file
DB_PATH = os.getenv("DB_PATH", "power_dashboard.db")

# Days of readings kept before pruning
RETENTION_DAYS = int(_env_float("RETENTION_DAYS", 7))

# Simulator: hours of history generated on startup so trends are never empty
BACKFILL_HOURS = _env_float("BACKFILL_HOURS", 24)

# Simulator: seconds between automatic demo events (min, max)
SIM_EVENT_MIN = _env_float("SIM_EVENT_MIN", 150)
SIM_EVENT_MAX = _env_float("SIM_EVENT_MAX", 360)

# Simulator: delay before the first live event after startup (seconds)
SIM_FIRST_EVENT = _env_float("SIM_FIRST_EVENT", 25)

# Simulator: optional fixed random seed for repeatable runs
SIM_SEED = os.getenv("SIM_SEED")

# Allow visitors to trigger demo events from the UI (simulator only)
DEMO_EVENTS_ENABLED = _env_bool("DEMO_EVENTS_ENABLED", True)

# Comma separated list of allowed browser origins, "*" for any
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# ISA 18.2 shelving is time limited. Durations offered to the operator (minutes)
SHELVE_DURATIONS_MIN = [5, 15, 60]
SHELVE_MAX_MIN = 60

# Nominal system frequency
NOMINAL_FREQUENCY = 60.0


# ---------------------------------------------------------------------------
# Facility topology
#
# A small 2N data center: utility service and standby generator feed an
# automatic transfer switch, which feeds the main switchboard. Two UPS
# systems (A side and B side) each feed two PDUs. Mechanical (cooling) load
# is fed directly from the switchboard.
# ---------------------------------------------------------------------------

METERS = [
    {
        "id": "UTIL-1", "name": "Utility Service", "type": "utility", "parent_id": None,
        "description": "Utility service entrance, 480 V secondary of the service transformer",
        "nominal_voltage": 480.0, "rated_current": 1600.0, "rated_kva": 1330.0,
    },
    {
        "id": "GEN-1", "name": "Standby Generator", "type": "generator", "parent_id": None,
        "description": "750 kW diesel standby generator",
        "nominal_voltage": 480.0, "rated_current": 1128.0, "rated_kva": 937.5,
    },
    {
        "id": "ATS-1", "name": "Automatic Transfer Switch", "type": "ats", "parent_id": None,
        "description": "Open transition ATS, utility normal / generator emergency",
        "nominal_voltage": 480.0, "rated_current": 1600.0, "rated_kva": 1330.0,
    },
    {
        "id": "MSB-1", "name": "Main Switchboard", "type": "switchgear", "parent_id": "ATS-1",
        "description": "480 V main switchboard",
        "nominal_voltage": 480.0, "rated_current": 1600.0, "rated_kva": 1330.0,
    },
    {
        "id": "UPS-A", "name": "UPS A", "type": "ups", "parent_id": "MSB-1",
        "description": "400 kVA double conversion UPS, A side",
        "nominal_voltage": 480.0, "rated_current": 481.0, "rated_kva": 400.0,
    },
    {
        "id": "UPS-B", "name": "UPS B", "type": "ups", "parent_id": "MSB-1",
        "description": "400 kVA double conversion UPS, B side",
        "nominal_voltage": 480.0, "rated_current": 481.0, "rated_kva": 400.0,
    },
    {
        "id": "MECH-1", "name": "Mechanical Panel", "type": "panel", "parent_id": "MSB-1",
        "description": "Cooling plant: CRAH units, pumps, condenser fans",
        "nominal_voltage": 480.0, "rated_current": 400.0, "rated_kva": 332.0,
    },
    {
        "id": "PDU-A1", "name": "PDU A1", "type": "pdu", "parent_id": "UPS-A",
        "description": "150 kVA PDU, 480 to 208/120 V, server rows 1 and 2",
        "nominal_voltage": 208.0, "rated_current": 416.0, "rated_kva": 150.0,
    },
    {
        "id": "PDU-A2", "name": "PDU A2", "type": "pdu", "parent_id": "UPS-A",
        "description": "150 kVA PDU, 480 to 208/120 V, server rows 3 and 4",
        "nominal_voltage": 208.0, "rated_current": 416.0, "rated_kva": 150.0,
    },
    {
        "id": "PDU-B1", "name": "PDU B1", "type": "pdu", "parent_id": "UPS-B",
        "description": "150 kVA PDU, 480 to 208/120 V, server rows 1 and 2",
        "nominal_voltage": 208.0, "rated_current": 416.0, "rated_kva": 150.0,
    },
    {
        "id": "PDU-B2", "name": "PDU B2", "type": "pdu", "parent_id": "UPS-B",
        "description": "150 kVA PDU, 480 to 208/120 V, server rows 3 and 4",
        "nominal_voltage": 208.0, "rated_current": 416.0, "rated_kva": 150.0,
    },
]

METERS_BY_ID = {m["id"]: m for m in METERS}


# ---------------------------------------------------------------------------
# Alarm priorities (ISA 18.2: priority reflects consequence severity and the
# time available for the operator to respond)
# ---------------------------------------------------------------------------

ALARM_PRIORITIES = {
    1: {"label": "Critical", "response": "Respond immediately (under 5 min)"},
    2: {"label": "High", "response": "Respond promptly (under 15 min)"},
    3: {"label": "Medium", "response": "Respond within the shift (under 1 h)"},
    4: {"label": "Low", "response": "Respond when practical"},
}


# ---------------------------------------------------------------------------
# Master alarm database
#
# Each alarm was rationalized: one alarm per abnormal condition that needs an
# operator response, with a documented consequence and corrective action.
#
#   kind      HI / HIHI / LO / LOLO compare an analog value to a setpoint.
#             DISCRETE alarms when the value is true.
#   deadband  hysteresis in engineering units before the alarm can clear
#   on_delay  consecutive scans in alarm before annunciating (anti-chatter)
#   off_delay consecutive scans normal before returning to normal
#   suppress  designed (state based) suppression rule, see alarms.py
# ---------------------------------------------------------------------------

def _pdu_alarms(pdu: str):
    return [
        {
            "tag": f"{pdu}.LOAD.HI", "meter_id": pdu, "parameter": "load_pct", "kind": "HI",
            "setpoint": 80.0, "deadband": 3.0, "priority": 3, "on_delay": 2, "off_delay": 2,
            "unit": "%",
            "message": f"{pdu} load high",
            "consequence": "Reduced margin before the PDU main breaker trips.",
            "response": "Check for new rack load or a failed partner PDU. Plan load rebalancing.",
        },
        {
            "tag": f"{pdu}.LOAD.HIHI", "meter_id": pdu, "parameter": "load_pct", "kind": "HIHI",
            "setpoint": 90.0, "deadband": 3.0, "priority": 2, "on_delay": 2, "off_delay": 2,
            "unit": "%",
            "message": f"{pdu} load very high",
            "consequence": "PDU breaker trip drops every server on this side.",
            "response": "Shed or move load now. Confirm the partner PDU can carry the racks.",
        },
    ]


def _ups_alarms(ups: str):
    return [
        {
            "tag": f"{ups}.ONBATT", "meter_id": ups, "parameter": "on_battery", "kind": "DISCRETE",
            "setpoint": 1, "deadband": 0, "priority": 1, "on_delay": 0, "off_delay": 1,
            "unit": "",
            "message": f"{ups} on battery",
            "consequence": "Critical load is on limited battery runtime.",
            "response": "Verify generator start and ATS transfer. Watch battery runtime.",
        },
        {
            "tag": f"{ups}.LOAD.HI", "meter_id": ups, "parameter": "load_pct", "kind": "HI",
            "setpoint": 50.0, "deadband": 2.0, "priority": 2, "on_delay": 2, "off_delay": 2,
            "unit": "%",
            "message": f"{ups} load above 2N limit",
            "consequence": "If the other side fails, this UPS cannot carry the full IT load.",
            "response": "Rebalance IT load between A and B sides below 50 percent each.",
        },
        {
            "tag": f"{ups}.BATT.LO", "meter_id": ups, "parameter": "battery_soc", "kind": "LO",
            "setpoint": 60.0, "deadband": 5.0, "priority": 2, "on_delay": 1, "off_delay": 2,
            "unit": "%",
            "message": f"{ups} battery charge low",
            "consequence": "Reduced ride through time on the next utility event.",
            "response": "Confirm the rectifier is charging. Avoid planned transfers until recharged.",
        },
    ]


ALARM_POINTS = [
    {
        "tag": "UTIL-1.FAIL", "meter_id": "UTIL-1", "parameter": "source_failed", "kind": "DISCRETE",
        "setpoint": 1, "deadband": 0, "priority": 2, "on_delay": 0, "off_delay": 1,
        "unit": "",
        "message": "Utility power failure",
        "consequence": "Facility is running on UPS battery and standby generator.",
        "response": "Confirm generator pickup. Notify the utility and facility manager.",
    },
    {
        "tag": "UTIL-1.V.LO", "meter_id": "UTIL-1", "parameter": "voltage", "kind": "LO",
        "setpoint": 432.0, "deadband": 4.8, "priority": 3, "on_delay": 0, "off_delay": 1,
        "unit": "V",
        "message": "Utility voltage low (sag)",
        "consequence": "UPS may transfer to battery. Motors may drop out.",
        "response": "Check UPS mode and mechanical equipment restart.",
        "suppress": {"meter_id": "UTIL-1", "parameter": "source_failed", "equals": True,
                     "reason": "Utility failure alarm is active (cascade suppression)"},
    },
    {
        "tag": "GEN-1.F.LO", "meter_id": "GEN-1", "parameter": "frequency", "kind": "LO",
        "setpoint": 59.5, "deadband": 0.1, "priority": 3, "on_delay": 0, "off_delay": 1,
        "unit": "Hz",
        "message": "Generator frequency low",
        "consequence": "UPS may stay on battery if frequency is out of tolerance.",
        "response": "Check generator governor and block load step.",
        "suppress": {"meter_id": "GEN-1", "parameter": "running", "equals": False,
                     "reason": "Generator not running (state based suppression)"},
    },
    {
        "tag": "ATS-1.EMERG", "meter_id": "ATS-1", "parameter": "on_emergency", "kind": "DISCRETE",
        "setpoint": 1, "deadband": 0, "priority": 3, "on_delay": 0, "off_delay": 1,
        "unit": "",
        "message": "ATS on emergency source",
        "consequence": "Facility depends on generator fuel and runtime.",
        "response": "Check fuel level and generator load. Track utility restoration.",
    },
    {
        "tag": "MSB-1.LOAD.HI", "meter_id": "MSB-1", "parameter": "load_pct", "kind": "HI",
        "setpoint": 80.0, "deadband": 3.0, "priority": 3, "on_delay": 3, "off_delay": 3,
        "unit": "%",
        "message": "Main switchboard load high",
        "consequence": "Main breaker approaching continuous rating.",
        "response": "Review facility load growth and defer non critical load.",
    },
    *_ups_alarms("UPS-A"),
    *_ups_alarms("UPS-B"),
    {
        "tag": "MECH-1.PF.LO", "meter_id": "MECH-1", "parameter": "power_factor", "kind": "LO",
        "setpoint": 0.85, "deadband": 0.01, "priority": 4, "on_delay": 2, "off_delay": 2,
        "unit": "",
        "message": "Mechanical panel power factor low",
        "consequence": "Higher current and possible utility power factor penalty.",
        "response": "Check the capacitor bank and VFD bypass status.",
    },
    {
        "tag": "MECH-1.LOAD.HI", "meter_id": "MECH-1", "parameter": "load_pct", "kind": "HI",
        "setpoint": 85.0, "deadband": 3.0, "priority": 3, "on_delay": 3, "off_delay": 3,
        "unit": "%",
        "message": "Mechanical panel load high",
        "consequence": "Cooling plant near feeder capacity.",
        "response": "Check for stuck dampers or a failed CRAH unit forcing others to full speed.",
    },
    *_pdu_alarms("PDU-A1"),
    *_pdu_alarms("PDU-A2"),
    *_pdu_alarms("PDU-B1"),
    *_pdu_alarms("PDU-B2"),
]
