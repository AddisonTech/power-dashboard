import React, { Suspense, lazy, useCallback, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { LayoutDashboard, GitBranch, Gauge, Bell, TrendingUp, Settings, Zap, Info, FlaskConical } from 'lucide-react'
import { LiveFeedProvider, useFeed } from './services/LiveFeed'
import WakeScreen from './components/WakeScreen'
import AboutPanel from './components/AboutPanel'
import AlarmBanner from './components/AlarmBanner'
import Dashboard from './pages/Dashboard'
import OneLineDiagram from './pages/OneLineDiagram'
import Alarms from './pages/Alarms'
import SettingsPage from './pages/SettingsPage'
import './App.css'

// Chart heavy pages load on demand to keep the first load small
const Meters = lazy(() => import('./pages/Meters'))
const Trending = lazy(() => import('./pages/Trending'))

const NAV = [
  { to: '/',         icon: LayoutDashboard, label: 'Overview' },
  { to: '/one-line', icon: GitBranch,       label: 'One-Line' },
  { to: '/meters',   icon: Gauge,           label: 'Meters' },
  { to: '/alarms',   icon: Bell,            label: 'Alarms', alarms: true },
  { to: '/trending', icon: TrendingUp,      label: 'Trends' },
  { to: '/settings', icon: Settings,        label: 'System' },
]

function ConnectionPill({ phase }) {
  const live = phase === 'live'
  return (
    <div className={`conn-pill ${live ? 'live' : 'down'}`} title={live ? 'Receiving live data' : 'Reconnecting to the server'}>
      <span className="conn-dot" />
      <span>{live ? 'Live' : 'Reconnecting'}</span>
    </div>
  )
}

function Shell() {
  const feed = useFeed()
  const [aboutOpen, setAboutOpen] = useState(false)
  const openAbout = useCallback(() => setAboutOpen(true), [])
  const closeAbout = useCallback(() => setAboutOpen(false), [])

  if (!feed.hasData) {
    return <WakeScreen serverAwake={feed.serverAwake} startedAt={feed.startedAt} retry={feed.retry} />
  }

  const unacked = feed.summary?.unacknowledged ?? 0
  const topPriority = feed.summary?.highest_unacked?.priority

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Zap size={20} className="brand-icon" />
          <span className="brand-text">Power Dashboard</span>
        </div>
        <nav className="sidebar-nav" aria-label="Main">
          {NAV.map(({ to, icon: Icon, label, alarms }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon size={18} />
              <span className="nav-label">{label}</span>
              {alarms && unacked > 0 && <span className={`nav-badge p${topPriority}`}>{unacked}</span>}
            </NavLink>
          ))}
        </nav>
        <button className="sidebar-about" onClick={openAbout}>
          <Info size={16} /> <span className="nav-label">About this demo</span>
        </button>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <Zap size={18} className="brand-icon mobile-only" />
            <h1 className="topbar-title">Data Center Power Monitoring</h1>
          </div>
          <div className="topbar-right">
            {feed.system?.simulated && (
              <button className="sim-pill" onClick={openAbout} title="All data is simulated. Click for details.">
                <FlaskConical size={13} /> <span>Simulated data</span>
              </button>
            )}
            <ConnectionPill phase={feed.phase} />
            <button className="icon-btn" onClick={openAbout} aria-label="About this demo"><Info size={18} /></button>
          </div>
        </header>

        <AlarmBanner />

        <main className={`page-content${feed.phase === 'live' ? '' : ' stale'}`}>
          <Suspense fallback={<div className="page-loading">Loading...</div>}>
            <Routes>
              <Route path="/" element={<Dashboard onAbout={openAbout} />} />
              <Route path="/one-line" element={<OneLineDiagram />} />
              <Route path="/meters" element={<Meters />} />
              <Route path="/alarms" element={<Alarms />} />
              <Route path="/trending" element={<Trending />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.map(({ to, icon: Icon, label, alarms }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `bottom-item${isActive ? ' active' : ''}`}>
            <span className="bottom-icon">
              <Icon size={19} />
              {alarms && unacked > 0 && <span className={`nav-badge p${topPriority}`}>{unacked}</span>}
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <AboutPanel open={aboutOpen} onClose={closeAbout} />
    </div>
  )
}

// Hash based routing (/#/alarms) so any page can be refreshed or deep linked
// on a static host without a server side rewrite rule.
export default function App() {
  return (
    <HashRouter>
      <LiveFeedProvider>
        <Shell />
      </LiveFeedProvider>
    </HashRouter>
  )
}
