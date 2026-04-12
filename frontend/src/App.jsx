import React, { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, GitBranch, Gauge, Bell, TrendingUp, Settings, Zap, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import OneLineDiagram from './pages/OneLineDiagram'
import Meters from './pages/Meters'
import Alarms from './pages/Alarms'
import Trending from './pages/Trending'
import SettingsPage from './pages/SettingsPage'
import { useWebSocket } from './services/websocket'
import './App.css'

function AppShell() {
  const { readings, connected } = useWebSocket()
  const [alarmCount, setAlarmCount] = useState(0)
  const location = useLocation()

  useEffect(() => {
    fetch('/api/alarms')
      .then(r => r.json())
      .then(d => setAlarmCount(d.length))
      .catch(() => {})
  }, [readings])

  const navItems = [
    { to: '/',           icon: LayoutDashboard, label: 'Dashboard'     },
    { to: '/one-line',   icon: GitBranch,        label: 'One-Line'      },
    { to: '/meters',     icon: Gauge,            label: 'Meters'        },
    { to: '/alarms',     icon: Bell,             label: 'Alarms', badge: alarmCount },
    { to: '/trending',   icon: TrendingUp,       label: 'Trending'      },
    { to: '/settings',   icon: Settings,         label: 'Settings'      },
  ]

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Zap size={20} className="brand-icon" />
          <span className="brand-text">EPMS</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {badge > 0 && <span className="nav-badge">{badge}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="main-area">
        {/* Top bar */}
        <header className="topbar">
          <h1 className="topbar-title">Power Dashboard</h1>
          <div className="topbar-right">
            <div className={`conn-status ${connected ? 'conn-ok' : 'conn-err'}`}>
              {connected ? <CheckCircle size={14} /> : <XCircle size={14} />}
              <span>{connected ? 'Live' : 'Disconnected'}</span>
            </div>
            {alarmCount > 0 && (
              <div className="topbar-alarm-count">
                <AlertTriangle size={14} />
                <span>{alarmCount} active alarm{alarmCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="page-content">
          <Routes>
            <Route path="/"          element={<Dashboard readings={readings} />} />
            <Route path="/one-line"  element={<OneLineDiagram readings={readings} />} />
            <Route path="/meters"    element={<Meters readings={readings} />} />
            <Route path="/alarms"    element={<Alarms />} />
            <Route path="/trending"  element={<Trending />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
