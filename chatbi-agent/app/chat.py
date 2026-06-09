"""
POST /agent/chat — SSE streaming endpoint compatible with chatBI frontend.
"""
import asyncio
import uuid

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import Database
from app.deps import AgentDeps
from app.agent import agent
from app.sse import format_sse

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    sessionId: str | None = None


@router.post("/agent/chat")
async def chat(req: ChatRequest):
    session_id = req.sessionId or str(uuid.uuid4())
    user_prompt = req.message.strip()

    # Empty input → friendly SSE response
    if not user_prompt:
        async def _empty():
            yield format_sse("session", {"sessionId": session_id})
            yield format_sse("text", {"text": "请输入您的问题，比如「各部门成交数」「各月成交趋势」。"})
            yield format_sse("done", {})
        return StreamingResponse(
            _empty(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    db = Database()
    queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()

    async def send(event: str, data: dict):
        await queue.put((event, data))

    deps = AgentDeps(session_id=session_id, db=db, send=send)

    async def run_agent():
        try:
            result = await agent.run(user_prompt, deps=deps)
            await queue.put(("text", {"text": str(result.output) if result.output else ""}))
        except Exception as e:
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
