"""SQLite storage for meter history and the alarm event journal."""

import sqlite3
import threading
import time
from typing import Any, Dict, Iterable, List, Optional

import config

HISTORY_FIELDS = ("voltage", "current", "power_kw", "power_factor", "frequency",
                  "energy_kwh", "demand_kw", "load_pct")

# Status values the discrete alarms are evaluated on. Stored beside the
# analog history so an alarm journal export carries trend evidence for every
# alarm point, not only the analog ones. NULL on meters that have no such value.
STATE_FIELDS = ("source_failed", "on_battery", "on_emergency", "running", "battery_soc")
STORED_FIELDS = HISTORY_FIELDS + STATE_FIELDS

PERIODS = {"1h": 3600, "24h": 86400, "7d": 7 * 86400}
HISTORY_POINTS = 360  # target points per trend after downsampling

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        if config.DB_PATH != ":memory:":
            _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
    return _conn


def close():
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


def init_db(reset: bool = False):
    """Create tables. reset=True clears stored data (used for a fresh demo)."""
    with _lock:
        db = _db()
        if reset:
            db.executescript("DROP TABLE IF EXISTS meter_readings; DROP TABLE IF EXISTS alarm_events;")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS meter_readings (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                meter_id     TEXT NOT NULL,
                epoch        REAL NOT NULL,
                timestamp    TEXT NOT NULL,
                voltage      REAL,
                current      REAL,
                power_kw     REAL,
                power_factor REAL,
                frequency    REAL,
                energy_kwh   REAL,
                demand_kw    REAL,
                load_pct     REAL,
                source_failed REAL,
                on_battery   REAL,
                on_emergency REAL,
                running      REAL,
                battery_soc  REAL
            );
            CREATE INDEX IF NOT EXISTS idx_meter_readings_meter_epoch
                ON meter_readings(meter_id, epoch);

            CREATE TABLE IF NOT EXISTS alarm_events (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                epoch      REAL NOT NULL,
                timestamp  TEXT NOT NULL,
                tag        TEXT NOT NULL,
                meter_id   TEXT NOT NULL,
                meter_name TEXT,
                event      TEXT NOT NULL,
                state      TEXT NOT NULL,
                priority   INTEGER NOT NULL,
                value      REAL,
                setpoint   REAL,
                unit       TEXT,
                message    TEXT,
                operator   TEXT,
                note       TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_alarm_events_epoch ON alarm_events(epoch);
        """)
        # A database written by 1.1.0 has no status columns. Add them in place.
        have = {row["name"] for row in db.execute("PRAGMA table_info(meter_readings)")}
        for name in STATE_FIELDS:
            if name not in have:
                db.execute(f"ALTER TABLE meter_readings ADD COLUMN {name} REAL")
        db.commit()


def insert_readings(readings: Iterable[Dict[str, Any]]):
    rows = [
        (r["meter_id"], r["epoch"], r["timestamp"], *(_stored(r.get(f)) for f in STORED_FIELDS))
        for r in readings
    ]
    with _lock:
        db = _db()
        db.executemany(
            f"INSERT INTO meter_readings (meter_id, epoch, timestamp, {', '.join(STORED_FIELDS)}) "
            f"VALUES (?, ?, ?, {', '.join('?' * len(STORED_FIELDS))})",
            rows,
        )
        db.commit()


def _stored(value):
    return float(value) if isinstance(value, bool) else value


def get_meter_history(meter_id: str, period: str = "1h", now: Optional[float] = None) -> List[Dict]:
    """Return averaged history buckets for one meter, oldest first."""
    span = PERIODS[period]
    now = time.time() if now is None else now
    bucket = max(span / HISTORY_POINTS, 1.0)
    avgs = ", ".join(f"ROUND(AVG({f}), 3) AS {f}" for f in HISTORY_FIELDS)
    with _lock:
        rows = _db().execute(
            f"""
            SELECT CAST(epoch / ? AS INTEGER) * ? AS epoch, {avgs}
            FROM meter_readings
            WHERE meter_id = ? AND epoch >= ?
            GROUP BY CAST(epoch / ? AS INTEGER)
            ORDER BY epoch ASC
            """,
            (bucket, bucket, meter_id, now - span, bucket),
        ).fetchall()
    return [dict(r) for r in rows]


def insert_alarm_event(event: Dict[str, Any]):
    insert_alarm_events([event])


def insert_alarm_events(events: Iterable[Dict[str, Any]]):
    cols = ("epoch", "timestamp", "tag", "meter_id", "meter_name", "event", "state",
            "priority", "value", "setpoint", "unit", "message", "operator", "note")
    rows = [tuple(e.get(c) for c in cols) for e in events]
    if not rows:
        return
    with _lock:
        db = _db()
        db.executemany(
            f"INSERT INTO alarm_events ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            rows,
        )
        db.commit()


def get_alarm_events(limit: int = 200, tag: Optional[str] = None) -> List[Dict]:
    sql = "SELECT * FROM alarm_events"
    args: list = []
    if tag:
        sql += " WHERE tag = ?"
        args.append(tag)
    sql += " ORDER BY epoch DESC, id DESC LIMIT ?"
    args.append(limit)
    with _lock:
        rows = _db().execute(sql, args).fetchall()
    return [dict(r) for r in rows]


def get_readings_window(start: float, end: float, fields: Iterable[str]) -> List[Dict]:
    """Raw stored readings between two epochs, oldest first, for the given fields."""
    fields = [f for f in fields if f in STORED_FIELDS]
    with _lock:
        rows = _db().execute(
            f"SELECT meter_id, epoch, timestamp, {', '.join(fields)} FROM meter_readings "
            "WHERE epoch >= ? AND epoch <= ? ORDER BY epoch ASC, id ASC",
            (start, end),
        ).fetchall()
    return [dict(r) for r in rows]


def get_alarm_events_window(start: float, end: float) -> List[Dict]:
    """Journal entries between two epochs, oldest first."""
    with _lock:
        rows = _db().execute(
            "SELECT * FROM alarm_events WHERE epoch >= ? AND epoch <= ? ORDER BY epoch ASC, id ASC",
            (start, end),
        ).fetchall()
    return [dict(r) for r in rows]


def get_alarm_epochs(since: float, until: float) -> List[float]:
    """Times of every annunciated alarm in a span, newest first."""
    with _lock:
        rows = _db().execute(
            "SELECT epoch FROM alarm_events WHERE event = 'ALARM' AND epoch >= ? AND epoch <= ? "
            "ORDER BY epoch DESC",
            (since, until),
        ).fetchall()
    return [r["epoch"] for r in rows]


def prune(days: int, now: Optional[float] = None):
    cutoff = (time.time() if now is None else now) - days * 86400
    with _lock:
        db = _db()
        db.execute("DELETE FROM meter_readings WHERE epoch < ?", (cutoff,))
        db.execute("DELETE FROM alarm_events WHERE epoch < ?", (cutoff,))
        db.commit()
