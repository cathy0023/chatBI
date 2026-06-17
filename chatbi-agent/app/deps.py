"""Agent dependencies — injected into every tool call."""
from dataclasses import dataclass, field
from collections.abc import Callable
from app.db import Database


@dataclass
class AgentDeps:
    session_id: str
    db: Database
    send: Callable  # async (event: str, data: dict) -> None
    # Query state
    data: list = field(default_factory=list)
    columns: list = field(default_factory=list)
    sql: str | None = None
    # Chart state
    chart_html: str | None = None
    chart_option: dict | None = None
    # Embedded mode (MGV iframe)
    embedded: bool = False
    labels: list = field(default_factory=list)
    # New fields for P0-P2 gap closing
    original_query: str = ""
    previous_query_context: dict | None = None  # {sql, query}
