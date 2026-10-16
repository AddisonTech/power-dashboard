import pytest

from config import METERS, METERS_BY_ID
from simulator import SCENARIOS, FacilitySimulator

T0 = 1_760_000_000.0
FIELDS = ("voltage", "current", "power_kw", "power_factor", "frequency",
          "energy_kwh", "demand_kw", "load_pct", "status", "timestamp", "epoch")


def run(sim, start, seconds, step=1.0):
    """Step the simulator and return the list of scans."""
    out, t = [], start
    while t < start + seconds:
        out.append(sim.step(t))
        t += step
    return out


def quiet_sim(seed=1):
    return FacilitySimulator(seed=seed, auto_events=False)


def test_every_meter_reports_all_fields():
    r = quiet_sim().step(T0)
    assert set(r) == {m["id"] for m in METERS}
    for mid, reading in r.items():
        assert reading["meter_id"] == mid
        for f in FIELDS:
            assert f in reading, f"{mid} missing {f}"


def test_normal_operation_values_are_believable():
    sim = quiet_sim()
    for scan in run(sim, T0, 600, step=2):
        for mid, r in scan.items():
            cfg = METERS_BY_ID[mid]
            if cfg["type"] == "generator":
                assert r["status"] == "Standby" and r["voltage"] == 0
                continue
            assert abs(r["voltage"] - cfg["nominal_voltage"]) / cfg["nominal_voltage"] < 0.03
            assert 59.9 < r["frequency"] < 60.1
            assert 5 < r["load_pct"] < 75
            assert 0.8 < r["power_factor"] <= 1.0
        assert scan["ATS-1"]["position"] == "UTILITY"
        assert not scan["UPS-A"]["on_battery"] and not scan["UPS-B"]["on_battery"]


def test_power_balances_through_the_hierarchy():
    r = quiet_sim().step(T0)
    pdu_a = r["PDU-A1"]["power_kw"] + r["PDU-A2"]["power_kw"]
    # UPS output covers its PDUs plus transformer losses
    assert pdu_a < r["UPS-A"]["power_kw"] < pdu_a * 1.05
    # Switchboard carries both UPS inputs, cooling, and house load
    floor = r["UPS-A"]["input_kw"] + r["UPS-B"]["input_kw"] + r["MECH-1"]["power_kw"]
    assert floor < r["MSB-1"]["power_kw"] < floor + 25
    # On utility, the ATS and the utility meter see the switchboard load
    assert r["UTIL-1"]["power_kw"] == r["ATS-1"]["power_kw"] == r["MSB-1"]["power_kw"]
    # A plausible PUE for a small facility
    it = sum(r[p]["power_kw"] for p in ("PDU-A1", "PDU-A2", "PDU-B1", "PDU-B2"))
    assert 1.3 < r["MSB-1"]["power_kw"] / it < 2.0


def test_values_move_and_energy_accumulates():
    scans = run(quiet_sim(), T0, 300, step=2)
    kw = {s["MSB-1"]["power_kw"] for s in scans}
    assert len(kw) > 20
    energy = [s["UTIL-1"]["energy_kwh"] for s in scans]
    assert energy == sorted(energy) and energy[-1] > energy[0]


def test_same_seed_is_repeatable():
    a = run(quiet_sim(seed=42), T0, 60, step=2)
    b = run(quiet_sim(seed=42), T0, 60, step=2)
    assert a == b


def test_utility_outage_sequence():
    sim = quiet_sim()
    sim.step(T0)
    sim.trigger("utility_outage", T0 + 1, duration=60)
    scans = run(sim, T0 + 1, 200, step=1)

    def first(pred):
        return next(i for i, s in enumerate(scans) if pred(s))

    lost = first(lambda s: s["UTIL-1"]["source_failed"])
    on_batt = first(lambda s: s["UPS-A"]["on_battery"] and s["UPS-B"]["on_battery"])
    cranking = first(lambda s: s["GEN-1"]["gen_state"] == "CRANKING")
    running = first(lambda s: s["GEN-1"]["gen_state"] == "RUNNING")
    on_gen = first(lambda s: s["ATS-1"]["position"] == "GENERATOR")
    ups_back = first(lambda s: s["ATS-1"]["position"] == "GENERATOR" and not s["UPS-A"]["on_battery"])
    assert lost == on_batt == 0
    assert 0 < cranking < running < on_gen < ups_back

    # While on battery the critical IT load is still served
    assert scans[on_batt]["PDU-A1"]["power_kw"] > 50
    assert scans[on_batt]["MSB-1"]["power_kw"] == 0
    # The block load step dips generator frequency
    assert scans[on_gen]["GEN-1"]["frequency"] < 59.5
    # On generator, the generator meter carries the facility
    assert scans[ups_back + 5]["GEN-1"]["power_kw"] > 300
    assert scans[ups_back + 5]["UTIL-1"]["power_kw"] == 0

    back = first(lambda s: not s["UTIL-1"]["source_failed"])
    retransfer = first(lambda s: s["ATS-1"]["position"] == "UTILITY" and scans.index(s) > on_gen)
    assert retransfer - back >= 29  # retransfer delay
    assert scans[-1]["GEN-1"]["gen_state"] == "STANDBY"
    assert sim.scenario is None
    assert scans[-1]["UPS-A"]["battery_soc"] < 100  # still recharging


def test_voltage_sag_rides_through_on_battery_without_generator():
    sim = quiet_sim()
    sim.step(T0)
    sim.trigger("voltage_sag", T0 + 1, duration=5, depth=0.85)
    scans = run(sim, T0 + 1, 20)
    assert min(s["UTIL-1"]["voltage"] for s in scans) < 432
    assert any(s["UPS-A"]["on_battery"] for s in scans)
    assert all(s["GEN-1"]["gen_state"] == "STANDBY" for s in scans)
    assert not scans[-1]["UPS-A"]["on_battery"]


def test_pdu_overload_crosses_alarm_limits():
    sim = quiet_sim()
    sim.step(T0)
    sim.trigger("pdu_overload", T0 + 1, pdu="PDU-B2", target_pct=93, hold=60)
    scans = run(sim, T0 + 1, 160, step=2)
    peak = max(s["PDU-B2"]["load_pct"] for s in scans)
    assert peak > 90
    assert max(s["PDU-A1"]["load_pct"] for s in scans) < 75
    assert scans[-1]["PDU-B2"]["load_pct"] < 75


def test_power_factor_drop():
    sim = quiet_sim()
    sim.step(T0)
    sim.trigger("pf_drop", T0 + 1, duration=60, pf=0.79)
    scans = run(sim, T0 + 1, 80, step=2)
    assert min(s["MECH-1"]["power_factor"] for s in scans) < 0.82
    assert scans[-1]["MECH-1"]["power_factor"] > 0.85


def test_trigger_validation():
    sim = quiet_sim()
    sim.step(T0)
    with pytest.raises(KeyError):
        sim.trigger("meteor_strike", T0)
    sim.trigger("pf_drop", T0)
    with pytest.raises(RuntimeError):
        sim.trigger("voltage_sag", T0 + 1)


def test_automatic_events_fire_and_finish():
    sim = FacilitySimulator(seed=3, auto_events=True, event_interval=(20, 30), first_event_delay=5)
    seen = set()
    t = T0
    for _ in range(1500):
        sim.step(t)
        if sim.scenario:
            seen.add(sim.scenario["name"])
        t += 2
    assert seen <= set(SCENARIOS)
    assert len(seen) >= 3
