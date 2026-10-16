# Power Dashboard

Real time electrical power monitoring for a data center, with alarm management that follows ANSI/ISA-18.2.

### Live demo: [power-dashboard-vd3w.onrender.com](https://power-dashboard-vd3w.onrender.com)

The demo runs on **simulated data**: no real facility, customer, or equipment is connected. It is hosted on a free tier that sleeps when idle, so the first visit after a quiet period shows a short "waking up" screen for about 30 to 60 seconds. After that everything updates live every 2 seconds.

![Dashboard during a simulated utility outage](screenshots/dashboard.webp)

---

## What it shows

- **A simulated 2N data center.** Utility service and a standby generator feed an automatic transfer switch, then the main switchboard. Two UPS systems (A and B side) each feed two PDUs, and the cooling plant runs from its own panel. Values roll up from the IT load through transformer and UPS losses, so the numbers add up the way a real site does.
- **Equipment that behaves like equipment.** During a utility outage the UPS systems carry the IT load on battery, the generator cranks and comes up to speed, the ATS transfers, the frequency dips when the block load lands, cooling restarts, and the ATS retransfers once utility power has been stable.
- **ISA 18.2 alarm handling** with acknowledge, shelve, return to normal, designed suppression, an alarm journal, and a master alarm database. See [Alarm management](#alarm-management-isa-182).
- **A live one-line diagram** that follows the power path, showing which conductors are carrying load, energized, or dead.
- **Meter detail and trends** for every device, with 1 hour, 24 hour, and 7 day history and CSV export.
- **Try it yourself.** Open *About this demo* and trigger a utility outage, voltage sag, PDU overload, or power factor drop. Events also happen on their own every few minutes.

---

## Alarm management (ISA 18.2)

Every alarm point runs the ISA 18.2 alarm state model:

| State | Meaning | Shown as |
|---|---|---|
| Normal | Process normal, nothing to acknowledge | Not in the alarm list |
| Unacknowledged | Process abnormal, no operator has acknowledged it | Solid priority color, flashing |
| Acknowledged | Process still abnormal, operator is responding | Steady outline |
| Returned to normal, unacknowledged | Process recovered before anyone acknowledged | Dashed outline, flashing, still needs an acknowledgement |
| Shelved | Removed from the list by the operator for a limited time with a logged reason | Shelved tab with a countdown |
| Suppressed by design | Hidden by a designed rule based on plant state | Suppressed tab with the rule shown |

```
Normal --condition--> Unacknowledged --acknowledge--> Acknowledged --clears--> Normal
                      Unacknowledged --clears--> Returned to normal, unack --acknowledge--> Normal
```

What else is implemented:

- **Rationalized master alarm database.** Each alarm has one cause, a priority, a documented consequence, and an operator response. The full table is on the *Alarm database* tab.
- **Priorities by consequence and time to respond:** Critical (under 5 min), High (under 15 min), Medium (within the shift), Low (when practical).
- **Chatter control:** deadbands (hysteresis) on analog alarms and on/off delays counted in scans.
- **Time limited shelving** (5, 15, or 60 minutes, 60 maximum). When the timer runs out the alarm returns to service and re-annunciates if the condition is still present.
- **Designed suppression:** the utility low voltage alarm is suppressed while the utility failure alarm is active, generator frequency alarms are suppressed while the generator is not running, and the cooling plant power factor alarm is suppressed while its panel is de-energized. This prevents the nuisance alarms a simple threshold system would raise during an outage.
- **Alarm journal:** every alarm, acknowledgement, return to normal, shelve, unshelve, and suppression event is recorded with time, value, and operator.
- **Performance KPIs:** annunciated alarm rate over the last 10 minutes compared with the ISA 18.2 targets (about 1 per 10 minutes acceptable, 2 manageable, 10 or more is a flood), plus counts by priority and state. The demo deliberately runs events faster than a real site, so the rate often shows "Above target".

![Alarm list with an expanded alarm showing consequence and operator response](screenshots/alarms.webp)

---

## Screenshots

| One-line diagram during an outage | Alarm journal |
|---|---|
| ![One-line diagram](screenshots/one-line.webp) | ![Alarm journal](screenshots/journal.webp) |
| **Meter detail** | **Trends** |
| ![Meter detail](screenshots/meters.webp) | ![Trends](screenshots/trending.webp) |

<img src="screenshots/mobile.webp" alt="One-line diagram on a phone" width="300" />

---

## Simulated equipment

| ID | Equipment | Rating |
|---|---|---|
| UTIL-1 | Utility service, 480 V | 1600 A |
| GEN-1 | Standby diesel generator | 750 kW |
| ATS-1 | Automatic transfer switch, open transition | 1600 A |
| MSB-1 | Main switchboard, 480 V | 1600 A |
| UPS-A, UPS-B | Double conversion UPS, A and B side | 400 kVA each |
| PDU-A1, PDU-A2, PDU-B1, PDU-B2 | PDU, 480 to 208/120 V | 150 kVA each |
| MECH-1 | Mechanical panel (CRAH units, pumps, fans) | 400 A |

Total load is about 450 kW with roughly 290 kW of IT load (PUE around 1.6). IT load follows a gentle daily profile, cooling load follows a simulated outdoor temperature, and every value drifts with slow random walks plus measurement noise.

Demo scenarios:

| Scenario | What happens |
|---|---|
| Utility outage | UPS on battery, generator start, ATS transfer, generator frequency dip, cooling restart, retransfer after 30 s of stable utility, generator cooldown |
| Utility voltage sag | Utility drops to about 85 percent for a few seconds, UPS systems ride through on battery |
| PDU overload | One PDU ramps past 80 and 90 percent load, which can also push its UPS past the 2N limit, then rebalances |
| Low power factor | The cooling plant capacitor bank drops out and power factor falls below 0.85 |

---

## Architecture

```
  Simulator  or  Modbus TCP meters
         |
         v   every 2 s
   Collector scan loop  ------------>  SQLite (history every 10 s, alarm journal)
         |
         +--> Alarm manager (ISA 18.2 state machine)
         |
         v
   WebSocket /ws/live  ------------>  React front end
   REST /api/*         <------------  (acknowledge, shelve, history, demo events)
```

- **Backend:** FastAPI. A single collector owns the scan loop, the latest readings, the alarm manager, and the set of WebSocket clients. On startup in simulation mode it generates 24 hours of history (with past events and simulated operator acknowledgements) in well under a second, so trends and the journal are never empty.
- **WebSocket feed:** on connect the server sends a `snapshot` (meters, readings, alarms, summary, demo info). After that it pushes `readings` every scan and `alarms` whenever the alarm list changes or an operator acts. Clients can send `{"type": "ping"}` and get a `pong`.
- **Front end:** React and Vite. The live feed is a single WebSocket with automatic reconnection and a stale connection watchdog. Chart heavy pages are loaded on demand, so the first load is about 72 kB of gzipped JavaScript.
- **Cold starts:** the static front end never sleeps. While the API wakes up it shows a progress screen and pings `/api/health` (which is also what wakes the server), then switches to the live view as soon as the first snapshot arrives. If the connection drops later, the page keeps the last data, dims it, and shows "Reconnecting".

### Stack

| Layer | Technology |
|---|---|
| API and WebSocket | Python 3.13, FastAPI 0.111, Uvicorn |
| Storage | SQLite (WAL mode) |
| Field protocol | Modbus TCP via pymodbus (optional) |
| Front end | React 18, Vite 5, React Router 6 |
| Charts and icons | Recharts (trend pages), inline SVG, Lucide |
| Tests | pytest, FastAPI TestClient, Vitest |
| Hosting | Render (static site plus web service), GitHub Actions CI |

---

## Run it locally

Requirements: Python 3.11 or newer and Node 18 or newer.

**Backend** (terminal 1):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs are at http://localhost:8000/docs.

**Front end** (terminal 2):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/ws` to the backend, so no configuration is needed.

**Tests:**

```bash
cd backend && pip install -r requirements-dev.txt && python -m pytest -q
cd frontend && npm test
```

The backend suite covers the simulator (physical consistency, the outage sequence, every scenario), the alarm state machine (every ISA 18.2 transition, deadband, delays, shelving, suppression, KPIs), the WebSocket feed (snapshot, streaming, ping, live alarm updates after operator actions), the REST API, and Modbus decoding. The front end suite covers the feed reducer and URL handling.

---

## Configuration

Backend settings are environment variables (see `backend/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `DATA_SOURCE` | `simulator` | `simulator` for the demo, `modbus` for real meters |
| `MODBUS_CONFIG` | `modbus_config.json` | Device and register map when `DATA_SOURCE=modbus` |
| `POLL_INTERVAL` | `2` | Scan interval in seconds |
| `HISTORY_INTERVAL` | `10` | Seconds between stored history rows |
| `RETENTION_DAYS` | `7` | Days of history and journal kept |
| `BACKFILL_HOURS` | `24` | Simulated history generated at startup |
| `SIM_EVENT_MIN`, `SIM_EVENT_MAX` | `150`, `360` | Seconds between automatic demo events |
| `SIM_SEED` | random | Fixed seed for repeatable simulation |
| `DEMO_EVENTS_ENABLED` | `true` | Allow visitors to trigger events from the UI |
| `CORS_ORIGINS` | `*` | Comma separated allowed origins |
| `DB_PATH` | `power_dashboard.db` | SQLite file |

Front end: `VITE_API_URL` is the API base URL used at build time. Leave it empty when the front end and API share an origin or when using the dev proxy.

### Real hardware (Modbus TCP)

```bash
cd backend
pip install -r requirements-modbus.txt
cp modbus_config.example.json modbus_config.json   # edit hosts, unit ids, registers
DATA_SOURCE=modbus uvicorn main:app --port 8000
```

Each device entry maps a meter ID to a host, unit ID, and the register for each value (holding, input, coil, or discrete; `float32`, `int16`, `uint16`, `int32`, `uint32`, or `bool`; optional scale and word order). A meter that stops answering is shown as "Comm Fail" and its alarms hold their last state until communication returns. The alarm engine, history, and UI work the same as in the demo.

---

## Deployment (Render)

`render.yaml` is a Render Blueprint with two services that deploy from `main` on every merge:

- **power-dashboard-api**: Python web service in `backend/`, started with `uvicorn main:app --host 0.0.0.0 --port $PORT`, health checked at `/api/health`, running the simulator.
- **power-dashboard**: static site built from `frontend/` with `npm ci && npm run build`, published from `dist`, with a rewrite to `index.html` so deep links such as `/alarms` work. Set `VITE_API_URL` to the API service's public URL.

Build filters mean a change under `backend/` only redeploys the API, a change under `frontend/` only redeploys the site, and documentation changes redeploy nothing. GitHub Actions runs both test suites and the production build on every pull request and push to `main`.

---

## Project layout

```
backend/
  main.py               FastAPI app, REST endpoints, WebSocket
  collector.py          Scan loop, backfill, broadcast
  simulator.py          Data center power system model and scenarios
  alarms.py             ISA 18.2 alarm state machine
  config.py             Settings, topology, master alarm database
  database.py           SQLite history and alarm journal
  modbus_source.py      Modbus TCP polling (optional)
  tests/
frontend/
  src/services/         WebSocket feed, REST client
  src/pages/            Overview, One-Line, Meters, Alarms, Trends, System
  src/components/       Wake screen, About panel, alarm banner, badges, charts
render.yaml             Render Blueprint
```

## License

MIT, see [LICENSE](LICENSE).
