import pytest

import config
from alarms import AlarmActionError, AlarmManager, AlarmState
from simulator import FacilitySimulator

T0 = 1_760_000_000.0

HI = {
    "tag": "PDU-1.LOAD.HI", "meter_id": "PDU-1", "parameter": "load_pct", "kind": "HI",
    "setpoint": 80.0, "deadband": 3.0, "priority": 3, "on_delay": 0, "off_delay": 0,
    "message": "PDU load high", "unit": "%",
}
LO = {
    "tag": "UTIL.V.LO", "meter_id": "UTIL", "parameter": "voltage", "kind": "LO",
    "setpoint": 432.0, "deadband": 5.0, "priority": 3, "on_delay": 0, "off_delay": 0,
    "message": "Voltage low",
    "suppress": {"meter_id": "UTIL", "parameter": "failed", "equals": True, "reason": "Utility failed"},
}
DISCRETE = {
    "tag": "UPS.ONBATT", "meter_id": "UPS", "parameter": "on_battery", "kind": "DISCRETE",
    "setpoint": 1, "deadband": 0, "priority": 1, "on_delay": 0, "off_delay": 0,
    "message": "UPS on battery",
}


class Harness:
    def __init__(self, *defs):
        self.mgr = AlarmManager(defs, {})
        self.events = []
        self.mgr.add_listener(self.events.append)
        self.t = T0

    def scan(self, **values):
        """values: meter_id -> dict of parameters"""
        self.t += 2
        return self.mgr.evaluate(values, self.t)

    def load(self, pct):
        return self.scan(**{"PDU-1": {"load_pct": pct}})

    def state(self, tag="PDU-1.LOAD.HI"):
        return self.mgr.points[tag].state

    def kinds(self):
        return [e["event"] for e in self.events]


def test_alarm_ack_then_clear():
    h = Harness(HI)
    h.load(50)
    assert h.state() == AlarmState.NORMAL
    assert h.load(85) is True
    assert h.state() == AlarmState.UNACK
    h.mgr.acknowledge(HI["tag"], h.t, "jdoe")
    assert h.state() == AlarmState.ACKED
    assert h.mgr.points[HI["tag"]].ack_by == "jdoe"
    h.load(70)
    assert h.state() == AlarmState.NORMAL
    assert h.kinds() == ["ALARM", "ACK", "RTN"]


def test_return_to_normal_unacknowledged_then_ack():
    h = Harness(HI)
    h.load(85)
    h.load(70)
    assert h.state() == AlarmState.RTN_UNACK
    item = h.mgr.alarm_list()[0]
    assert item["state_label"] == "Returned to normal, unacknowledged"
    h.mgr.acknowledge(HI["tag"], h.t)
    assert h.state() == AlarmState.NORMAL
    assert h.mgr.alarm_list() == []
    assert h.kinds() == ["ALARM", "RTN", "ACK"]


def test_rtn_unack_realarms():
    h = Harness(HI)
    h.load(85)
    h.load(70)
    h.load(88)
    assert h.state() == AlarmState.UNACK
    assert h.kinds() == ["ALARM", "RTN", "ALARM"]


def test_ack_is_rejected_when_nothing_to_acknowledge():
    h = Harness(HI)
    h.load(50)
    with pytest.raises(AlarmActionError):
        h.mgr.acknowledge(HI["tag"], h.t)
    h.load(85)
    h.mgr.acknowledge(HI["tag"], h.t)
    with pytest.raises(AlarmActionError):
        h.mgr.acknowledge(HI["tag"], h.t)
    with pytest.raises(KeyError):
        h.mgr.acknowledge("NOPE", h.t)


def test_deadband_prevents_chatter():
    h = Harness(HI)
    h.load(81)
    h.mgr.acknowledge(HI["tag"], h.t)
    for v in (79.5, 80.5, 78.0, 79.9, 77.5):  # inside the 3% deadband
        h.load(v)
        assert h.state() == AlarmState.ACKED
    h.load(76.9)
    assert h.state() == AlarmState.NORMAL
    assert h.kinds().count("ALARM") == 1


def test_on_and_off_delay():
    h = Harness({**HI, "on_delay": 2, "off_delay": 1})
    h.load(85)
    h.load(85)
    assert h.state() == AlarmState.NORMAL
    h.load(70)  # a single normal scan resets the on delay
    h.load(85)
    h.load(85)
    assert h.state() == AlarmState.NORMAL
    h.load(85)
    assert h.state() == AlarmState.UNACK
    h.load(70)
    assert h.state() == AlarmState.UNACK
    h.load(70)
    assert h.state() == AlarmState.RTN_UNACK


def test_lo_and_discrete_kinds():
    h = Harness(LO, DISCRETE)
    h.scan(UTIL={"voltage": 480, "failed": False}, UPS={"on_battery": False})
    assert h.state("UTIL.V.LO") == AlarmState.NORMAL
    assert h.state("UPS.ONBATT") == AlarmState.NORMAL
    h.scan(UTIL={"voltage": 410, "failed": False}, UPS={"on_battery": True})
    assert h.state("UTIL.V.LO") == AlarmState.UNACK
    assert h.state("UPS.ONBATT") == AlarmState.UNACK
    h.scan(UTIL={"voltage": 434, "failed": False}, UPS={"on_battery": False})
    assert h.state("UTIL.V.LO") == AlarmState.UNACK  # within deadband
    assert h.state("UPS.ONBATT") == AlarmState.RTN_UNACK


def test_missing_value_holds_state():
    h = Harness(HI)
    h.load(85)
    h.scan()  # meter offline
    h.scan(**{"PDU-1": {"load_pct": None}})
    assert h.state() == AlarmState.UNACK
    assert h.kinds() == ["ALARM"]


def test_shelve_hides_alarm_and_expires():
    h = Harness(HI)
    h.load(85)
    h.mgr.shelve(HI["tag"], 5, h.t, "jdoe", "Known overload during migration")
    assert h.state() == AlarmState.SHELVED
    p = h.mgr.points[HI["tag"]]
    assert p.shelve_reason == "Known overload during migration"
    summary = h.mgr.summary(h.t)
    assert summary["shelved"] == 1 and summary["annunciated"] == 0

    h.load(95)
    assert h.state() == AlarmState.SHELVED  # no annunciation while shelved
    h.t += 5 * 60
    h.load(95)
    assert h.state() == AlarmState.UNACK  # timer expired, condition still active
    assert h.kinds() == ["ALARM", "SHELVE", "UNSHELVE", "ALARM"]
    assert h.events[2]["note"] == "Shelve time expired"


def test_unshelve_when_condition_cleared_returns_to_normal():
    h = Harness(HI)
    h.load(85)
    h.mgr.shelve(HI["tag"], 15, h.t)
    h.load(60)
    h.mgr.unshelve(HI["tag"], h.t)
    assert h.state() == AlarmState.NORMAL
    with pytest.raises(AlarmActionError):
        h.mgr.unshelve(HI["tag"], h.t)


def test_shelve_limits():
    h = Harness(HI)
    h.load(85)
    with pytest.raises(AlarmActionError):
        h.mgr.shelve(HI["tag"], config.SHELVE_MAX_MIN + 1, h.t)
    with pytest.raises(AlarmActionError):
        h.mgr.shelve(HI["tag"], 0, h.t)
    h.mgr.shelve(HI["tag"], 5, h.t)
    with pytest.raises(AlarmActionError):
        h.mgr.shelve(HI["tag"], 5, h.t)


def test_designed_suppression():
    h = Harness(LO)
    h.scan(UTIL={"voltage": 480, "failed": False})
    h.scan(UTIL={"voltage": 0, "failed": True})
    assert h.state("UTIL.V.LO") == AlarmState.SUPPRESSED
    assert h.mgr.points["UTIL.V.LO"].suppress_reason == "Utility failed"
    assert h.kinds() == ["SUPPRESS"]
    # Utility back at normal voltage: return to service without a stale alarm
    h.scan(UTIL={"voltage": 481, "failed": False})
    assert h.state("UTIL.V.LO") == AlarmState.NORMAL
    assert h.kinds() == ["SUPPRESS", "UNSUPPRESS"]
    # Utility back but low: return to service straight into alarm
    h.scan(UTIL={"voltage": 0, "failed": True})
    h.scan(UTIL={"voltage": 420, "failed": False})
    assert h.state("UTIL.V.LO") == AlarmState.UNACK


def test_starting_suppressed_is_silent():
    h = Harness(LO)
    h.scan(UTIL={"voltage": 0, "failed": True})
    assert h.state("UTIL.V.LO") == AlarmState.SUPPRESSED
    assert h.events == []


def test_summary_rate_and_priorities():
    h = Harness(HI, DISCRETE)
    h.scan(**{"PDU-1": {"load_pct": 85}}, UPS={"on_battery": True})
    s = h.mgr.summary(h.t)
    assert s["annunciated"] == 2 and s["unacknowledged"] == 2
    assert s["by_priority"]["1"] == 1 and s["by_priority"]["3"] == 1
    assert s["highest_unacked"]["tag"] == "UPS.ONBATT"
    assert s["alarm_rate_10min"] == 2 and s["rate_status"] == "Manageable"

    # Chatter between the states to build up a flood
    for _ in range(10):
        h.scan(**{"PDU-1": {"load_pct": 60}}, UPS={"on_battery": False})
        h.scan(**{"PDU-1": {"load_pct": 85}}, UPS={"on_battery": True})
    assert h.mgr.summary(h.t)["rate_status"] == "Flood"
    # Older than 10 minutes drops out of the rate window
    assert h.mgr.summary(h.t + 601)["alarm_rate_10min"] == 0


def test_alarm_list_orders_by_priority():
    h = Harness(HI, DISCRETE)
    h.scan(**{"PDU-1": {"load_pct": 85}}, UPS={"on_battery": True})
    tags = [a["tag"] for a in h.mgr.alarm_list()]
    assert tags == ["UPS.ONBATT", "PDU-1.LOAD.HI"]


def test_configured_alarm_database_is_valid():
    tags = [d["tag"] for d in config.ALARM_POINTS]
    assert len(tags) == len(set(tags))
    for d in config.ALARM_POINTS:
        assert d["meter_id"] in config.METERS_BY_ID
        assert d["priority"] in config.ALARM_PRIORITIES
        assert d["kind"] in ("HI", "HIHI", "LO", "LOLO", "DISCRETE")
        assert d["response"] and d["consequence"]


def test_outage_through_real_alarm_database():
    """The simulator and the configured alarms together tell the outage story."""
    sim = FacilitySimulator(seed=5, auto_events=False)
    names = {m["id"]: m["name"] for m in config.METERS}
    mgr = AlarmManager(config.ALARM_POINTS, names)
    events = []
    mgr.add_listener(events.append)

    t = T0
    for _ in range(10):
        mgr.evaluate(sim.step(t), t)
        t += 2
    assert events == []  # quiet plant, no standing alarms

    sim.trigger("utility_outage", t, duration=40)
    for _ in range(80):
        mgr.evaluate(sim.step(t), t)
        t += 2

    alarmed = {e["tag"] for e in events if e["event"] == "ALARM"}
    assert {"UTIL-1.FAIL", "UPS-A.ONBATT", "UPS-B.ONBATT", "ATS-1.EMERG"} <= alarmed
    assert "UTIL-1.V.LO" not in alarmed  # cascade suppressed by the failure alarm
    states = {a["tag"]: a["state"] for a in mgr.alarm_list()}
    assert states.get("UPS-A.ONBATT") == "RTN_UNACK"  # ran on battery, nobody acked
