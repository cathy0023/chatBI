"""Fuzzy name matching helpers — ported from TS query-tool.ts."""
import re
from app.db import Database

# Module-level cache of all distinct names
_cached_all_db_names: list[str] | None = None


def _get_all_db_names(db: Database) -> list[str]:
    global _cached_all_db_names
    if _cached_all_db_names is None:
        _cached_all_db_names = db.get_distinct_names()
    return _cached_all_db_names


def resolve_short_name(db: Database, query: str) -> str:
    """Auto-resolve short Chinese names to full DB names.

    e.g., "马玉鹏的销售数据" → "马玉鹏2的销售数据" when only one fuzzy match exists.
    Returns the (possibly modified) query string.
    """
    all_names = _get_all_db_names(db)

    # Skip if query already contains an exact DB name
    if any(name in query for name in all_names):
        return query

    # Try to extract a 2-4 char Chinese name candidate
    match = re.search(
        r'([^\x00-\x7F]{2,4})(?:的|个人|和整体|走势|折线|柱状|饼图|\d)', query
    )
    if not match:
        return query

    candidate = match.group(1)
    # Skip common non-name words
    skip_pattern = (
        r'部门|校区|销售|成交|数据|月份|趋势|对比|比较|排名|汇总|合计'
        r'|总计|查询|查看|帮我|请问|分析'
    )
    if re.search(skip_pattern, candidate):
        return query

    # Check exact match first
    cursor = db.conn.execute(
        "SELECT COUNT(*) as cnt FROM sales_performance WHERE name = ?",
        (candidate,),
    )
    row = cursor.fetchone()
    if row and row[0] > 0:
        return query  # Exact match exists, no rewrite needed

    # Single fuzzy match → auto-resolve
    cursor = db.conn.execute(
        "SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5",
        (f'%{candidate}%',),
    )
    matches = [row[0] for row in cursor.fetchall()]
    if len(matches) == 1:
        resolved = matches[0]
        query = re.sub(re.escape(candidate), resolved, query)
        # Prevent digit boundary confusion: "马玉鹏2" + "7月" → "马玉鹏2 7月"
        query = re.sub(
            re.escape(resolved) + r'(\d)',
            f'{resolved} \\1',
            query,
        )

    return query


def suggest_similar_name(
    db: Database, sql: str, query: str
) -> str | None:
    """Two-stage fuzzy search for similar names when query returns 0 results."""
    # Extract name from SQL WHERE clause
    name_match = (
        re.search(r"WHERE\s+name\s*=\s*'([^']+)'", sql, re.IGNORECASE)
        or re.search(r'WHERE\s+name\s*=\s*"([^"]+)"', sql, re.IGNORECASE)
    )
    target_name = name_match.group(1) if name_match else None
    if not target_name or len(target_name) < 2:
        return None

    # Level 1: Substring match
    cursor = db.conn.execute(
        "SELECT DISTINCT name FROM sales_performance "
        "WHERE name LIKE ? AND name != ? LIMIT 5",
        (f'%{target_name}%', target_name),
    )
    similar = [row[0] for row in cursor.fetchall()]
    if similar:
        name_list = '、'.join(similar)
        return (
            f'未找到「{target_name}」的销售记录。'
            f'数据库中名字包含「{target_name}」的有：{name_list}。'
            '请使用正确的名字重新调用 queryTool 查询。'
        )

    # Level 2: Character-level match
    for char in target_name:
        cursor = db.conn.execute(
            "SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5",
            (f'%{char}%',),
        )
        char_matches = [row[0] for row in cursor.fetchall()]
        if char_matches:
            name_list = '、'.join(char_matches)
            return (
                f'未找到「{target_name}」的销售记录。'
                f'名字中包含相似字符「{char}」的有：{name_list}。'
                '请使用正确的名字重新调用 queryTool 查询。'
            )

    return None
