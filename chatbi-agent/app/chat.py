"""
POST /agent/chat — SSE streaming endpoint compatible with chatBI frontend.
Handles: greeting detection, session management, history loading,
message persistence, and SSE event ordering.
"""
import asyncio
import json
import re
import uuid
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse
from pydantic_ai.messages import UserPromptPart, TextPart

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import Database
from app.deps import AgentDeps
from app.agent import agent
from app.sse import format_sse

router = APIRouter()

GREETING_PATTERN = re.compile(
    r'^(你好|hi|hello|嗨|hey|哈喽|早上好|下午好|晚上好|您好)([!.?？。！]*\s*)?$',
    re.IGNORECASE,
)


class ChatRequest(BaseModel):
    message: str
    sessionId: str | None = None


def _extract_previous_query_context(
    history_rows: list[dict],
) -> dict | None:
    """Extract SQL + user query from the last assistant message with ui_schema."""
    for i in range(len(history_rows) - 1, -1, -1):
        row = history_rows[i]
        if row["role"] != "assistant" or not row.get("ui_schema"):
            continue
        try:
            parsed = json.loads(row["ui_schema"])
            sql = parsed.get("sql")
            if sql and sql != "-- fallback: no results":
                # Find the user query that preceded this assistant message
                query = ""
                for j in range(i - 1, -1, -1):
                    if history_rows[j]["role"] == "user":
                        query = history_rows[j]["content"]
                        break
                return {"sql": sql, "query": query}
        except (json.JSONDecodeError, TypeError):
            pass
    return None


def _history_to_model_messages(
    history_rows: list[dict],
) -> list[ModelMessage]:
    """Convert DB history rows to Pydantic AI ModelMessage format."""
    messages: list[ModelMessage] = []
    for row in history_rows:
        role = row["role"]
        content = row["content"]
        if role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        elif role == "assistant":
            messages.append(ModelResponse(parts=[TextPart(content=content)]))
    return messages


@router.post("/agent/chat")
async def chat(req: ChatRequest):
    session_id = req.sessionId or str(uuid.uuid4())
    user_prompt = req.message.strip()

    # Empty input → friendly SSE response
    if not user_prompt:
        async def _empty():
            yield format_sse("session", {"sessionId": session_id})
            yield format_sse("text", {"text": "请输入您的问题，比如「各部门成交数」「各月成交趋势」。"})
            yield format_sse("done", {"sessionId": session_id})
        return StreamingResponse(
            _empty(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    db = Database()

    # Ensure session exists
    db.ensure_session(session_id)

    # Set session title on first message
    try:
        rows = db.get_messages(session_id)
        if len(rows) == 0:
            title = user_prompt if len(user_prompt) <= 30 else user_prompt[:30] + "…"
            db.update_session_title(session_id, title)
    except Exception:
        pass

    # Persist user message
    db.add_message(session_id, "user", user_prompt)

    # Greeting detection — return friendly greeting, skip agent
    if GREETING_PATTERN.match(user_prompt):
        greeting = "你好！我是 ChatBI 数据分析助手。你可以用自然语言提问，我会帮你查询和分析数据。\n\n试试看吧！"
        db.add_message(session_id, "assistant", greeting)
        db.close()

        async def _greeting():
            yield format_sse("session", {"sessionId": session_id})
            yield format_sse("text", {"text": greeting})
            yield format_sse("done", {"sessionId": session_id})
        return StreamingResponse(
            _greeting(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    # Load history & extract previous query context
    history_rows = db.get_messages(session_id)
    previous_query_context = _extract_previous_query_context(history_rows)
    model_history = _history_to_model_messages(history_rows[:-1])  # exclude current user msg

    queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()

    async def send(event: str, data: dict):
        await queue.put((event, data))

    deps = AgentDeps(
        session_id=session_id,
        db=db,
        send=send,
        original_query=user_prompt,
        previous_query_context=previous_query_context,
    )

    async def run_agent():
        try:
            # 60s timeout aligned with TS Agent's AbortController
            result = await asyncio.wait_for(
                agent.run(
                    user_prompt,
                    deps=deps,
                    message_history=model_history if model_history else None,
                ),
                timeout=60,
            )
            text = str(result.output) if result.output else ""

            # SSE event order: text → data → chart → done (aligned with TS)
            if not text and deps.data:
                text = "已完成数据查询，请查看右侧数据结果。"

            if text:
                await queue.put(("text", {"text": text}))

            if deps.data:
                await queue.put(("data", {
                    "columns": deps.columns,
                    "records": deps.data,
                    "sql": deps.sql,
                }))

            if deps.chart_html:
                await queue.put(("chart", {
                    "html": deps.chart_html,
                    "option": deps.chart_option,
                }))

            # Persist assistant message with ui_schema
            ui_schema = None
            if deps.chart_html or deps.chart_option or deps.sql:
                ui_schema = json.dumps({
                    "chartHtml": deps.chart_html,
                    "chartOption": deps.chart_option,
                    "records": deps.data if deps.data else None,
                    "columns": deps.columns if deps.columns else None,
                    "sql": deps.sql,
                }, ensure_ascii=False)
            db.add_message(session_id, "assistant", text, ui_schema)

        except asyncio.TimeoutError:
            await queue.put(("text", {"text": "请求超时，请重试。"}))
        except Exception as e:
            import traceback
            traceback.print_exc()
            await queue.put(("error", {"error": str(e), "message": str(e)}))
        finally:
            await queue.put(("done", {"sessionId": session_id}))

    async def event_generator():
        yield format_sse("session", {"sessionId": session_id})

        agent_task = asyncio.create_task(run_agent())

        try:
            while True:
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=120)
                    yield format_sse(event, data)
                    if event == "done":
                        break
                except asyncio.TimeoutError:
                    yield format_sse("status", {"phase": "processing"})
        finally:
            if not agent_task.done():
                agent_task.cancel()
            db.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
