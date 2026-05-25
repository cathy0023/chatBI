import { getAllowedTables, getAllowedColumns } from './model';

type ValidationResult =
  | { valid: true; sql: string }
  | { valid: false; sql: string; reason: string };

const DANGEROUS_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE|TRUNCATE)\b/i;
const MULTI_STATEMENT = /;\s*\w/;

export function validateSQL(rawSql: string): ValidationResult {
  const sql = rawSql.trim();

  // Rule 1: Must be SELECT
  if (!/^SELECT\b/i.test(sql)) {
    return { valid: false, sql, reason: '只允许 SELECT 查询' };
  }

  // Rule 2: No dangerous keywords
  if (DANGEROUS_KEYWORDS.test(sql)) {
    return { valid: false, sql, reason: '包含不允许的操作关键字' };
  }

  // Rule 3: No multi-statement injection
  if (MULTI_STATEMENT.test(sql)) {
    return { valid: false, sql, reason: '不允许多条语句' };
  }

  // Rule 4: Table whitelist
  const allowedTables = getAllowedTables();
  const tablePattern = /\bFROM\s+(\w+)|\bJOIN\s+(\w+)/gi;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(sql)) !== null) {
    const tableName = match[1] || match[2];
    if (tableName && !allowedTables.includes(tableName.toLowerCase())) {
      return { valid: false, sql, reason: `unknown table: ${tableName}` };
    }
  }

  // Rule 4.5: Reject BETWEEN on month field (text comparison returns empty for '10月' < '7月')
  if (/\bmonth\s+BETWEEN\b/i.test(sql)) {
    return { valid: false, sql, reason: "month字段禁止使用BETWEEN，请使用IN列表如: month IN ('7月','8月')" };
  }

  // Collect AS aliases so they are not flagged as unknown columns
  const aliases = new Set<string>();
  const aliasPattern = /\bAS\s+([a-zA-Z_]\w*)\b/gi;
  let aliasMatch: RegExpExecArray | null;
  while ((aliasMatch = aliasPattern.exec(sql)) !== null) {
    aliases.add(aliasMatch[1]);
  }

  // Rule 5: Column whitelist
  const allowedColumns = getAllowedColumns();
  const sqlKeywords = new Set([
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like', 'between',
    'group', 'by', 'order', 'asc', 'desc', 'limit', 'offset', 'as', 'on',
    'join', 'left', 'right', 'inner', 'outer', 'having', 'distinct', 'all',
    'sum', 'avg', 'count', 'max', 'min', 'round', 'nullif', 'coalesce',
    'case', 'when', 'then', 'else', 'end', 'is', 'null', 'true', 'false',
    'exists', 'union', 'intersect', 'except', 'with', 'recursive',
  ]);
  const identifierPattern = /\b([a-zA-Z_]\w*)\b/g;
  while ((match = identifierPattern.exec(sql)) !== null) {
    const id = match[1].toLowerCase();
    if (!sqlKeywords.has(id) && !allowedTables.includes(id) && !aliases.has(match[1])) {
      if (/^[a-z]/i.test(match[1]) && !allowedColumns.includes(match[1])) {
        return { valid: false, sql, reason: `unknown column: ${match[1]}` };
      }
    }
  }

  // Rule 6: Auto-append LIMIT
  let finalSql = sql;
  if (!/\bLIMIT\s+\d+/i.test(sql)) {
    finalSql = `${sql} LIMIT 1000`;
  }

  return { valid: true, sql: finalSql };
}
