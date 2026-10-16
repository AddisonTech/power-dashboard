// Backend location.
//   VITE_API_URL set at build time   use it
//   production build without it      use the live demo API
//   dev server without it            same origin (Vite proxies /api and /ws)
export const LIVE_API_URL = 'https://power-dashboard-api.onrender.com'

export function resolveApiUrl(env = import.meta.env) {
  const configured = (env.VITE_API_URL || '').trim().replace(/\/+$/, '')
  if (configured) return configured
  return env.PROD ? LIVE_API_URL : ''
}

export const API_URL = resolveApiUrl()

export function buildWsUrl(apiUrl = API_URL, loc = globalThis.location) {
  if (apiUrl) return apiUrl.replace(/^http/, 'ws') + '/ws/live'
  if (!loc) return '/ws/live'
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.host}/ws/live`
}

export const WS_URL = buildWsUrl()
