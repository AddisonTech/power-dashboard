import json
import time

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def receive_until(ws, predicate, limit=200):
    """Read messages until one matches. Returns that message."""
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if predicate(msg):
            return msg
    raise AssertionError("expected message never arrived")


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["data_source"] == "simulator"
    assert body["version"] == "1.3.0"


def test_websocket_sends_snapshot_on_connect(client):
    with client.websocket_connect("/ws/live") as ws:
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "snapshot"
        data = msg["data"]
        assert len(data["meters"]) == 11
        assert {r["meter_id"] for r in data["readings"]} == {m["id"] for m in data["meters"]}
        assert data["demo"]["simulated"] is True
        assert {s["name"] for s in data["demo"]["scenarios"]} >= {"utility_outage", "voltage_sag"}
        assert "summary" in data and "alarms" in data
        assert data["system"]["health"] in ("normal", "caution", "warning", "critical")


def test_websocket_streams_readings(client):
    with client.websocket_connect("/ws/live") as ws:
        ws.receive_text()  # snapshot
        first = receive_until(ws, lambda m: m["type"] == "readings")
        second = receive_until(ws, lambda m: m["type"] == "readings")
        assert len(first["data"]["readings"]) == 11
        assert second["data"]["readings"][0]["epoch"] > first["data"]["readings"][0]["epoch"]
        assert first["data"]["system"]["facility_kw"] > 0


def test_websocket_ping_pong(client):
    with client.websocket_connect("/ws/live") as ws:
        ws.receive_text()
        ws.send_text(json.dumps({"type": "ping"}))
        receive_until(ws, lambda m: m["type"] == "pong")


def test_alarm_lifecycle_over_rest_and_websocket(client):
    """Trigger an outage, see the alarm arrive live, acknowledge, shelve, unshelve."""
    with client.websocket_connect("/ws/live") as ws:
        ws.receive_text()
        r = client.post("/api/demo/events/utility_outage")
        assert r.status_code == 200 and r.json()["name"] == "utility_outage"
        assert client.post("/api/demo/events/voltage_sag").status_code == 409

        def has_state(tag, state):
            def check(m):
                return m["type"] == "alarms" and any(
                    a["tag"] == tag and a["state"] == state for a in m["data"]["alarms"])
            return check

        msg = receive_until(ws, has_state("UPS-A.ONBATT", "UNACK"))
        summary = msg["data"]["summary"]
        assert summary["highest_unacked"]["priority"] == 1

        r = client.post("/api/alarms/UPS-A.ONBATT/acknowledge", json={"operator": "tester"})
        assert r.status_code == 200
        assert r.json()["state"] in ("ACKED", "NORMAL")
        receive_until(ws, lambda m: m["type"] == "alarms" and all(
            a["state"] != "UNACK" for a in m["data"]["alarms"] if a["tag"] == "UPS-A.ONBATT"))

        r = client.post("/api/alarms/UTIL-1.FAIL/shelve",
                        json={"minutes": 5, "reason": "Utility crew on site", "operator": "tester"})
        assert r.status_code == 200 and r.json()["state"] == "SHELVED"
        receive_until(ws, has_state("UTIL-1.FAIL", "SHELVED"))
        assert client.post("/api/alarms/UTIL-1.FAIL/unshelve").json()["state"] != "SHELVED"

    history = client.get("/api/alarms/history?limit=500").json()
    kinds = {(e["tag"], e["event"]) for e in history}
    assert ("UPS-A.ONBATT", "ALARM") in kinds
    assert ("UPS-A.ONBATT", "ACK") in kinds
    assert ("UTIL-1.FAIL", "SHELVE") in kinds
    assert ("UTIL-1.FAIL", "UNSHELVE") in kinds
    ack = next(e for e in history if e["tag"] == "UPS-A.ONBATT" and e["event"] == "ACK")
    assert ack["operator"] == "tester"


def test_alarm_action_errors(client):
    assert client.post("/api/alarms/NOPE/acknowledge").status_code == 404
    assert client.post("/api/alarms/MSB-1.LOAD.HI/acknowledge").status_code == 409
    assert client.post("/api/alarms/MSB-1.LOAD.HI/shelve", json={"minutes": 999}).status_code == 422
    assert client.post("/api/alarms/MSB-1.LOAD.HI/unshelve").status_code == 409


def test_meters_and_history(client):
    meters = client.get("/api/meters").json()
    assert len(meters) == 11
    by_id = {m["id"]: m for m in meters}
    # PDUs sit behind the UPS, so they stay energized even if an outage is in progress
    assert by_id["PDU-A1"]["current_reading"]["voltage"] > 200
    assert client.get("/api/meters/UPS-A").json()["type"] == "ups"
    assert client.get("/api/meters/NOPE").status_code == 404
    hist = client.get("/api/meters/MSB-1/history?period=1h").json()
    assert len(hist) > 30  # backfilled on startup
    epochs = [h["epoch"] for h in hist]
    assert epochs == sorted(epochs)
    assert time.time() - epochs[-1] < 120
    assert client.get("/api/meters/MSB-1/history?period=2y").status_code == 400


def test_definitions_and_config(client):
    defs = client.get("/api/alarms/definitions").json()
    assert any(d["suppression"] for d in defs)
    cfg = client.get("/api/config").json()
    assert cfg["data_source"] == "simulator"
    assert cfg["shelve_max_min"] == 60
    assert client.post("/api/demo/events/nope").status_code == 404
