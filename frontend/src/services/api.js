import { API_URL } from './endpoints'

const BASE = `${API_URL}/api`

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.detail || `Request failed (${res.status})`)
    return data
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  health:           (timeout)         => request('/health', { timeout }),
  getConfig:        ()                => request('/config'),
  getMeterHistory:  (id, period)      => request(`/meters/${encodeURIComponent(id)}/history?period=${period}`),
  getAlarmHistory:  (limit = 200)     => request(`/alarms/history?limit=${limit}`),
  getAlarmDefs:     ()                => request('/alarms/definitions'),
  acknowledge:      (tag, operator)   => request(`/alarms/${encodeURIComponent(tag)}/acknowledge`, { method: 'POST', body: { operator } }),
  shelve:           (tag, minutes, reason, operator) =>
                      request(`/alarms/${encodeURIComponent(tag)}/shelve`, { method: 'POST', body: { minutes, reason, operator } }),
  unshelve:         (tag, operator)   => request(`/alarms/${encodeURIComponent(tag)}/unshelve`, { method: 'POST', body: { operator } }),
  triggerEvent:     (name)            => request(`/demo/events/${encodeURIComponent(name)}`, { method: 'POST' }),
}
