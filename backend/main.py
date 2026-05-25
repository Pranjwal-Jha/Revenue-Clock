import subprocess
import json
import asyncio
import re
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

app = FastAPI(title="Revenue Clock API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _strip_sql_comments(sql: str) -> str:
    """Remove -- line comments so the query doesn't start with '--',
    which Coral's CLI arg parser mistakes for a flag."""
    cleaned = []
    for line in sql.splitlines():
        line = re.sub(r"--.*$", "", line)   # strip inline and standalone -- comments
        if line.strip():
            cleaned.append(line)
    return "\n".join(cleaned)


QUERY_PATH = Path(__file__).parent.parent / "coral" / "revenue_query.sql"
QUERY = _strip_sql_comments(QUERY_PATH.read_text())
GEMINI = genai.Client()  # reads GEMINI_API_KEY or GOOGLE_API_KEY from env

# ── Demo mode ─────────────────────────────────────────────────
# Set DEMO_MODE=true to bypass Coral and serve realistic fake data.
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() in ("true", "1", "yes")

if DEMO_MODE:
    from demo_data import get_demo_incidents
    print("\n⚡ DEMO MODE ACTIVE — serving fake incident data\n")

SYSTEM_PROMPT = (
    "You are an incident response assistant with access to live incident data. "
    "You know exactly which customers are affected, how much revenue is at risk, "
    "and the real-time burn rate. Be direct and actionable. "
    "Format lists as plain numbered items. Use dollar amounts and customer names concretely. "
    "Never say you don't have access to data — it is provided in every message."
)


def run_coral(query: str) -> list[dict]:
    """Execute a Coral SQL query and return parsed JSON rows.
    In DEMO_MODE, returns pre-built fake data instead."""
    if DEMO_MODE:
        return get_demo_incidents()

    result = subprocess.run(
        ["coral", "sql", "--format", "json", query],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Coral error: {result.stderr.strip()}")
    raw = result.stdout.strip()
    if not raw:
        return []
    return json.loads(raw)


async def incident_stream():
    """Yield SSE events every 5 seconds with fresh Coral data."""
    while True:
        try:
            rows = run_coral(QUERY)
            yield f"data: {json.dumps(rows)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        await asyncio.sleep(5)


@app.get("/health")
async def health():
    """Quick health check — verifies Coral is reachable."""
    if DEMO_MODE:
        return {"status": "ok", "coral": "demo_mode", "demo": True}
    try:
        run_coral("SELECT 1")
        return {"status": "ok", "coral": "reachable"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Coral unreachable: {exc}")


@app.get("/stream")
async def stream():
    """
    SSE endpoint — frontend connects here and receives incident updates every 5s.
    Each event is a JSON array of incident rows from the Coral JOIN query.
    """
    return StreamingResponse(
        incident_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/ask")
async def ask(body: dict):
    """
    Agent endpoint. Fetches live incident data, passes it to Claude,
    returns a plain-text answer.

    Request body: { "question": "Which customers should we email first?" }
    """
    question = body.get("question", "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    try:
        incidents = run_coral(QUERY)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Coral query failed: {exc}")

    response = GEMINI.models.generate_content(
        model="gemma-4-31b-it",
        contents=(
            f"Current live incident data:\n{json.dumps(incidents, indent=2)}\n\n"
            f"Question: {question}"
        ),
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=1024,
        ),
    )
    return {"answer": response.text}
