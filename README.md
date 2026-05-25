# ⚡ Revenue Clock

> **How much money is this outage costing us, right now?**

Real-time incident cost dashboard. Joins live PagerDuty incidents against Stripe customers in a single Coral SQL query — no warehouse, no ETL, no extra API clients.

---

## What it does

When a PagerDuty incident fires:
1. **Identifies** which Stripe customers are on the affected service
2. **Calculates** MRR at risk
3. **Prorates** that MRR to the second — a live ticking dollar counter
4. **Answers questions** via a Claude-powered agent chat

The entire cross-source JOIN is one 20-line SQL statement, executed by [Coral](https://withcoral.com).

---

## Project Structure

```
revenue-clock/
├── coral/
│   └── revenue_query.sql     # the PagerDuty ⨝ Stripe JOIN query
├── backend/
│   ├── main.py               # FastAPI + Coral subprocess + Claude agent
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # React dashboard
│   │   ├── index.css         # Design system + animations
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

---

## Setup

### 1. Install Coral

```bash
brew install withcoral/tap/coral
# or: curl -fsSL https://withcoral.com/install.sh | sh
```

### 2. Add sources

```bash
coral source add --interactive pagerduty
coral source add --interactive stripe
```

### 3. Verify sources

```bash
coral sql "SELECT id, title, urgency FROM pagerduty.incidents WHERE status = 'triggered' LIMIT 5"
coral sql "SELECT id, email, metadata_service FROM stripe.customers LIMIT 5"
```

If either errors, check token scopes before proceeding.

### 4. Tag Stripe customers with their service

```bash
# Each customer needs metadata[service] matching the PagerDuty service name
stripe customers update cus_xxx --metadata[service]=payments-api
# or at creation:
stripe customers create --email alice@acme.com --metadata[service]=payments-api --metadata[mrr]=2000
```

> **Tip:** Run `coral sql "DESCRIBE stripe.customers"` to confirm the exact column names Coral exposes.

### 5. Backend

```bash
cd backend
pip install -r requirements.txt
# GEMINI_API_KEY is read automatically from your shell environment (bashrc)
uvicorn main:app --reload --port 8000
```

### 6. Frontend

```bash
cd frontend
npm install
npm run dev   # opens http://localhost:5173
```

---

## Environment Variables

| Variable | Where | Required |
|----------|-------|----------|
| `PAGERDUTY_API_TOKEN` | Set during `coral source add pagerduty` | ✓ |
| `STRIPE_API_KEY` | Set during `coral source add stripe` | ✓ |
| `GEMINI_API_KEY` | Shell env for backend (or `GOOGLE_API_KEY` — both work, `GOOGLE_API_KEY` takes precedence) | ✓ |

> If the key is already in your `~/.bashrc` as `export GEMINI_API_KEY=...`, new terminal sessions will have it automatically — no manual export needed.

---

## Pre-demo Checklist

- [ ] `coral sql "SELECT * FROM pagerduty.incidents WHERE status = 'triggered'"` returns rows
- [ ] `coral sql "SELECT id, email, metadata_service FROM stripe.customers LIMIT 5"` returns rows
- [ ] `GET http://localhost:8000/health` → `{"status":"ok","coral":"reachable"}`
- [ ] `GET http://localhost:8000/stream` returns SSE events
- [ ] Frontend counter is ticking red
- [ ] Agent answers "which customers should we email first?"

---

## Demo Agent Questions

| Question | What it shows |
|----------|---------------|
| *Which customers should we email first?* | Agent ranks by MRR from live data |
| *How much will this cost if it runs another 2 hours?* | Agent does arithmetic on burn rate |
| *Draft a status page update for affected customers* | Agent writes prose from structured data |
| *What's our total exposure right now?* | Agent sums across incidents |

---

## Stack

| Layer | Tech |
|-------|------|
| Data | Coral CLI — cross-source SQL JOIN engine |
| Backend | Python 3.11 + FastAPI + SSE |
| Agent | Google Gemma 4 (`gemma-4-31b-it`) via Gemini API |
| Frontend | React 18 + Vite |

**Total application code: ~300 lines.** Coral does the hard part.
# Revenue-Clock
