"""
Semantic model, NL2SQL prompt builder, and SQL validator.
Port of model.ts + prompt-builder.ts + validator.ts.
"""
import re

# ── Semantic Model ──────────────────────────────────────────────

SALES_SEMANTIC_MODEL = {
    "domain": "sales_performance",
    "description": "在线教育销售团队月度业绩数据",
    "tables": [{
        "name": "sales_performance",
        "description": "销售人员月度业绩表，每人每月一条记录",
        "dimensions": [
            {"column": "name", "label": "姓名",
             "synonyms": ["销售员", "销售人员", "个人", "谁", "人员"],
             "description": "销售人员姓名"},
            {"column": "department", "label": "部门",
             "synonyms": ["校区", "团队", "中心", "分中心"],
             "description": "销售人员所属部门或校区"},
            {"column": "month", "label": "月份",
             "synonyms": ["月", "月度"],
             "description": "数据所属月份",
             "enum": ["7月", "8月", "9月", "10月"]},
        ],
        "metrics": [
            {"column": "wechat_added", "label": "加微数",
             "synonyms": ["加微信", "加微", "加到微信"],
             "description": "当月新增微信好友数量", "default_agg": "SUM"},
            {"column": "interaction", "label": "互动数",
             "synonyms": ["企微互动", "互动", "企微"],
             "description": "企业微信互动次数", "default_agg": "SUM"},
            {"column": "demand", "label": "需求数",
             "synonyms": ["有需求", "需求", "有意向"],
             "description": "产生需求的客户数量", "default_agg": "SUM"},
            {"column": "deal", "label": "成交数",
             "synonyms": ["成交", "销量", "成单", "卖出"],
             "description": "成交订单数量", "default_agg": "SUM"},
        ],
    }],
    "business_context":
        "在线教育公司销售团队管理场景。数据按月统计，每位销售人员每月一条记录。"
        "转化漏斗：加微 → 互动 → 产生需求 → 成交。"
        "用户通常关心：谁卖得最好、各部门对比、月度趋势、个人成长、转化率。",
}

COLUMN_LABELS = {
    "name": "姓名", "department": "部门", "month": "月份",
    "wechat_added": "加微数", "interaction": "互动数",
    "demand": "需求数", "deal": "成交数",
}

DDL = """CREATE TABLE sales_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  month TEXT NOT NULL,
  wechat_added INTEGER DEFAULT 0,
  interaction INTEGER DEFAULT 0,
  demand INTEGER DEFAULT 0,
  deal INTEGER DEFAULT 0
);"""

# ── Correction Rules (hardcoded, same as TS seed rules) ─────────

CORRECTION_RULES = [
    "禁止使用中文别名。聚合时保留原始列名，不要加 AS 中文别名，但可以用 AS 原始列名（如 SUM(deal) AS deal）",
    "使用聚合函数(SUM/AVG/COUNT)时必须加 GROUP BY",
    "SUM/AVG 只能用于数值列(wechat_added, interaction, demand, deal)，不能用于 name/department/month",
    "如果查询结果全为0，检查列名是否与表结构匹配",
    "月份值必须是中文格式：7月/8月/9月/10月，不要用纯数字",
    "部门名用 LIKE 模糊匹配，不要用精确等号",
]

# ── Prompt Builder ──────────────────────────────────────────────


def build_nl2sql_prompt(question: str) -> str:
    table = SALES_SEMANTIC_MODEL["tables"][0]

    dim_lines = []
    for d in table["dimensions"]:
        line = f"  - {d['column']} ({d['label']}): {d['description']}"
        if d.get("synonyms"):
            line += f" [同义词: {', '.join(d['synonyms'])}]"
        if d.get("enum"):
            line += f" [有效值: {', '.join(d['enum'])}]"
        dim_lines.append(line)
    dim_desc = "\n".join(dim_lines)

    met_desc = "\n".join(
        f"  - {m['column']} ({m['label']}): {m['description']} "
        f"[同义词: {', '.join(m['synonyms'])}] [默认聚合: {m['default_agg']}]"
        for m in table["metrics"]
    )

    rules_text = "\n".join(f"{i+1}. {r}" for i, r in enumerate(CORRECTION_RULES))

    return f"""你是 SQL 生成引擎。根据以下语义模型定义，将用户的中文问题转换为一条 SQLite SELECT 语句。

【语义模型: {SALES_SEMANTIC_MODEL['description']}】
表: {table['name']} — {table['description']}

维度字段:
{dim_desc}

指标字段:
{met_desc}

业务背景: {SALES_SEMANTIC_MODEL['business_context']}

【表结构 DDL】
{DDL}

【规则】（编号小的优先级高）
{rules_text}

【示例】
问题: "张三的微信添加数"
SQL: SELECT month, wechat_added FROM sales_performance WHERE name = '张三'

问题: "李明7月和8月成交数"
SQL: SELECT month, SUM(deal) AS deal FROM sales_performance WHERE name = '李明' AND month IN ('7月','8月') GROUP BY month

问题: "各部门10月成交数"
SQL: SELECT department, SUM(deal) AS deal FROM sales_performance WHERE month = '10月' GROUP BY department

用户问题: "{question}" """


# ── SQL Validator ───────────────────────────────────────────────

DANGEROUS_KEYWORDS = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE|TRUNCATE)\b',
    re.IGNORECASE,
)
MULTI_STATEMENT = re.compile(r';\s*\w')

ALLOWED_TABLES = ["sales_performance"]
ALLOWED_COLUMNS = [
    "name", "department", "month",
    "wechat_added", "interaction", "demand", "deal",
]

SQL_KEYWORDS = {
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like', 'between',
    'group', 'by', 'order', 'asc', 'desc', 'limit', 'offset', 'as', 'on',
    'join', 'left', 'right', 'inner', 'outer', 'having', 'distinct', 'all',
    'sum', 'avg', 'count', 'max', 'min', 'round', 'nullif', 'coalesce',
    'case', 'when', 'then', 'else', 'end', 'is', 'null', 'true', 'false',
    'exists', 'union', 'intersect', 'except', 'with', 'recursive',
}


def validate_sql(raw_sql: str) -> tuple[bool, str, str]:
    """Validate SQL. Returns (valid, final_sql, error_reason)."""
    sql = raw_sql.strip()

    # Rule 1: Must be SELECT
    if not re.match(r'^SELECT\b', sql, re.IGNORECASE):
        return False, sql, '只允许 SELECT 查询'

    # Rule 2: No dangerous keywords
    if DANGEROUS_KEYWORDS.search(sql):
        return False, sql, '包含不允许的操作关键字'

    # Rule 3: No multi-statement
    if MULTI_STATEMENT.search(sql):
        return False, sql, '不允许多条语句'

    # Rule 4: Table whitelist
    for m in re.finditer(r'\bFROM\s+(\w+)|\bJOIN\s+(\w+)', sql, re.IGNORECASE):
        table_name = m.group(1) or m.group(2)
        if table_name and table_name.lower() not in ALLOWED_TABLES:
            return False, sql, f'unknown table: {table_name}'

    # Rule 4.5: Reject BETWEEN on month
    if re.search(r'\bmonth\s+BETWEEN\b', sql, re.IGNORECASE):
        return False, sql, "month字段禁止使用BETWEEN，请使用IN列表"

    # Collect AS aliases
    aliases = set()
    for m in re.finditer(r'\bAS\s+([a-zA-Z_]\w*)\b', sql, re.IGNORECASE):
        aliases.add(m.group(1))

    # Rule 5: Column whitelist
    for m in re.finditer(r'\b([a-zA-Z_]\w*)\b', sql):
        identifier = m.group(1)
        lower_id = identifier.lower()
        if lower_id in SQL_KEYWORDS or lower_id in ALLOWED_TABLES or identifier in aliases:
            continue
        if identifier[0].isalpha() and identifier not in ALLOWED_COLUMNS:
            return False, sql, f'unknown column: {identifier}'

    # Rule 6: Auto-append LIMIT
    if not re.search(r'\bLIMIT\s+\d+', sql, re.IGNORECASE):
        sql = f'{sql} LIMIT 1000'

    return True, sql, ''
