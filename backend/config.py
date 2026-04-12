"""System configuration for Power Dashboard."""

# Polling interval in seconds
POLL_INTERVAL = 5

# Database
DB_PATH = "power_dashboard.db"

# WebSocket broadcast interval (seconds)
WS_INTERVAL = 2

# Meter hierarchy definition
METERS = [
    {
        "id": 1,
        "name": "Utility Feed",
        "description": "Main utility supply point",
        "type": "utility",
        "parent_id": None,
        "nominal_voltage": 480.0,
        "nominal_current": 800.0,
        "ct_ratio": 800,
        "pt_ratio": 1,
    },
    {
        "id": 2,
        "name": "Main Switchgear",
        "description": "Main distribution switchgear",
        "type": "switchgear",
        "parent_id": 1,
        "nominal_voltage": 480.0,
        "nominal_current": 750.0,
        "ct_ratio": 750,
        "pt_ratio": 1,
    },
    {
        "id": 3,
        "name": "Panel A",
        "description": "Distribution Panel A - IT Load",
        "type": "panel",
        "parent_id": 2,
        "nominal_voltage": 480.0,
        "nominal_current": 400.0,
        "ct_ratio": 400,
        "pt_ratio": 1,
    },
    {
        "id": 4,
        "name": "Panel B",
        "description": "Distribution Panel B - Cooling Load",
        "type": "panel",
        "parent_id": 2,
        "nominal_voltage": 480.0,
        "nominal_current": 350.0,
        "ct_ratio": 350,
        "pt_ratio": 1,
    },
    {
        "id": 5,
        "name": "Server Row A1",
        "description": "Server row PDU - Rack group A1",
        "type": "meter",
        "parent_id": 3,
        "nominal_voltage": 480.0,
        "nominal_current": 120.0,
        "ct_ratio": 120,
        "pt_ratio": 1,
    },
    {
        "id": 6,
        "name": "Server Row A2",
        "description": "Server row PDU - Rack group A2",
        "type": "meter",
        "parent_id": 3,
        "nominal_voltage": 480.0,
        "nominal_current": 120.0,
        "ct_ratio": 120,
        "pt_ratio": 1,
    },
    {
        "id": 7,
        "name": "CRAC Unit 1",
        "description": "Computer Room Air Conditioner 1",
        "type": "meter",
        "parent_id": 4,
        "nominal_voltage": 480.0,
        "nominal_current": 180.0,
        "ct_ratio": 180,
        "pt_ratio": 1,
    },
    {
        "id": 8,
        "name": "CRAC Unit 2",
        "description": "Computer Room Air Conditioner 2",
        "type": "meter",
        "parent_id": 4,
        "nominal_voltage": 480.0,
        "nominal_current": 170.0,
        "ct_ratio": 170,
        "pt_ratio": 1,
    },
]

# Alarm thresholds per meter type
ALARM_THRESHOLDS = {
    "voltage_high_critical": 1.10,   # 110% of nominal
    "voltage_high_warning":  1.05,   # 105% of nominal
    "voltage_low_warning":   0.95,   # 95% of nominal
    "voltage_low_critical":  0.90,   # 90% of nominal
    "current_high_critical": 1.00,   # 100% of nominal (full load)
    "current_high_warning":  0.85,   # 85% of nominal
    "pf_low_warning":        0.85,   # Power factor warning
    "pf_low_critical":       0.75,   # Power factor critical
    "freq_high_warning":     60.5,   # Hz
    "freq_high_critical":    61.0,   # Hz
    "freq_low_warning":      59.5,   # Hz
    "freq_low_critical":     59.0,   # Hz
}

# ISA 18.2 Priority labels
ALARM_PRIORITIES = {
    1: "Critical",
    2: "High",
    3: "Medium",
    4: "Low",
}
