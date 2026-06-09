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

    def close(self):
        self.conn.close()
