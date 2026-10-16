"""The export and triage endpoints, on the running app with its backfilled history."""
import pytest
from fastapi.testclient import TestClient

import triage
import triage_export
from bms_alarm_triage import journal as agent_journal
from main import app


@pytest.fixture(scope="module")
def client():
    triage.clear_cache()
    with TestClient(app) as c:
        yield c


def test_export_returns_the_journal_format(client):
    res = client.get("/api/export/journal?minutes=60")
    assert res.status_code == 200
    assert res.headers["content-disposition"].startswith('attachment; filename="alarm-journal-')
    doc = res.json()
    assert doc["format"] == "bms-triage-journal" and doc["version"] == 1
    assert doc["source"] == "power-dashboard 1.2.0"
    parsed = agent_journal.parse(doc)
    assert parsed.points and parsed.series


def test_export_takes_an_explicit_window(client):
    event = client.get("/api/triage/event").json()["event"]
    res = client.get("/api/export/journal", params={"start": event["start"], "end": event["end"]})
    assert res.status_code == 200
    doc = res.json()
    assert any(e["event"] == "ALARM" for e in doc["journal"])


@pytest.mark.parametrize("query", [
    "minutes=0",
    "minutes=5000",
    "start=yesterday&end=today",
    "start=2026-07-14T10:00:00",
    "start=2026-07-14T10:00:00%2B00:00",
    "start=2026-07-14T11:00:00%2B00:00&end=2026-07-14T10:00:00%2B00:00",
    "start=2026-07-01T10:00:00%2B00:00&end=2026-07-14T10:00:00%2B00:00",
])
def test_export_refuses_a_bad_window(client, query):
    assert client.get(f"/api/export/journal?{query}").status_code == 400


def test_the_latest_event_is_offered(client):
    event = client.get("/api/triage/event").json()["event"]
    assert event is not None  # the backfill always contains past events
    assert event["start"] < event["first_alarm"] <= event["last_alarm"] <= event["end"]
    assert event["alarms"] >= 1


def test_triage_returns_the_ranked_list(client, monkeypatch):
    monkeypatch.delenv("TRIAGE_ANTHROPIC_KEY", raising=False)
    triage.clear_cache()
    res = client.post("/api/triage")
    assert res.status_code == 200, res.text
    body = res.json()
    result = body["triage"]
    assert result["writer"]["kind"] == "template"
    assert result["read_only"] is True
    assert result["counts"]["ranked_items"] >= 1
    assert result["counts"]["ranked_items"] <= result["counts"]["alarms_annunciated"]
    for item in result["items"]:
        assert item["reason"] and item["next_step"]
        assert item["evidence"]["trend"]
        for consequence in item["consequences"]:
            assert consequence["band"] == "EXPLAINED"
    assert body["event"]["first_alarm"]


def test_triage_runs_on_an_explicit_window(client):
    event = client.get("/api/triage/event").json()["event"]
    res = client.post("/api/triage", json={"start": event["start"], "end": event["end"]})
    assert res.status_code == 200
    assert res.json()["triage"]["counts"]["ranked_items"] >= 1


def test_triage_with_no_event_is_a_404(client, monkeypatch):
    monkeypatch.setattr(triage_export, "latest_event", lambda now, lookback_s=0: None)
    res = client.post("/api/triage")
    assert res.status_code == 404
    assert "No alarm event" in res.json()["detail"]


def test_triage_refuses_a_bad_window(client):
    assert client.post("/api/triage", json={"start": "2026-07-14T10:00:00+00:00"}).status_code == 400


def test_an_agent_input_error_is_a_422(client, monkeypatch):
    def broken(start, end, journal_from=None):
        doc = original(start, end, journal_from)
        doc["journal"].append({"time": doc["journal"][0]["time"], "point": "SIM-DC/NOPE/X",
                               "event": "ALARM", "value": 1})
        return doc

    original = triage_export.build_journal
    monkeypatch.setattr(triage_export, "build_journal", broken)
    triage.clear_cache()
    res = client.post("/api/triage")
    assert res.status_code == 422
    assert "not defined in points" in res.json()["detail"]


def test_the_hosted_demo_sets_no_api_key():
    from pathlib import Path

    blueprint = (Path(__file__).resolve().parents[2] / "render.yaml").read_text()
    assert "TRIAGE_ANTHROPIC_KEY" not in blueprint
    assert "ANTHROPIC" not in blueprint


def test_the_agent_is_pinned_to_a_release_tag():
    from pathlib import Path

    requirements = (Path(__file__).resolve().parents[1] / "requirements.txt").read_text()
    line = next(l for l in requirements.splitlines() if l.startswith("bms-alarm-triage-agent"))
    assert "@ git+https://github.com/AddisonTech/bms-alarm-triage-agent@v" in line
