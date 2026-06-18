# -*- coding: utf-8 -*-
"""
Pydantic AI Agent definition + tool registration.
Aligned with TS Agent capabilities (P0-P2).

Tool implementations live in app/tools/*. agent.py only keeps:
  - Model setup
  - System prompts (normal + embedded)
  - Agent() construction with reliability params
  - @agent.tool decoration (delegates to tool modules)
"""
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.deps import AgentDeps
from app.config import OPENAI_API_KEY, OPENAI_BASE_URL, LLM_MODEL
from app.tools.query_tool import query_tool, prepare_query_tool
from app.tools.analysis_tool import analysis_tool
from app.tools.chart_tool import chart_tool

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

EMBEDDED_SYSTEM_PROMPT = (
    "你是数据分析助手。\n\n"
    "MGV AI 已通过 iframe 传递了当前页面的数据（records + columns），数据已直接加载到上下文中。\n"
    "列有对应的中文标签（如 \"深入沟通占比\"、\"加微数\" 等），工具会自动使用标签来理解和分析数据。\n\n"
    "你可以使用以下工具：\n\n"
    "1. **analysisTool**: 分析已提供的数据，生成洞察和总结。\n"
    "   - 用于：趋势分析、排名对比、异常发现\n"
    "   - 数据已直接提供，直接调用即可\n\n"
    "2. **chartTool**: 生成可视化图表（柱状图、折线图、饼图等）。\n"
    "   - 数据已直接提供，直接调用即可\n\n"
    "工作流程：\n"
    "1. 直接调用 analysisTool 生成文字洞察\n"
    "2. 调用 chartTool 生成图表\n"
    "3. 综合给出完整回答\n\n"
    "规则：\n"
    "- 引用的数字必须与已提供的数据完全一致\n"
    "- 不要自行计算或推测\n"
    "- 控制在 300 字以内\n"
    "- 直接回答用户问题\n"
    "- **禁止调用 queryTool**（数据已直接提供，无需 NL2SQL 查询）\n"
    "- **必须生成最终文字回答**\n"
    "- **必须调用 chartTool 生成图表**\n"
)


def build_system_prompt_with_context(deps: AgentDeps) -> str:
    """Build system prompt with previous query context injected."""
    # 嵌入模式：使用专用的 embedded prompt
    if deps.embedded:
        return EMBEDDED_SYSTEM_PROMPT

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
    tool_timeout=30.0,  # 单工具 30s 超时
)


# ── Dynamic system prompt ────────────────────────────────────────

@agent.system_prompt
async def _system_prompt(ctx: RunContext[AgentDeps]) -> str:
    return build_system_prompt_with_context(ctx.deps)


# ── Tool registration (impls imported from app/tools/) ──────────

agent.tool(prepare=prepare_query_tool)(query_tool)
agent.tool(analysis_tool)
agent.tool(chart_tool)
