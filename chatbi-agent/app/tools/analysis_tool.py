# -*- coding: utf-8 -*-
"""analysisTool — 二次 LLM 调用生成结构化数据洞察."""
import json

from pydantic_ai import RunContext, ModelRetry

from app.deps import AgentDeps


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

    if deps.embedded:
        # Embedded mode: pass raw data directly for accurate analysis
        data_payload = json.dumps(deps.data[:30], ensure_ascii=False)
        cols_text = ", ".join(deps.labels or deps.columns)
        stats_text = f"数据列: {cols_text}\n数据:\n{data_payload}"
    else:
        # Normal mode: aggregate by detected dimension/metric
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
    except Exception as e:
        row_count = len(deps.data)
        raise ModelRetry(
            f"数据分析LLM调用失败: {e}。当前有 {row_count} 条数据，"
            f"请重试一次。如果持续失败，请直接根据数据给出你的观察和建议。"
        )

    return f"分析结果：{analysis}"
