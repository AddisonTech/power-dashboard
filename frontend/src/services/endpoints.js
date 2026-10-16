// Backend location. Leave VITE_API_URL empty to use the same origin
// (the Vite dev server proxies /api and /ws to the local backend).
export const API_URL = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')

export function buildWsUrl(apiUrl = API_URL, loc = globalThis.location) {
  if (apiUrl) return apiUrl.replace(/^http/, 'ws') + '/ws/live'
  if (!loc) return '/ws/live'
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.host}/ws/live`
}

export const WS_URL = buildWsUrl()
