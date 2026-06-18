"""FastAPI entry point."""
import os

import logfire
from logfire._internal.config import ConsoleOptions
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.chat import router
from app.config import PORT

# ── Logfire 可观测性接入 ─────────────────────────────────────────
# 默认本地模式：不上传到 Logfire SaaS，控制台输出 trace。
# 设置 LOGFIRE_TOKEN 环境变量后自动切换到云端模式。
_logfire_token = os.environ.get("LOGFIRE_TOKEN")
logfire.configure(
    send_to_logfire=bool(_logfire_token),
    token=_logfire_token,
    service_name="chatbi-agent",
    console=ConsoleOptions(show_project_link=False) if not _logfire_token else False,
)
# 自动 instrument Pydantic AI：捕获每次 LLM 调用、工具调用、retry 的 span
logfire.instrument_pydantic_ai()

app = FastAPI(title="ChatBI Pydantic AI Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
