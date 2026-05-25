import { useState, useEffect, useRef, useCallback } from "react"

const API = "http://localhost:8000"

function fmtUSD(n, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n ?? 0)
}

function timeAgo(date) {
  if (!date) return null
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 5) return "just now"
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

export default function App() {
  const [incidents, setIncidents]     = useState([])
  const [displayLost, setDisplayLost] = useState(0)
  const [connected, setConnected]     = useState(false)
  const [question, setQuestion]       = useState("")
  const [answer, setAnswer]           = useState("")
  const [asking, setAsking]           = useState(false)
  const [lastUpdate, setLastUpdate]   = useState(null)
  const [streamError, setStreamError]  = useState(null)
  const [, setTick]                   = useState(0) // forces re-render for timeAgo

  const rafRef  = useRef(null)
  const burnRef = useRef(0) // burn per second across all active incidents

  // Refresh "last updated" text every 5s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  // SSE — connect to backend stream
  useEffect(() => {
    const es = new EventSource(`${API}/stream`)

    es.onopen = () => setConnected(true)

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (Array.isArray(data)) {
          setIncidents(data)
          setStreamError(null)
          setConnected(true)
          setLastUpdate(new Date())
          // Sync counter to authoritative server value
          const serverTotal = data.reduce((s, i) => s + (i.revenue_lost_so_far ?? 0), 0)
          setDisplayLost(serverTotal)
          // Update per-second burn for rAF interpolation
          burnRef.current = data.reduce((s, i) => s + (i.burn_per_hour ?? 0), 0) / 3600
        } else if (data.error) {
          setStreamError(data.error)
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => setConnected(false)
    return () => es.close()
  }, [])

  // Smooth ~60fps interpolation between server polls
  useEffect(() => {
    const tick = () => {
      setDisplayLost((prev) => prev + burnRef.current / 60)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const askAgent = useCallback(async () => {
    if (!question.trim() || asking) return
    setAsking(true)
    setAnswer("")
    try {
      const res = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      setAnswer(data.answer ?? data.detail ?? "No response.")
    } catch {
      setAnswer("Could not reach the agent. Is the backend running on port 8000?")
    } finally {
      setAsking(false)
    }
  }, [question, asking])

  // Aggregate stats
  const totalCustomers  = incidents.reduce((s, i) => s + (i.affected_customers   ?? 0), 0)
  const totalBurnPerHr  = incidents.reduce((s, i) => s + (i.burn_per_hour        ?? 0), 0)
  const totalMRR        = incidents.reduce((s, i) => s + (i.monthly_mrr_at_risk  ?? 0), 0)
  const hasIncidents    = incidents.length > 0

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <span className="header-icon">⚡</span>
          <span className="header-title">Revenue Clock</span>
        </div>
        <div className="header-right">
          {lastUpdate && (
            <span className="last-updated">
              Updated {timeAgo(lastUpdate)}
            </span>
          )}
          <div className={`live-badge ${connected ? "live-badge--on" : "live-badge--off"}`}>
            <span className="live-dot" />
            {connected ? "LIVE" : "CONNECTING"}
          </div>
        </div>
      </header>

      <main className="main">

        {/* ── Hero counter ── */}
        <section className="hero">
          <p className="hero-label">REVENUE LOST SINCE INCIDENT STARTED</p>
          <div className="counter-wrap">
            <span className={`counter ${hasIncidents ? "counter--active" : "counter--idle"}`}>
              {fmtUSD(displayLost, 2)}
            </span>
          </div>
          <div className="hero-stats">
            <span>{totalCustomers} customer{totalCustomers !== 1 ? "s" : ""} affected</span>
            <span className="sep">·</span>
            <span>{incidents.length} active incident{incidents.length !== 1 ? "s" : ""}</span>
            <span className="sep">·</span>
            <span>burning {fmtUSD(totalBurnPerHr)}/hr</span>
          </div>
        </section>

        {/* ── Stats row ── */}
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">CUSTOMERS AFFECTED</p>
            <p className="stat-value">{totalCustomers}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">MRR AT RISK</p>
            <p className="stat-value stat-value--red">{fmtUSD(totalMRR)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">BURN / HOUR</p>
            <p className="stat-value stat-value--yellow">{fmtUSD(totalBurnPerHr)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">ACTIVE INCIDENTS</p>
            <p className="stat-value">{incidents.length}</p>
          </div>
        </div>

        {/* ── Stream error banner ── */}
        {streamError && (
          <div className="error-banner">
            <span className="error-banner-icon">⚠</span>
            <div>
              <p className="error-banner-title">Coral query failed</p>
              <p className="error-banner-msg">{streamError}</p>
            </div>
          </div>
        )}

        {/* ── Incident table ── */}
        <section className="section">
          <h2 className="section-title">ACTIVE INCIDENTS</h2>

          {hasIncidents ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>INCIDENT</th>
                    <th>SERVICE</th>
                    <th>URGENCY</th>
                    <th className="th-r">CUSTOMERS</th>
                    <th className="th-r">MRR AT RISK</th>
                    <th className="th-r">BURN / HR</th>
                    <th className="th-r">LOST SO FAR</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc, idx) => {
                    const urgency = inc.urgency?.toLowerCase() ?? "low"
                    return (
                      <tr
                        key={inc.incident_id}
                        className={`trow trow--${urgency}`}
                        style={{ animationDelay: `${idx * 55}ms` }}
                      >
                        <td>
                          <div className="cell-incident">
                            <span className="cell-name">{inc.incident_name}</span>
                            <span className="cell-id">{inc.incident_id}</span>
                          </div>
                        </td>
                        <td>
                          <code className="chip">{inc.service}</code>
                        </td>
                        <td>
                          <span className={`badge badge--${urgency}`}>
                            {inc.urgency?.toUpperCase() ?? "LOW"}
                          </span>
                        </td>
                        <td className="td-r td-mono">{inc.affected_customers ?? 0}</td>
                        <td className="td-r td-mono td-bold">{fmtUSD(inc.monthly_mrr_at_risk)}</td>
                        <td className="td-r td-mono">{fmtUSD(inc.burn_per_hour)}<span className="td-unit">/hr</span></td>
                        <td className="td-r td-mono td-red">{fmtUSD(inc.revenue_lost_so_far, 2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <span className="empty-icon">✓</span>
              <p className="empty-title">All clear</p>
              <p className="empty-sub">No triggered incidents. Polling PagerDuty…</p>
            </div>
          )}
        </section>

        {/* ── Agent chat ── */}
        <section className="section chat-section">
          <h2 className="section-title">ASK THE AGENT</h2>
          <div className="chat-input-row">
            <input
              className="chat-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askAgent()}
              placeholder="Which customers should we email first?"
              disabled={asking}
            />
            <button
              className={`chat-btn ${asking ? "chat-btn--loading" : ""}`}
              onClick={askAgent}
              disabled={asking || !question.trim()}
            >
              {asking ? <span className="spinner" /> : "Ask"}
            </button>
          </div>

          {(answer || asking) && (
            <div className="chat-answer">
              {asking ? (
                <div className="thinking">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </div>
              ) : (
                <span className="answer-text">{answer}</span>
              )}
            </div>
          )}

          <div className="suggested-questions">
            {[
              "Which customers should we email first?",
              "How much will this cost if it runs another 2 hours?",
              "Draft a status page update for affected customers.",
              "What's our total exposure right now?",
            ].map((q) => (
              <button
                key={q}
                className="suggestion-chip"
                onClick={() => {
                  setQuestion(q)
                  setAnswer("")
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <span>
          Powered by{" "}
          <a href="https://withcoral.com" target="_blank" rel="noreferrer" className="footer-link">Coral</a>
          {" · "}
          <a href="https://pagerduty.com" target="_blank" rel="noreferrer" className="footer-link">PagerDuty</a>
          {" · "}
          <a href="https://stripe.com" target="_blank" rel="noreferrer" className="footer-link">Stripe</a>
          {" · "}
          <a href="https://anthropic.com" target="_blank" rel="noreferrer" className="footer-link">Claude</a>
        </span>
        <span>Revenue Clock · Hackathon Edition</span>
      </footer>

    </div>
  )
}
