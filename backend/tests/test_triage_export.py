"""The alarm journal export and the triage agent, driven by the real simulator.

Each scenario runs the simulator, the alarm manager, and the collector's
storage with a fixed clock, then exports and triages the window around the
event. No server is running here, so the history is exactly what the scans
wrote.
"""
import asyncio

import pytest

import config
import database
import triage
import triage_export
from bms_alarm_triage import journal as agent_journal
from collector import Collector

T0 = 1_790_000_000.0


def drive(scenario, quiet_scans=150, event_scans=300, ack_after_s=40, **params):
    """Run quiet, trigger the scenario, run it out. Returns (collector, now)."""
    database.init_db(reset=True)
    triage.clear_cache()
    clock = [T0]
    c = Collector(clock=lambda: clock[0])
    c.sim.auto_events = False

    async def go():
        for _ in range(quiet_scans):
            await c.scan_once(clock[0])
            clock[0] += 2
        if scenario:
            c.sim.trigger(scenario, clock[0], **params)
        for _ in range(event_scans):
            await c.scan_once(clock[0])
            clock[0] += 2
            for p in c.alarms.points.values():
                if p.state.value in ("UNACK", "RTN_UNACK") and p.activated_at and clock[0] - p.activated_at > ack_after_s:
                    c.alarms.acknowledge(p.tag, clock[0], "operator (simulated)")

    asyncio.run(go())
    return c, clock[0]


@pytest.fixture(scope="module")
def outage():
    c, now = drive("utility_outage", duration=110)
    event = triage_export.latest_event(now)
    doc = triage_export.build_journal(event["start"], event["end"], journal_from=event["first_alarm"])
    return {"collector": c, "now": now, "event": event, "doc": doc, "result": triage.run(now)}


# ------------------------------------------------------------- the export

def test_the_export_is_valid_agent_input(outage):
    parsed = agent_journal.parse(outage["doc"])
    assert parsed.counts()["journal_entries"] == len(outage["doc"]["journal"])


def test_the_export_carries_every_alarm_point(outage):
    points = {p["id"]: p for p in outage["doc"]["points"]}
    assert len(points) == len(config.ALARM_POINTS)
    assert points["SIM-DC/UPS-A/ONBATT"]["kind"] == "discrete"
    assert points["SIM-DC/UPS-A/ONBATT"]["signal"] == "ups_on_battery"
    assert points["SIM-DC/UTIL-1/V_LO"]["kind"] == "low"
    assert points["SIM-DC/UTIL-1/V_LO"]["deadband"] == 4.8
    assert points["SIM-DC/PDU-A1/LOAD_HIHI"]["series"] == points["SIM-DC/PDU-A1/LOAD_HI"]["series"]


def test_the_export_carries_the_topology(outage):
    feeds = {e["id"]: e["fed_from"] for e in outage["doc"]["equipment"]}
    assert feeds["PDU-A1"] == "UPS-A"
    assert feeds["UPS-B"] == "MSB-1"
    assert feeds["UTIL-1"] is None


def test_discrete_alarms_have_trend_evidence(outage):
    series = {s["id"]: s["samples"] for s in outage["doc"]["series"]}
    for key in ("SIM-DC/UTIL-1/source_failed", "SIM-DC/UPS-A/on_battery", "SIM-DC/ATS-1/on_emergency",
                "SIM-DC/GEN-1/running"):
        values = {v for _t, v in series[key]}
        assert values == {0.0, 1.0}, key


def test_history_is_stored_at_scan_rate_during_an_event(outage):
    """A one second frequency dip is only visible at scan rate."""
    series = {s["id"]: s["samples"] for s in outage["doc"]["series"]}
    frequency = series["SIM-DC/GEN-1/frequency"]
    running = [v for _t, v in frequency if v > 50]
    assert min(running) < 59.5  # the dip after the block load lands
    stamps = [t for t, _v in series["SIM-DC/UTIL-1/source_failed"]]
    assert len(stamps) > 300 // 10 + 60  # far more than one per HISTORY_INTERVAL


def test_the_journal_starts_at_the_event(outage):
    first = triage_export.iso(outage["event"]["first_alarm"])
    assert all(e["time"] >= first for e in outage["doc"]["journal"])
    assert outage["doc"]["journal"][0]["event"] in ("ALARM", "SUPPRESS")


def test_every_entry_and_sample_is_inside_the_window(outage):
    window = outage["doc"]["window"]
    for entry in outage["doc"]["journal"]:
        assert window["start"] <= entry["time"] <= window["end"]
    for series in outage["doc"]["series"]:
        for stamp, _value in series["samples"]:
            assert window["start"] <= stamp <= window["end"]


def test_the_export_uses_no_real_names_or_addresses(outage):
    import json
    import re

    text = json.dumps(outage["doc"])
    assert not re.search(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", text)
    assert outage["doc"]["site"] == "SIM-DC"


# ------------------------------------------------------- the event window

def test_the_event_window_brackets_the_alarms(outage):
    event = outage["event"]
    assert event["start"] == event["first_alarm"] - config.TRIAGE_PRE_S
    assert event["end"] <= outage["now"]
    assert event["alarms"] == 6


def test_alarms_far_apart_are_separate_events():
    c, now = drive("pf_drop", event_scans=120, duration=60)
    first = triage_export.latest_event(now)

    async def later():
        t = now
        for _ in range(600):  # twenty quiet minutes, scanned, not skipped
            await c.scan_once(t)
            t += 2
        c.sim.trigger("voltage_sag", t, duration=6, depth=0.85)
        for _ in range(60):
            await c.scan_once(t)
            t += 2
        return t

    end = asyncio.run(later())
    second = triage_export.latest_event(end)
    assert second["first_alarm"] > first["last_alarm"] + config.TRIAGE_EVENT_GAP_S
    assert second["alarms"] == 3


def test_no_alarms_means_no_event():
    _c, now = drive(None, event_scans=10)
    assert triage_export.latest_event(now) is None
    with pytest.raises(triage.NoEvent):
        triage.run(now)


# ----------------------------------------------------------- triage

def test_a_utility_outage_comes_down_to_one_item(outage):
    result = outage["result"]["triage"]
    assert result["counts"]["journal_entries"] == 24
    assert result["counts"]["alarm_events"] == 12
    assert result["counts"]["ranked_items"] == 1
    item = result["items"][0]
    assert item["point"] == "SIM-DC/UTIL-1/FAIL"
    assert item["rule"] == "E-P1"
    assert sorted(c["point"] for c in item["consequences"]) == sorted([
        "SIM-DC/UPS-A/ONBATT", "SIM-DC/UPS-B/ONBATT", "SIM-DC/GEN-1/RUN",
        "SIM-DC/ATS-1/EMERG", "SIM-DC/GEN-1/F_LO",
    ])
    assert result["writer"]["kind"] == "template"
    assert item["next_step"].startswith("Review UTIL-1:")


@pytest.mark.parametrize("scenario, params, cause, consequences", [
    ("voltage_sag", {"duration": 6, "depth": 0.85}, "SIM-DC/UTIL-1/V_LO",
     ["SIM-DC/UPS-A/ONBATT", "SIM-DC/UPS-B/ONBATT"]),
    ("pdu_overload", {"pdu": "PDU-A2", "target_pct": 93, "hold": 70}, "SIM-DC/PDU-A2/LOAD_HIHI",
     ["SIM-DC/PDU-A2/LOAD_HI", "SIM-DC/UPS-A/LOAD_HI"]),
    ("pf_drop", {"duration": 100, "pf": 0.8}, "SIM-DC/MECH-1/PF_LO", []),
])
def test_each_demo_scenario_comes_down_to_one_item(scenario, params, cause, consequences):
    _c, now = drive(scenario, **params)
    result = triage.run(now)["triage"]
    assert [i["point"] for i in result["items"]] == [cause]
    assert sorted(c["point"] for c in result["items"][0]["consequences"]) == sorted(consequences)


def test_an_unchanged_window_is_not_run_twice():
    _c, now = drive("pf_drop", event_scans=120, duration=60)
    first = triage.run(now)
    again = triage.run(now)
    assert first["cached"] is False and again["cached"] is True
    assert again["triage"] == first["triage"]


def test_the_run_is_quick(outage):
    assert outage["result"]["elapsed_ms"] < 2000


# ----------------------------------------------------------- storage

def test_a_1_1_database_gains_the_status_columns(tmp_path, monkeypatch):
    import sqlite3

    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE meter_readings (id INTEGER PRIMARY KEY AUTOINCREMENT, meter_id TEXT NOT NULL,
            epoch REAL NOT NULL, timestamp TEXT NOT NULL, voltage REAL, current REAL, power_kw REAL,
            power_factor REAL, frequency REAL, energy_kwh REAL, demand_kw REAL, load_pct REAL);
    """)
    conn.close()
    database.close()
    monkeypatch.setattr(config, "DB_PATH", path)
    try:
        database.init_db()
        columns = {r["name"] for r in database._db().execute("PRAGMA table_info(meter_readings)")}
        assert set(database.STATE_FIELDS) <= columns
    finally:
        database.close()
