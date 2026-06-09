# -*- coding: utf-8 -*-
"""
Pydantic AI Agent definition + tool registration.
"""
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.deps import AgentDeps
from app.config import OPENAI_API_KEY, OPENAI_BASE_URL, LLM_MODEL

# ── Model Setup ─────────────────────────────────────────────────

_provider = OpenAIProvider(base_url=OPENAI_BASE_URL, api_key=OPENAI_API_KEY)
_model = OpenAIModel(LLM_MODEL, provider=_provider)

SYSTEM_PROMPT = (
    "你是一个数据分析助手。当用户提问关于销售数据的问题时，你需要按顺序：\n"
    "1. 调用 query_tool 执行数据查询\n"
    "2. 调用 chart_tool 生成可视化图表\n"
    "3. 用中文给出简洁的数据分析总结\n\n"
    "重要规则：\n"
    "- 文本总结必须基于 query_tool 返回的真实数据，严禁编造或猜测数据\n"
    "- 引用具体的数字和名称\n"
    "- 如果用户的问题与数据无关，直接回答即可\n"
    "- 回答用中文，保持简洁"
)

# ── Agent ────────────────────────────────────────────────────────

agent = Agent(
    model=_model,
    deps_type=AgentDeps,
    output_type=str,
    retries=2,
    system_prompt=SYSTEM_PROMPT,
)


# ── Tools ────────────────────────────────────────────────────────

@agent.tool
async def query_tool(ctx: RunContext[AgentDeps], question: str) -> str:
    """根据用户问题查询销售数据。question 参数是用户的原始问题文本。"""
    from app.nl2sql import nl2sql_query

    deps = ctx.deps
    await deps.send("step", {"type": "tool_call", "toolName": "queryTool"})

    try:
        sql, columns, records = await nl2sql_query(question, deps.db)
        deps.sql = sql
        deps.columns = columns
        deps.data = records

        await deps.send("data", {
            "columns": columns,
            "records": records,
            "sql": sql,
        })
        return f"查询成功，返回 {len(records)} 条记录。列: {columns}"
    except Exception as e:
        return f"查询失败: {e}"


@agent.tool
async def analysis_tool(ctx: RunContext[AgentDeps]) -> str:
    """分析已查询的数据。必须在 query_tool 之后调用。"""
    deps = ctx.deps
    await deps.send("step", {"type": "tool_call", "toolName": "analysisTool"})

    if not deps.data:
        return "请先调用 query_tool 获取数据"

    return (
        f"数据分析完成。共 {len(deps.data)} 条记录，列: {deps.columns}。"
        "数据已准备好生成图表。"
    )


@agent.tool
async def chart_tool(ctx: RunContext[AgentDeps], query: str = "") -> str:
    """根据查询结果生成 ECharts 图表。query 参数是用户的原始问题文本。"""
    from app.charts import generate_chart_html

    deps = ctx.deps
    await deps.send("step", {"type": "tool_call", "toolName": "chartTool"})

    if not deps.data:
        return "请先调用 query_tool 获取数据"

    html, option = generate_chart_html(query, deps.data, deps.columns)
    deps.chart_html = html
    deps.chart_option = option

    if html:
        await deps.send("chart", {"html": html, "option": option})
        return "图表已生成"
    return "图表生成失败（无数据）"
