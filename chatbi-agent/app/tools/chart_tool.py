# -*- coding: utf-8 -*-
"""chartTool — 基于 ECharts 生成可视化图表."""
from pydantic_ai import RunContext, ModelRetry

from app.deps import AgentDeps


async def chart_tool(ctx: RunContext[AgentDeps], query: str = "") -> str:
    """根据查询结果生成 ECharts 图表。query 参数是用户的原始问题文本。"""
    from app.charts import generate_chart_html

    deps = ctx.deps
    await deps.send("step", {"type": "tool_call", "toolName": "chartTool"})

    if not deps.data:
        return "请先调用 query_tool 获取数据"

    query = query or deps.original_query
    try:
        html, option = generate_chart_html(query, deps.data, deps.columns, deps.labels)
    except Exception as e:
        raise ModelRetry(f"图表生成异常: {e}，请重试一次")
    # 原子赋值：generate_chart_html 成功后才更新 deps
    deps.chart_html = html
    deps.chart_option = option

    if html:
        return "图表已生成"
    return "图表生成失败（无数据）"
