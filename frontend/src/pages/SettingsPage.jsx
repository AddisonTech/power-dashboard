import React from 'react'
import { Settings, Database, Wifi, Bell } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
        <p>System configuration and preferences</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontWeight: 600, color: 'var(--text-secondary)' }}>
            <Wifi size={16} /> CONNECTION
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'API Endpoint',      value: 'http://localhost:8000' },
              { label: 'WebSocket',          value: 'ws://localhost:8000/ws/live' },
              { label: 'Poll Interval',      value: '5 seconds' },
              { label: 'WS Broadcast Rate',  value: '2 seconds' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontWeight: 600, color: 'var(--text-secondary)' }}>
            <Bell size={16} /> ALARM THRESHOLDS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Voltage High Critical',  value: '110% of nominal' },
              { label: 'Voltage High Warning',   value: '105% of nominal' },
              { label: 'Voltage Low Warning',    value: '95% of nominal'  },
              { label: 'Voltage Low Critical',   value: '90% of nominal'  },
              { label: 'Current High Critical',  value: '100% of nominal' },
              { label: 'Current High Warning',   value: '85% of nominal'  },
              { label: 'Power Factor Warning',   value: 'PF < 0.85'       },
              { label: 'Power Factor Critical',  value: 'PF < 0.75'       },
              { label: 'Frequency Warning',      value: '59.5 - 60.5 Hz'  },
              { label: 'Frequency Critical',     value: '59.0 - 61.0 Hz'  },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontWeight: 600, color: 'var(--text-secondary)' }}>
            <Database size={16} /> DATA RETENTION
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Reading Retention', value: '7 days' },
              { label: 'Alarm History',     value: 'Indefinite' },
              { label: 'Database',          value: 'SQLite (power_dashboard.db)' },
              { label: 'Prune Interval',    value: 'Every 1 hour' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
