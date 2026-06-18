# -*- coding: utf-8 -*-
"""queryTool — NL2SQL 查询销售数据."""
import json
import re
import sqlite3

from pydantic_ai import RunContext, ModelRetry
from pydantic_ai.tools import ToolDefinition

from app.deps import AgentDeps


def prepare_query_tool(
    ctx: RunContext[AgentDeps], tool_def: ToolDefinition,
) -> ToolDefinition | None:
    """嵌入模式下从工具列表中移除 queryTool，避免 LLM 浪费回合调用它."""
    if ctx.deps.embedded:
        return None
    return tool_def


def _merge_query_results(
    deps: AgentDeps, records: list[dict], columns: list[str], sql: str,
) -> tuple[list[dict], list[str]]:
    """纯函数：计算新的 (data, columns)，不 mutate deps.

    解决 ModelRetry 重试脏状态：原实现边算边赋值 deps.data，
    若中途抛错 → deps 已脏 → 重试重复累积。改为先计算后赋值。
    """
    name_match = re.search(r"name\s*=\s*'([^']+)'", sql, re.IGNORECASE)
    person_name = name_match.group(1) if name_match else "整体"
    annotated = [
        {**r, "name": person_name}
        if r.get("name") is None or str(r.get("name", "")).strip() == ""
        else {**r}
        for r in records
    ]

    if deps.data and deps.columns:
        # Multi-query merge (e.g., "person vs overall" comparison)
        new_data = [*deps.data, *annotated]
        new_cols = [c for c in columns if c not in deps.columns]
        if "name" not in deps.columns:
            new_columns = [*deps.columns, "name", *new_cols]
        else:
            new_columns = [*deps.columns, *new_cols]
    else:
        # First query
        new_data = annotated
        new_columns = columns if "name" in columns else ["name", *columns]

    return new_data, new_columns


async def query_tool(ctx: RunContext[AgentDeps], question: str) -> str:
    """根据用户问题查询销售数据。question 参数是用户的原始问题文本。"""
    deps = ctx.deps

    from app.nl2sql import nl2sql_query
    from app.query_helpers import resolve_short_name, suggest_similar_name

    await deps.send("step", {"type": "tool_call", "toolName": "queryTool"})

    # Short name resolution before NL2SQL
    resolved_question = resolve_short_name(deps.db, question)

    try:
        sql, columns, records = await nl2sql_query(resolved_question, deps.db)

        # 纯函数计算新状态，不触碰 deps（原子更新原则）
        new_data, new_columns = _merge_query_results(deps, records, columns, sql)

        # 原子赋值：所有计算成功后才更新 deps，避免 ModelRetry 重试时脏状态
        deps.data = new_data
        deps.columns = new_columns
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
    except (sqlite3.OperationalError, TimeoutError) as e:
        # 临时性错误 → 触发框架重试（消耗 retry budget）
        raise ModelRetry(f"数据库查询超时或连接失败: {e}，请重试一次")
    except (TypeError, AttributeError, NameError, ValueError) as e:
        # 编程错误 → 不浪费 retry budget，直接抛出
        raise
    except Exception as e:
        # 其他未预期错误也触发重试
        raise ModelRetry(f"查询执行异常: {e}，请尝试调整查询条件后重试")
