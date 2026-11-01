from langgraph.graph import END, START, StateGraph

from app.agents.nodes import RunContext, finalize_node, model_node, route, tools_node
from app.agents.prompts import build_system_prompt
from app.agents.state import AgentState


def build_graph(ctx: RunContext):
    g = StateGraph(AgentState)
    g.add_node("model", model_node(ctx))
    g.add_node("tools", tools_node(ctx))
    g.add_node("finalize", finalize_node(ctx))
    g.add_edge(START, "model")
    g.add_conditional_edges("model", route, {"tools": "tools", "finalize": "finalize"})
    g.add_edge("tools", "model")
    g.add_edge("finalize", END)
    return g.compile()


def run_agent_graph(ctx: RunContext, system_instructions: str, task: str) -> str:
    graph = build_graph(ctx)
    initial: AgentState = {
        "messages": [{"role": "system", "content": build_system_prompt(system_instructions)},
                     {"role": "user", "content": task}],
        "step": 0, "pending_calls": [], "final": None, "budget_exhausted": False}
    out = graph.invoke(initial, config={"recursion_limit": ctx.agent.max_steps * 3 + 6})
    return out["final"] or ""
