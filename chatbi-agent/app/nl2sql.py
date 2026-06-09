"""
NL2SQL engine — LLM call + SQL generation + self-repair.
Port of nl2sql.ts.
"""
import re
from openai import AsyncOpenAI
from app.config import OPENAI_API_KEY, OPENAI_BASE_URL, LLM_MODEL
from app.semantic import build_nl2sql_prompt, validate_sql
from app.db import Database

_client = AsyncOpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)


def extract_sql(raw: str) -> str:
    text = raw
    match = re.search(r'```(?:sql)?\s*\n?([\s\S]*?)```', text)
    if match:
        text = match.group(1)
    return re.sub(r'^--.*$', '', text, flags=re.MULTILINE).strip().rstrip(';')


def post_process_sql(sql: str, question: str) -> str:
    """Post-process SQL: fix BETWEEN, rewrite month comparisons."""
    # Don't rewrite UNION queries
    if re.search(r'\bUNION\b', sql, re.IGNORECASE):
        return sql

    # Fix BETWEEN on month field
    between_match = re.search(
        r"WHERE\s+month\s+BETWEEN\s+'([^']+)'\s+AND\s+'([^']+)'", sql, re.IGNORECASE,
    )
    if between_match:
        start_num = int(between_match.group(1)) if between_match.group(1).isdigit() else None
        end_num = int(between_match.group(2)) if between_match.group(2).isdigit() else None
        if start_num is not None and end_num is not None:
            lo, hi = min(start_num, end_num), max(start_num, end_num)
            months = ','.join(f"'{i}月'" for i in range(lo, hi + 1))
            sql = re.sub(
                r"WHERE\s+month\s+BETWEEN\s+'[^']+'\s+AND\s+'[^']+'",
                f"WHERE month IN ({months})", sql, flags=re.IGNORECASE,
            )

    return sql


def ensure_name_filter(sql: str, question: str, known_names: list[str]) -> str:
    """If question mentions a person name but SQL lacks WHERE name = '...', inject it."""
    mentioned = [n for n in known_names if n in question]
    if not mentioned:
        return sql
    # Already has correct filter
    for name in mentioned:
        escaped = re.escape(name)
        if re.search(rf"WHERE\s+name\s*=\s*'{escaped}'", sql, re.IGNORECASE):
            return sql

    name = mentioned[0]
    safe_name = name.replace("'", "''")

    # Replace wrong name filter if present
    wrong_filter = re.search(r"WHERE\s+name\s*=\s*'[^']+'", sql, re.IGNORECASE)
    if wrong_filter:
        return re.sub(
            r"WHERE\s+name\s*=\s*'[^']+'",
            f"WHERE name = '{safe_name}'", sql, flags=re.IGNORECASE,
        )

    # No WHERE or add to existing WHERE
    if re.search(r'WHERE', sql, re.IGNORECASE):
        return re.sub(r'WHERE\s+', f"WHERE name = '{safe_name}' AND ", sql, flags=re.IGNORECASE)
    else:
        return re.sub(
            r'FROM\s+sales_performance\s*',
            f"FROM sales_performance WHERE name = '{safe_name}' ",
            sql, flags=re.IGNORECASE,
        )


async def generate_sql(question: str) -> str:
    prompt = build_nl2sql_prompt(question)
    response = await _client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1024,
        temperature=0,
    )
    sql = extract_sql(response.choices[0].message.content or "")
    if not sql.strip():
        raise ValueError("LLM returned empty SQL")
    return sql


async def self_repair(question: str, original_sql: str, error: str) -> str:
    repair_prompt = f"""你之前生成的 SQL 有错误，请修正。

原始问题: "{question}"
错误的 SQL: {original_sql}
错误信息: {error}

表结构: sales_performance (id INTEGER, name TEXT, department TEXT, month TEXT, wechat_added INTEGER, interaction INTEGER, demand INTEGER, deal INTEGER)

请只输出修正后的 SQL，不要其他内容。"""

    response = await _client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": repair_prompt}],
        max_tokens=1024,
        temperature=0,
    )
    return extract_sql(response.choices[0].message.content or "")


async def nl2sql_query(question: str, db: Database) -> tuple[str, list[str], list[dict]]:
    """
    Full NL2SQL pipeline: generate → post-process → validate → execute → self-repair.
    Returns (sql, columns, records).
    Raises on unrecoverable failure.
    """
    # Generate
    raw_sql = await generate_sql(question)
    raw_sql = post_process_sql(raw_sql, question)

    # Name filter safeguard
    known_names = db.get_distinct_names()
    raw_sql = ensure_name_filter(raw_sql, question, known_names)

    # Validate
    valid, final_sql, error = validate_sql(raw_sql)

    if not valid:
        # Self-repair once
        repaired = await self_repair(question, raw_sql, error)
        valid, final_sql, error = validate_sql(repaired)
        if not valid:
            raise ValueError(f"SQL 验证失败: {error}")

    # Execute
    columns, records = db.execute(final_sql)
    return final_sql, columns, records
