# Power Dashboard - Electrical Power Monitoring System

A full-stack, real-time Electrical Power Monitoring System (EPMS) dashboard designed for industrial data center and facility power distribution environments. The system continuously polls simulated power meters, stores time-series readings, evaluates alarm conditions against ISA 18.2 thresholds, and delivers live data to a web-based SCADA-style interface via WebSocket.

---

## Demo

> Start the backend and frontend locally using the instructions below. The dashboard will populate with live simulated data within 5 seconds of startup.

---

## Architecture

### Backend
- **FastAPI** serves REST endpoints and a WebSocket broadcast channel.
- **SQLite** (WAL mode) stores meter readings and alarm records.
- **Simulator** generates realistic 3-phase power readings using sine-wave load profiles, Gaussian noise, and periodic fault injection (voltage sag, current spike, PF drop, frequency deviation).
- **Alarm Engine** evaluates every reading against ISA 18.2-aligned thresholds and writes prioritized alarm records to the database.
- **Collector** runs an async polling loop every 5 seconds, inserting readings and broadcasting to all connected WebSocket clients.

### Frontend
- **React 18** single-page application built with **Vite**.
- **Recharts** for trend charts and sparklines.
- **Lucide React** for iconography.
- **React Router v6** for client-side navigation.
- WebSocket hook with automatic reconnection delivers sub-5-second live updates to all views.

### Data Flow

```
Simulator
   |
   v (every 5s)
Collector Loop
   |---> SQLite (readings table)
   |---> Alarm Engine ---> SQLite (alarms table)
   |---> WebSocket Broadcast
              |
              v
        React Frontend
        (readings state)
              |
        Dashboard / One-Line / Meters / Alarms / Trending
```

---

## Tech Stack

| Layer       | Technology                        | Version   |
|-------------|-----------------------------------|-----------|
| API Server  | FastAPI                           | 0.111.0   |
| ASGI Runner | Uvicorn (with standard extras)    | 0.29.0    |
| Database    | SQLite (via stdlib sqlite3)       | built-in  |
| Frontend    | React                             | 18.3.1    |
| Build Tool  | Vite                              | 5.2.0     |
| Charts      | Recharts                          | 2.12.7    |
| Icons       | Lucide React                      | 0.379.0   |
| Routing     | React Router DOM                  | 6.23.1    |

---

## Installation

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Interactive API docs are at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dashboard will be available at `http://localhost:5173`.

---

## Features

1. **Live WebSocket feed** - All meter readings streamed to the browser with under 5-second latency, with automatic reconnection on disconnect.
2. **8-meter hierarchy simulation** - Utility Feed, Main Switchgear, two distribution panels (IT and Cooling), and four sub-meters (Server Row A1/A2, CRAC Unit 1/2).
3. **Realistic simulator** - Sine-wave load profiles, Gaussian noise, gradual drift, and stochastic fault injection producing voltage sags, current spikes, power factor drops, and frequency deviations.
4. **ISA 18.2 alarm engine** - Four-parameter alarm evaluation (voltage, current, power factor, frequency) with four priority levels (Critical, High, Medium, Low) and full acknowledgement workflow.
5. **One-line SVG diagram** - Interactive electrical distribution single-line diagram with live status color coding and per-node detail panel.
6. **Per-meter analog gauges** - Arc gauges for voltage, current, power factor, and frequency with threshold-aware color states.
7. **Historical trending** - Multi-meter, multi-parameter trend chart with 1h/24h/7d period selection and CSV export.
8. **Alarm management table** - Active and history tabs with inline acknowledgement and ISA 18.2 priority row styling.
9. **Automatic data pruning** - Readings older than 7 days are removed hourly; alarm history is retained indefinitely.

---

## Configuration

All tunable parameters are in `backend/config.py`:

- `POLL_INTERVAL` - Simulator polling rate in seconds (default: 5).
- `WS_INTERVAL` - WebSocket broadcast interval in seconds (default: 2).
- `DB_PATH` - SQLite database file path (default: `power_dashboard.db`).
- `METERS` - Full meter hierarchy definition including nominal voltage, nominal current, CT ratio, and PT ratio.
- `ALARM_THRESHOLDS` - Per-parameter alarm thresholds expressed as multipliers of nominal values or absolute values for frequency.

---

## Future Enhancements

- **Real Modbus polling** - Replace the simulator with `pymodbus` to connect to physical Modbus TCP/RTU meters.
- **BACnet integration** - Add BACnet/IP support for building automation system interoperability.
- **Cloud deployment** - Containerize with Docker and deploy to cloud infrastructure with PostgreSQL replacing SQLite.
- **ML predictive maintenance** - Apply time-series anomaly detection to identify degrading equipment before alarm thresholds are reached.
- **User authentication** - Role-based access control for operator, engineer, and administrator tiers.
- **Email/SMS notifications** - Push alarm notifications via SMTP or SMS gateway on critical priority events.
