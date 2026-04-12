"""Database layer for Power Dashboard using SQLite."""

import sqlite3
import json
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from config import DB_PATH, METERS


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db():
    """Initialize database schema."""
    conn = get_connection()
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS meters (
            id          INTEGER PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            type        TEXT,
            parent_id   INTEGER,
            nominal_voltage REAL,
            nominal_current REAL,
            ct_ratio    INTEGER,
            pt_ratio    INTEGER,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS readings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            meter_id    INTEGER NOT NULL,
            voltage     REAL,
            current     REAL,
            power_kw    REAL,
            power_factor REAL,
            energy_kwh  REAL,
            frequency   REAL,
            demand_kw   REAL,
            timestamp   TEXT NOT NULL,
            FOREIGN KEY (meter_id) REFERENCES meters(id)
        );

        CREATE INDEX IF NOT EXISTS idx_readings_meter_ts
            ON readings(meter_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS alarms (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            meter_id        INTEGER NOT NULL,
            parameter       TEXT NOT NULL,
            condition       TEXT NOT NULL,
            value           REAL NOT NULL,
            threshold       REAL NOT NULL,
            priority        INTEGER NOT NULL,
            state           TEXT NOT NULL DEFAULT 'active',
            acknowledged    INTEGER NOT NULL DEFAULT 0,
            ack_time        TEXT,
            ack_by          TEXT,
            raised_at       TEXT NOT NULL,
            cleared_at      TEXT,
            FOREIGN KEY (meter_id) REFERENCES meters(id)
        );

        CREATE INDEX IF NOT EXISTS idx_alarms_state
            ON alarms(state, meter_id);
    """)

    # Seed meter definitions
    for m in METERS:
        cur.execute("""
            INSERT OR IGNORE INTO meters
                (id, name, description, type, parent_id, nominal_voltage, nominal_current, ct_ratio, pt_ratio)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (m["id"], m["name"], m["description"], m["type"], m["parent_id"],
              m["nominal_voltage"], m["nominal_current"], m["ct_ratio"], m["pt_ratio"]))

    conn.commit()
    conn.close()


def insert_reading(reading: Dict[str, Any]):
    conn = get_connection()
    conn.execute("""
        INSERT INTO readings (meter_id, voltage, current, power_kw, power_factor,
                              energy_kwh, frequency, demand_kw, timestamp)
        VALUES (:meter_id, :voltage, :current, :power_kw, :power_factor,
                :energy_kwh, :frequency, :demand_kw, :timestamp)
    """, reading)
    conn.commit()
    conn.close()


def get_latest_readings() -> List[Dict]:
    conn = get_connection()
    rows = conn.execute("""
        SELECT r.*, m.name AS meter_name, m.type, m.parent_id,
               m.nominal_voltage, m.nominal_current
        FROM readings r
        JOIN meters m ON m.id = r.meter_id
        WHERE r.id IN (
            SELECT MAX(id) FROM readings GROUP BY meter_id
        )
        ORDER BY m.id
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_meter_history(meter_id: int, period: str = "1h") -> List[Dict]:
    period_map = {"1h": "1 hours", "24h": "24 hours", "7d": "7 days"}
    interval = period_map.get(period, "1 hours")
    conn = get_connection()
    rows = conn.execute(f"""
        SELECT * FROM readings
        WHERE meter_id = ?
          AND timestamp >= datetime('now', '-{interval}')
        ORDER BY timestamp ASC
    """, (meter_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_meters() -> List[Dict]:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM meters ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def upsert_alarm(meter_id: int, parameter: str, condition: str,
                 value: float, threshold: float, priority: int) -> Optional[int]:
    """Insert new alarm if one does not already exist for this meter+parameter."""
    conn = get_connection()
    existing = conn.execute("""
        SELECT id FROM alarms
        WHERE meter_id=? AND parameter=? AND state='active'
    """, (meter_id, parameter)).fetchone()

    if existing:
        conn.close()
        return existing["id"]

    now = datetime.now(timezone.utc).isoformat()
    cur = conn.execute("""
        INSERT INTO alarms (meter_id, parameter, condition, value, threshold, priority, state, raised_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    """, (meter_id, parameter, condition, value, threshold, priority, now))
    alarm_id = cur.lastrowid
    conn.commit()
    conn.close()
    return alarm_id


def clear_alarm(meter_id: int, parameter: str):
    """Clear active alarm when condition resolves."""
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    conn.execute("""
        UPDATE alarms SET state='cleared', cleared_at=?
        WHERE meter_id=? AND parameter=? AND state='active'
    """, (now, meter_id, parameter))
    conn.commit()
    conn.close()


def get_active_alarms() -> List[Dict]:
    conn = get_connection()
    rows = conn.execute("""
        SELECT a.*, m.name AS meter_name
        FROM alarms a JOIN meters m ON m.id = a.meter_id
        WHERE a.state = 'active'
        ORDER BY a.priority ASC, a.raised_at DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_alarm_history(limit: int = 200) -> List[Dict]:
    conn = get_connection()
    rows = conn.execute("""
        SELECT a.*, m.name AS meter_name
        FROM alarms a JOIN meters m ON m.id = a.meter_id
        ORDER BY a.raised_at DESC LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def acknowledge_alarm(alarm_id: int, ack_by: str = "operator"):
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    conn.execute("""
        UPDATE alarms SET acknowledged=1, ack_time=?, ack_by=?
        WHERE id=?
    """, (now, ack_by, alarm_id))
    conn.commit()
    conn.close()


def prune_old_readings(days: int = 7):
    """Remove readings older than specified days to manage DB size."""
    conn = get_connection()
    conn.execute("""
        DELETE FROM readings WHERE timestamp < datetime('now', ? || ' days')
    """, (f"-{days}",))
    conn.commit()
    conn.close()
