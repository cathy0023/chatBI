# -*- coding: utf-8 -*-
"""Unit tests for Python Agent P0 hardening: UsageLimits + ModelRetry + tool_timeout."""
import asyncio
import pytest
from pydantic_ai import Agent, RunContext, UsageLimits, ModelRetry
from pydantic_ai.models.test import TestModel
from pydantic_ai.exceptions import UsageLimitExceeded, UnexpectedModelBehavior


# ── Test fixtures ─────────────────────────────────────────────────

class MockDeps:
    """Minimal deps for testing — no DB, no SSE."""
    def __init__(self):
        self.data: list = []


def _make_test_agent(tool_timeout: float = 0.2):
    """Create an agent backed by TestModel (no real LLM calls)."""
    return Agent(
        TestModel(),
        deps_type=MockDeps,
        output_type=str,
        retries={"tools": 2, "output": 1},
        tool_timeout=tool_timeout,
    )


# ── Scenario 1: Step cap (UsageLimits) ──────────────────────────

@pytest.mark.asyncio
async def test_step_cap_usage_limit_exceeded():
    """request_limit=1 → 第 2 次 LLM request 前触发 UsageLimitExceeded."""
    agent = _make_test_agent()
    call_counter = {"count": 0}

    @agent.tool
    async def loop_tool(ctx: RunContext[MockDeps], question: str) -> str:
        call_counter["count"] += 1
        return f"查询结果 {call_counter['count']}"

    deps = MockDeps()

    # request_limit=1: 第一次 request 调用 tool + 生成文本 → 1 request used.
    # 第二次 request 前 check_before_request 检测到 requests >= 1 → UsageLimitExceeded.
    with pytest.raises(UsageLimitExceeded):
        await agent.run(
            "query",
            deps=deps,
            usage_limits=UsageLimits(request_limit=1),
        )

    assert call_counter["count"] >= 1


# ── Scenario 2: ModelRetry — 临时性错误重试后成功 ──────────

@pytest.mark.asyncio
async def test_model_retry_success_after_retries():
    """工具前 2 次抛 ModelRetry，第 3 次成功."""
    agent = _make_test_agent()
    call_counter = {"count": 0}

    @agent.tool
    async def retry_tool(ctx: RunContext[MockDeps], question: str) -> str:
        call_counter["count"] += 1
        if call_counter["count"] < 3:
            raise ModelRetry(f"DB timeout (attempt {call_counter['count']})")
        return f"成功 (第{call_counter['count']}次)"

    deps = MockDeps()
    result = await agent.run(
        "查询",
        deps=deps,
        usage_limits=UsageLimits(request_limit=10, tool_calls_limit=5),
    )

    assert call_counter["count"] == 3
    assert "成功" in str(result.output)


# ── Scenario 3: tool_timeout — 超时耗尽重试后抛异常 ───────────

@pytest.mark.asyncio
async def test_tool_timeout_exhausts_retries():
    """工具执行超时 → 重试 → 重试耗尽 → UnexpectedModelBehavior."""
    agent = _make_test_agent(tool_timeout=0.1)  # 100ms timeout
    call_counter = {"count": 0}

    @agent.tool
    async def slow_tool(ctx: RunContext[MockDeps], question: str) -> str:
        call_counter["count"] += 1
        await asyncio.sleep(0.5)  # >> tool_timeout=0.1
        return "never reached"

    deps = MockDeps()

    with pytest.raises(UnexpectedModelBehavior):
        await agent.run(
            "查询",
            deps=deps,
            usage_limits=UsageLimits(request_limit=10, tool_calls_limit=5),
        )

    # 1 initial + 2 retries = 3 calls (retries={"tools": 2})
    assert call_counter["count"] == 3


# ── Scenario 4: 确定性错误不触发重试 ─────────────────────────────

@pytest.mark.asyncio
async def test_deterministic_error_does_not_retry():
    """确定性错误 return str → 不消耗 retry budget, LLM 获得友好建议."""
    agent = _make_test_agent()
    call_counter = {"count": 0}

    @agent.tool
    async def no_data_tool(ctx: RunContext[MockDeps], question: str) -> str:
        call_counter["count"] += 1
        return "未找到匹配的数据，推荐: 张三"

    deps = MockDeps()
    result = await agent.run(
        "黄子诚的成交",
        deps=deps,
        usage_limits=UsageLimits(request_limit=5),
    )

    assert call_counter["count"] == 1
    assert "张三" in str(result.output)
