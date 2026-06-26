"""Tiny FastAPI echo service used as the Phase 6 process-manager demo.

Exposes:
    GET  /healthz   → {"ok": true}
    POST /echo      → echoes the request JSON body back
    GET  /echo      → echoes the query string back

Designed to start fast, log clearly, and exit on SIGTERM so the
process_manager's lifecycle can be observed end-to-end.
"""

from fastapi import FastAPI, Request


app = FastAPI(title="echo_http", version="1.0.0")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/echo")
def echo_get(request: Request) -> dict:
    return {
        "method": "GET",
        "query": dict(request.query_params),
    }


@app.post("/echo")
async def echo_post(request: Request) -> dict:
    body = await request.body()
    parsed = None
    if body:
        try:
            import json
            parsed = json.loads(body)
        except Exception:
            parsed = body.decode("utf-8", errors="replace")
    return {
        "method": "POST",
        "query": dict(request.query_params),
        "body": parsed,
    }
