import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { api } from './api'
import { WS_URL } from './endpoints'
import { initialFeed, reduceFeed } from './feed'

const FeedContext = createContext(null)

const STALE_MS = 15000 // no message for this long means the socket is dead
const MAX_BACKOFF_MS = 8000

function feedReducer(state, msg) {
  return reduceFeed(state, msg)
}

/**
 * Connection phases:
 *   connecting    first attempt, nothing heard yet
 *   live          receiving data
 *   reconnecting  had data, lost the socket, retrying in the background
 *
 * Before the first snapshot the app shows the wake screen. The hosting free
 * tier sleeps when idle, so the health check doubles as a wake up call.
 */
export function LiveFeedProvider({ children }) {
  const [feed, dispatch] = useReducer(feedReducer, initialFeed)
  const [phase, setPhase] = useState('connecting')
  const [serverAwake, setServerAwake] = useState(false)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [attempt, setAttempt] = useState(0)

  const wsRef = useRef(null)
  const timerRef = useRef(null)
  const backoffRef = useRef(1000)
  const lastMsgRef = useRef(0)
  const hasDataRef = useRef(false)
  const aliveRef = useRef(true)

  const connect = useCallback(() => {
    if (!aliveRef.current) return
    clearTimeout(timerRef.current)
    let ws
    try {
      ws = new WebSocket(WS_URL)
    } catch {
      timerRef.current = setTimeout(connect, backoffRef.current)
      return
    }
    wsRef.current = ws
    setAttempt(a => a + 1)

    ws.onopen = () => {
      backoffRef.current = 1000
      lastMsgRef.current = Date.now()
    }
    ws.onmessage = (evt) => {
      let msg
      try { msg = JSON.parse(evt.data) } catch { return }
      lastMsgRef.current = Date.now()
      dispatch(msg)
      if (msg.type === 'snapshot') {
        hasDataRef.current = true
        setServerAwake(true)
        setPhase('live')
      }
    }
    ws.onclose = () => {
      if (wsRef.current !== ws || !aliveRef.current) return
      wsRef.current = null
      setPhase(hasDataRef.current ? 'reconnecting' : 'connecting')
      timerRef.current = setTimeout(connect, backoffRef.current)
      backoffRef.current = Math.min(backoffRef.current * 1.6, MAX_BACKOFF_MS)
    }
    ws.onerror = () => ws.close()
  }, [])

  // Open the socket and watch for a silent (stale) connection
  useEffect(() => {
    aliveRef.current = true
    connect()
    const watchdog = setInterval(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMsgRef.current > STALE_MS) {
        ws.close()
      }
    }, 5000)
    return () => {
      aliveRef.current = false
      clearInterval(watchdog)
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // Wake the server with plain HTTP until the feed is up (a sleeping host
  // starts on HTTP traffic; WebSocket attempts alone can fail fast)
  useEffect(() => {
    if (phase === 'live') return undefined
    let cancelled = false
    let timer
    const poke = async () => {
      try {
        const h = await api.health(20000)
        if (cancelled) return
        if (h?.status === 'ok') {
          setServerAwake(true)
          // Server is up but the socket is still waiting on a retry: go now
          if (!wsRef.current) { backoffRef.current = 1000; connect() }
        }
      } catch { /* still asleep or unreachable */ }
      if (!cancelled) timer = setTimeout(poke, 4000)
    }
    poke()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [phase, connect])

  const retry = useCallback(() => {
    setStartedAt(Date.now())
    backoffRef.current = 1000
    wsRef.current?.close()
    wsRef.current = null
    connect()
  }, [connect])

  const value = { ...feed, phase, serverAwake, startedAt, attempt, retry, hasData: !!feed.snapshotAt }
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>
}

export function useFeed() {
  const ctx = useContext(FeedContext)
  if (!ctx) throw new Error('useFeed must be used inside LiveFeedProvider')
  return ctx
}
