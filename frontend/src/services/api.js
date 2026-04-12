const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const api = {
  getMeters:         ()           => request('/meters'),
  getMeter:          (id)         => request(`/meters/${id}`),
  getMeterHistory:   (id, period) => request(`/meters/${id}/history?period=${period}`),
  getAlarms:         ()           => request('/alarms'),
  getAlarmHistory:   (limit=200)  => request(`/alarms/history?limit=${limit}`),
  acknowledgeAlarm:  (id)         => request(`/alarms/${id}/acknowledge`, { method: 'POST' }),
  getSystemStatus:   ()           => request('/system/status'),
}
