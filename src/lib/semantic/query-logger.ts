import { getDb } from '../db/connection';
import type { QueryRecord, QueryStatus } from './types';

const INSERT_SQL = `
  INSERT INTO query_logs (question, generated_sql, status, repaired_sql, error_message, result_row_count, has_all_zero_rows, execution_time_ms)
  VALUES (@question, @generatedSQL, @status, @repairedSQL, @errorMessage, @resultRowCount, @hasAllZeroRows, @executionTimeMs)
`;

const INSERT_STMT = getDb().prepare(INSERT_SQL);

/** 记录一次查询到 query_logs 表 */
export function logQuery(record: Omit<QueryRecord, 'id' | 'createdAt'>): number {
  const result = INSERT_STMT.run({
    question: record.question,
    generatedSQL: record.generatedSQL,
    status: record.status as QueryStatus,
    repairedSQL: record.repairedSQL ?? null,
    errorMessage: record.errorMessage ?? null,
    resultRowCount: record.resultRowCount,
    hasAllZeroRows: record.hasAllZeroRows ? 1 : 0,
    executionTimeMs: record.executionTimeMs,
  });
  return result.lastInsertRowid as number;
}

/** 获取最近 N 小时内某状态的查询记录 */
export function getRecentQueries(status: QueryStatus, hours: number = 24): QueryRecord[] {
  const db = getDb();
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const rows = db.prepare(
    'SELECT * FROM query_logs WHERE status = ? AND created_at >= ? ORDER BY created_at DESC'
  ).all(status, since) as Record<string, unknown>[];

  return rows.map(rowToRecord);
}

/** 计算某时间窗口内的失败率 */
export function getFailRate(sinceHours: number = 24): { total: number; failed: number; rate: number } {
  const db = getDb();
  const since = Math.floor(Date.now() / 1000) - sinceHours * 3600;
  const total = (db.prepare('SELECT COUNT(*) as cnt FROM query_logs WHERE created_at >= ?').get(since) as { cnt: number }).cnt;
  const failed = (db.prepare("SELECT COUNT(*) as cnt FROM query_logs WHERE status IN ('failed', 'repaired') AND created_at >= ?").get(since) as { cnt: number }).cnt;
  return { total, failed, rate: total > 0 ? failed / total : 0 };
}

/** 获取最近 N 条查询记录（用于模式检测） */
export function getRecentLogsForDetection(limit: number = 50): QueryRecord[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM query_logs WHERE status IN ('failed', 'repaired') ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Record<string, unknown>[];

  return rows.map(rowToRecord);
}

function rowToRecord(row: Record<string, unknown>): QueryRecord {
  return {
    id: row.id as number,
    question: row.question as string,
    generatedSQL: row.generated_sql as string,
    status: row.status as QueryStatus,
    repairedSQL: (row.repaired_sql as string) || undefined,
    errorMessage: (row.error_message as string) || undefined,
    resultRowCount: row.result_row_count as number,
    hasAllZeroRows: Boolean(row.has_all_zero_rows),
    executionTimeMs: row.execution_time_ms as number,
    createdAt: row.created_at as number,
  };
}
