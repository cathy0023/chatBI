"""Agent dependencies — injected into every tool call."""
from dataclasses import dataclass, field
from collections.abc import Callable
from app.db import Database


@dataclass
class AgentDeps:
    session_id: str
    db: Database
    send: Callable  # async (event: str, data: dict) -> None
    data: list = field(default_factory=list)
    columns: list = field(default_factory=list)
    sql: str | None = None
    chart_html: str | None = None
    chart_option: dict | None = None
