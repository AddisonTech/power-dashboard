// The name recorded in the alarm journal for acknowledge and shelve actions.
const KEY = 'pd.operator'

export function getOperator() {
  try {
    return localStorage.getItem(KEY) || 'demo visitor'
  } catch {
    return 'demo visitor'
  }
}

export function setOperator(name) {
  try {
    localStorage.setItem(KEY, name)
  } catch { /* storage unavailable */ }
}

export function readFlag(key) {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

export function writeFlag(key, on) {
  try { on ? localStorage.setItem(key, '1') : localStorage.removeItem(key) } catch { /* ignore */ }
}
