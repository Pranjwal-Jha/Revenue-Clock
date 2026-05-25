"""
Demo data generator for Revenue Clock hackathon presentation.

When DEMO_MODE=true, the backend serves this fake data instead of
querying Coral. The data is realistic enough for a convincing live demo,
with dynamically computed elapsed-time burn values.
"""

from datetime import datetime, timedelta, timezone

# ── Fake incidents ─────────────────────────────────────────────
# Big MRR values + incidents that started hours ago = dramatic
# counter in the thousands that ticks up ~$0.11/sec visibly.

_INCIDENTS = [
    {
        "incident_id": "P8X2KL9",
        "incident_name": "[CRITICAL] payments-api: 502 errors spike — Stripe webhook processing halted",
        "service": "payments-api",
        "urgency": "high",
        "_started_minutes_ago": 204,   # ~3.4 hours ago
        "_customers": [
            {"email": "finance@acme-corp.com",   "mrr": 45000},
            {"email": "billing@globex.io",       "mrr": 32000},
            {"email": "ops@initech.com",         "mrr": 28000},
            {"email": "admin@hooli.dev",         "mrr": 19000},
            {"email": "support@piedpiper.com",   "mrr": 12000},
            {"email": "cto@aviato.co",           "mrr": 8500},
            {"email": "dev@endframe.io",         "mrr": 5500},
        ],
    },
    {
        "incident_id": "P3QJ7M2",
        "incident_name": "[HIGH] auth-service: elevated 401 rates — SSO login failures",
        "service": "auth-service",
        "urgency": "high",
        "_started_minutes_ago": 107,   # ~1.8 hours ago
        "_customers": [
            {"email": "security@wayne-ent.com",  "mrr": 38000},
            {"email": "it@stark-ind.com",        "mrr": 27000},
            {"email": "admin@oscorp.net",        "mrr": 15000},
            {"email": "ops@lexcorp.io",          "mrr": 11000},
        ],
    },
    {
        "incident_id": "P9NF4R1",
        "incident_name": "[DEGRADED] data-pipeline: batch processing lag >15min",
        "service": "data-pipeline",
        "urgency": "low",
        "_started_minutes_ago": 333,   # ~5.5 hours ago
        "_customers": [
            {"email": "analytics@bigdata-co.com", "mrr": 22000},
            {"email": "eng@datavault.io",         "mrr": 16000},
            {"email": "reports@insightful.ai",    "mrr": 9000},
        ],
    },
]
# Pre-calculate fixed creation times so elapsed time actually grows during the demo
_INIT_TIME = datetime.now(timezone.utc)
for _inc in _INCIDENTS:
    _inc["_created_at"] = _INIT_TIME - timedelta(minutes=_inc["_started_minutes_ago"])

def _build_incident_row(inc: dict, now: datetime) -> dict:
    """Build a single incident row matching the Coral query output schema."""
    created_at = inc["_created_at"]
    elapsed_seconds = (now - created_at).total_seconds()

    customers = inc["_customers"]
    total_mrr = sum(c["mrr"] for c in customers)
    burn_per_hour = round(total_mrr / 730.0, 2)
    revenue_lost = round(burn_per_hour / 3600.0 * elapsed_seconds, 2)

    # top 5 emails sorted by MRR descending
    top_emails = [c["email"] for c in sorted(customers, key=lambda c: c["mrr"], reverse=True)][:5]

    return {
        "incident_id": inc["incident_id"],
        "incident_name": inc["incident_name"],
        "service": inc["service"],
        "urgency": inc["urgency"],
        "created_at": created_at.isoformat(),
        "affected_customers": len(customers),
        "monthly_mrr_at_risk": total_mrr,
        "burn_per_hour": burn_per_hour,
        "revenue_lost_so_far": revenue_lost,
        "top_customer_emails": top_emails,
    }


def get_demo_incidents() -> list[dict]:
    """Return all fake incidents with live-computed elapsed values."""
    now = datetime.now(timezone.utc)
    rows = [_build_incident_row(inc, now) for inc in _INCIDENTS]
    # Sort by MRR at risk descending (matching the real SQL ORDER BY)
    rows.sort(key=lambda r: r["monthly_mrr_at_risk"], reverse=True)
    return rows
