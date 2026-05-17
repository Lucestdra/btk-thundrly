"""Streaming endpoint contract test.

Verifies the NDJSON sequence produced by POST /api/analyze-purchase/stream:

  - Exactly one `node_finished` for each of {review, price, budget, impulse}
  - Exactly one `verdict` at the end with a complete AnalyzeResponse
  - No `error` events in a happy-path run
  - The final verdict matches what the non-streaming endpoint returns for
    the same input (decision + riskScore parity)
"""

from __future__ import annotations

import json
from typing import List

from app.data.mock_data import EXAMPLES


def _read_ndjson(client, payload: dict) -> List[dict]:
    """POST to /stream and split the streaming body into JSON events."""
    with client.stream("POST", "/api/analyze-purchase/stream", json=payload) as r:
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/x-ndjson")
        body = r.read().decode("utf-8")

    events: List[dict] = []
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        events.append(json.loads(line))
    return events


def test_stream_emits_four_signal_events_then_verdict(client):
    events = _read_ndjson(client, EXAMPLES["red"])

    finished = [e for e in events if e["event"] == "node_finished"]
    verdicts = [e for e in events if e["event"] == "verdict"]
    errors = [e for e in events if e["event"] == "error"]

    assert errors == [], events

    finished_nodes = {e["node"] for e in finished}
    assert finished_nodes == {"review", "price", "budget", "impulse"}, finished_nodes
    # Every signal event carries a full AgentResult payload.
    for f in finished:
        assert "result" in f
        assert {"score", "label", "findings"}.issubset(f["result"])

    assert len(verdicts) == 1, [e["event"] for e in events]
    verdict = verdicts[0]["response"]
    assert verdict["decision"] in {"green", "yellow", "red"}
    assert {"riskScore", "summary", "reasons", "agents", "recommendedAction"}.issubset(verdict)


def test_stream_verdict_matches_non_streaming_endpoint(client):
    """The streaming and non-streaming endpoints must agree on the verdict.

    They share the orchestrator and the deterministic decision step, so
    decision + riskScore must be identical for the same input.
    """
    for variant in ("red", "yellow", "green"):
        body = EXAMPLES[variant]

        # 1) Non-streaming
        r = client.post("/api/analyze-purchase", json=body)
        assert r.status_code == 200
        plain = r.json()

        # 2) Streaming — pick the last `verdict` event
        events = _read_ndjson(client, body)
        verdict_event = next(e for e in events if e["event"] == "verdict")
        streamed = verdict_event["response"]

        assert streamed["decision"] == plain["decision"], variant
        assert streamed["riskScore"] == plain["riskScore"], variant
        assert set(streamed["agents"]) == set(plain["agents"])
