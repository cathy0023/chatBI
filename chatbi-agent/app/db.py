import sqlite3
from pathlib import Path
from app.config import DB_PATH


class Database:
    def __init__(self, db_path: str | None = None):
        path = db_path or DB_PATH
        if not Path(path).is_absolute():
            path = str(Path(__file__).parent.parent / path)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

    def execute(self, sql: str) -> tuple[list[str], list[dict]]:
        cursor = self.conn.execute(sql)
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return columns, rows

    def get_distinct_names(self) -> list[str]:
        cursor = self.conn.execute("SELECT DISTINCT name FROM sales_performance")
        return [row[0] for row in cursor.fetchall()]

    # ── Session CRUD ───────────────────────────────────────────────

    def ensure_session(self, session_id: str) -> None:
        """Create session if not exists."""
        row = self.conn.execute(
            "SELECT id FROM chat_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            self.conn.execute(
                "INSERT INTO chat_sessions (id, title) VALUES (?, NULL)",
                (session_id,),
            )
            self.conn.commit()

    def update_session_title(self, session_id: str, title: str) -> None:
        """Update session title (skip corrupted titles)."""
        if '\uFFFD' in title:
            return
        self.conn.execute(
            "UPDATE chat_sessions SET title = ? WHERE id = ?",
            (title, session_id),
        )
        self.conn.commit()

    # ── Message CRUD ──────────────────────────────────────────────

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        ui_schema: str | None = None,
    ) -> str:
        """Insert a chat message, return its id."""
        import uuid
        msg_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, ui_schema) "
            "VALUES (?, ?, ?, ?, ?)",
            (msg_id, session_id, role, content, ui_schema),
        )
        self.conn.commit()
        return msg_id

    def get_messages(self, session_id: str) -> list[dict]:
        """Return all messages for a session, oldest first."""
        cursor = self.conn.execute(
            "SELECT role, content, ui_schema FROM chat_messages "
            "WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        return [
            {"role": row[0], "content": row[1], "ui_schema": row[2]}
            for row in cursor.fetchall()
        ]

    def close(self):
        self.conn.close()
