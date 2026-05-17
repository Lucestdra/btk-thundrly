"""LangGraph orchestration — parallel agents fan-in to decision.

Topology:

    START ─┬─▶ review_node  ────┐
           ├─▶ price_node   ────┤
           ├─▶ budget_node  ────┼─▶ decision_node ─▶ END
           └─▶ impulse_node ────┘

LangGraph runs the four signal nodes in the same super-step, scheduling
sync node functions on its thread executor; decision_node fires only
after all four have committed their partial state. Same input/output as
the previous sequential orchestrator — the swap is invisible to callers.

Graph compilation is done once at import time. The compiled graph is
stateless; concurrent invocations share it safely.
"""

from typing import Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agents import (
    budget_agent,
    decision_agent,
    impulse_agent,
    price_agent,
    review_agent,
)
from app.models.schemas import AgentResult, AnalyzeRequest, AnalyzeResponse


class AnalysisState(TypedDict, total=False):
    """Mutable state passed through the graph.

    `total=False` lets nodes write only the keys they own — review_node
    returns `{"review": ...}`, price_node returns `{"price": ...}`, etc.
    LangGraph merges partial dicts by overwriting keys, so the four
    signal agents never conflict.
    """

    request: AnalyzeRequest
    review: AgentResult
    price: AgentResult
    budget: AgentResult
    impulse: AgentResult
    response: AnalyzeResponse


def _review_node(state: AnalysisState) -> dict:
    return {"review": review_agent.run(state["request"])}


def _price_node(state: AnalysisState) -> dict:
    return {"price": price_agent.run(state["request"])}


def _budget_node(state: AnalysisState) -> dict:
    return {"budget": budget_agent.run(state["request"])}


def _impulse_node(state: AnalysisState) -> dict:
    return {"impulse": impulse_agent.run(state["request"])}


def _decision_node(state: AnalysisState) -> dict:
    response = decision_agent.run(
        state["request"],
        review=state["review"],
        price=state["price"],
        budget=state["budget"],
        impulse=state["impulse"],
    )
    return {"response": response}


def _build_compiled_graph():
    # Node names must not collide with state keys (LangGraph constraint),
    # so we suffix with `_node`. State keys remain bare (`review`, `price`, ...).
    graph = StateGraph(AnalysisState)
    graph.add_node("review_node", _review_node)
    graph.add_node("price_node", _price_node)
    graph.add_node("budget_node", _budget_node)
    graph.add_node("impulse_node", _impulse_node)
    graph.add_node("decision_node", _decision_node)

    # Fan-out: START → all four signal nodes in parallel.
    for name in ("review_node", "price_node", "budget_node", "impulse_node"):
        graph.add_edge(START, name)
        graph.add_edge(name, "decision_node")

    graph.add_edge("decision_node", END)
    return graph.compile()


# Stateless, thread-safe, reused across requests.
_COMPILED = _build_compiled_graph()


def run(request: AnalyzeRequest) -> AnalyzeResponse:
    """Synchronously execute the graph and return the final response."""
    final_state: Optional[AnalysisState] = _COMPILED.invoke({"request": request})
    if not final_state or "response" not in final_state:
        raise RuntimeError("Graph terminated without producing a response.")
    return final_state["response"]
