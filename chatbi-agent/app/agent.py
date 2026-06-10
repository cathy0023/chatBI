# -*- coding: utf-8 -*-
"""
Pydantic AI Agent definition + tool registration.
Aligned with TS Agent capabilities (P0-P2).
"""
import json
import re
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.deps import AgentDeps
from app.config import OPENAI_API_KEY, OPENAI_BASE_URL, LLM_MODEL

# ── Model Setup ─────────────────────────────────────────────────

_provider = OpenAIProvider(base_url=OPENAI_BASE_URL, api_key=OPENAI_API_KEY)
_model = OpenAIModel(LLM_MODEL, provider=_provider)

SYSTEM_PROMPT = (
    "你是销售数据分析助手。\n\n"
    "你可以使用以下工具来回答用户问题：\n\n"
    "1. **queryTool**: 查询销售数据。将自然语言转为 SQL 并执行。\n"
    "   - 用于：查找具体数据、获取明细、筛选记录\n"
    "   - 先用这个工具获取数据，再用其他工具分析\n\n"
    "2. **analysisTool**: 分析数据，生成洞察和总结。\n"
    "   - 用于：趋势分析、排名对比、异常发现\n"
    "   - 需要先通过 queryTool 获取数据\n\n"
    "3. **chartTool**: 生成可视化图表。\n"
    "   - 用于：柱状图、折线图、饼图等\n"
    "   - 需要先通过 queryTool 获取数据\n"
    "   - **重要**：当用户提到走势图、折线图、柱状图、饼图、趋势、对比图等可视化关键词时，必须调用此工具\n"
    "   - 即使 LLM 已经可以生成文本分析，也必须额外调用 chartTool 以生成可视化图表\n\n"
    "工作流程：\n"
    "1. 理解用户意图\n"
    "2. 如需数据，先调用 queryTool\n"
    "3. **必须**根据结果调用 analysisTool（生成文本洞察）和/或 chartTool（生成可视化图表）\n"
    "4. 综合所有信息，给出完整回答\n"
    "5. 如果用户提到图表类型（走势图、折线图、柱状图、饼图等），chartTool 是**必选项**，不是可选项\n\n"
    "规则：\n"
    "- 引用的数字必须与工具返回的数据完全一致\n"
    "- 不要自行计算或推测数据\n"
    "- 回答控制在 300 字以内\n"
    "- 直接回答用户问题，不要说「查询到 N 条数据」\n"
    '- **「整体」的含义**：当用户说「XX和整体对比」、「XX和整体走势」时，「整体」指的是所有人的汇总数据（不按人分组），不是另一个具体的人。需要两次调用 queryTool：一次查个人数据，一次查整体汇总数据。或者用 UNION ALL 合并为一次查询。\n'
    '- **多轮对话意图还原**：当用户回复「是」、「对」、「确认」等简短回答时，必须结合上下文还原完整意图再调用 queryTool。必须保留原始 query 中的所有修饰词（时间范围、图表类型等）。例如：上一轮用户问「郑威7-10月份成交走势图」，AI 建议「郑威16」，用户说「是」，则 queryTool 的 query 应为「郑威16 7-10月份成交走势图」，而非「郑威16的销售数据」\n'
    "- **必须生成最终文字回答**：无论调用了哪些工具，最终必须输出一段文字总结给用户。不能只调用工具而不给出文字回答。\n"
)


def build_system_prompt_with_context(deps: AgentDeps) -> str:
    """Build system prompt with previous query context injected."""
    prompt = SYSTEM_PROMPT
    if deps.previous_query_context:
        ctx = deps.previous_query_context
        prompt += (
            f"\n\n【上一轮查询上下文】\n"
            f"- 用户原始问题: \"{ctx['query']}\"\n"
            f"- 执行的SQL: {ctx['sql']}\n"
            '- 当用户在后续对话中提到"右侧"、"上面"、"刚才"、"那个"、"没展示出来"等指代词时，'
            "必须结合此上下文还原意图。"
        )
    return prompt

# ── Agent ────────────────────────────────────────────────────────

agent = Agent(
    model=_model,
    deps_type=AgentDeps,
    output_type=str,
    retries=2,
)


# ── Tools ────────────────────────────────────────────────────────

@agent.system_prompt
async def _system_prompt(ctx: RunContext[AgentDeps]) -> str:
    return build_system_prompt_with_context(ctx.deps)


@agent.tool
async def query_tool(ctx: RunContext[AgentDeps], question: str) -> str:
    """根据用户问题查询销售数据。question 参数是用户的原始问题文本。"""
    from app.nl2sql import nl2sql_query
    from app.query_helpers import resolve_short_name, suggest_similar_name

    deps = ctx.deps
    await deps.send("step", {"type": "tool_call", "toolName": "queryTool"})

    # Short name resolution before NL2SQL
    resolved_question = resolve_short_name(deps.db, question)

    try:
        sql, columns, records = await nl2sql_query(resolved_question, deps.db)

        # Multi-query merge: when LLM calls queryTool multiple times
        # (e.g., "person vs overall" comparison), append & annotate
        if deps.data and deps.columns:
            # Detect person name from SQL WHERE clause
            name_match = re.search(r"name\s*=\s*'([^']+)'", sql, re.IGNORECASE)
            person_name = name_match.group(1) if name_match else "整体"
            # Animate only records without an existing name field
            annotated = [
                {**r, "name": person_name}
                if r.get("name") is None or str(r.get("name", "")).strip() == ""
                else {**r}
                for r in records
            ]
            deps.data = [*deps.data, *annotated]
            new_cols = [c for c in columns if c not in deps.columns]
            if "name" not in deps.columns:
                deps.columns = [*deps.columns, "name", *new_cols]
            else:
                deps.columns = [*deps.columns, *new_cols]
            deps.sql = sql
        else:
            # First query
            name_match = re.search(r"name\s*=\s*'([^']+)'", sql, re.IGNORECASE)
            person_name = name_match.group(1) if name_match else "整体"
            annotated = [
                {**r, "name": person_name}
                if r.get("name") is None or str(r.get("name", "")).strip() == ""
                else {**r}
                for r in records
            ]
            deps.data = annotated
            cols = columns if "name" in columns else ["name", *columns]
            deps.columns = cols
            deps.sql = sql

        # Fuzzy name suggestion when no results
        suggestion = None
        if len(records) == 0:
            suggestion = suggest_similar_name(deps.db, sql, resolved_question)

        data_payload = json.dumps(records[:30], ensure_ascii=False)
        result_text = f"查询成功，返回 {len(records)} 条记录。列: {columns}\n数据:\n{data_payload}"
        if suggestion:
            result_text += f"\n\n{suggestion}"
        return result_text
    except Exception as e:
        return f"查询失败: {e}"


@agent.tool
async def analysis_tool(ctx: RunContext[AgentDeps], query: str = "") -> str:
    """分析已查询的数据，生成洞察和总结。必须在 query_tool 之后调用。query 参数是用户原始问题。"""
    from app.charts import recommend_chart, aggregate_for_chart, COLUMN_LABELS
    from openai import AsyncOpenAI
    from app.config import OPENAI_API_KEY, OPENAI_BASE_URL, LLM_MODEL

    deps = ctx.deps
    await deps.send("step", {"type": "tool_call", "toolName": "analysisTool"})

    if not deps.data:
        return "请先调用 query_tool 获取数据"

    query = query or deps.original_query

    # Generate statistical summary (same logic as TS analysis-tool)
    rec = recommend_chart(query, deps.data)
    agg_data = aggregate_for_chart(deps.data, rec["dimension"], rec["metric"])
    total = sum(agg_data.values())
    dim_label = COLUMN_LABELS.get(rec["dimension"], rec["dimension"])
    metric_label = COLUMN_LABELS.get(rec["metric"], rec["metric"])

    stats_text = (
        f'按"{dim_label}"分组的"{metric_label}"合计:\n'
        + "\n".join(f"- {k}: {v}" for k, v in agg_data.items())
        + f"\n总计: {total}"
    )

    # Second LLM call for structured analysis insight (aligned with TS)
    client = AsyncOpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
    try:
        response = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "你是资深销售数据分析顾问。根据统计数据提供有洞察力的分析。",
                },
                {
                    "role": "user",
                    "content": (
                        f"用户问题: {query}\n\n【统计数据】\n{stats_text}\n\n规则:\n"
                        "1. 提供总结、见解和洞察\n"
                        "2. 指出关键发现：谁表现突出、谁需要关注\n"
                        "3. 引用的数字必须与统计完全一致\n"
                        "4. 控制在150字以内"
                    ),
                },
            ],
            max_tokens=512,
            temperature=0,
        )
        analysis = response.choices[0].message.content or f"查询到 {len(deps.data)} 条数据。"
    except Exception:
        analysis = f"查询到 {len(deps.data)} 条数据。列: {deps.columns}。数据已准备好生成图表。"

    return f"分析结果：{analysis}"


@agent.tool
async def chart_tool(ctx: RunContext[AgentDeps], query: str = "") -> str:
    """根据查询结果生成 ECharts 图表。query 参数是用户的原始问题文本。"""
    from app.charts import generate_chart_html

    deps = ctx.deps
    await deps.send("step", {"type": "tool_call", "toolName": "chartTool"})

    if not deps.data:
        return "请先调用 query_tool 获取数据"

    query = query or deps.original_query
    html, option = generate_chart_html(query, deps.data, deps.columns)
    deps.chart_html = html
    deps.chart_option = option

    if html:
        return "图表已生成"
    return "图表生成失败（无数据）"
