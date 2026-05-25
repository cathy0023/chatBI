import { getDb } from '../db/connection';
import type { CorrectionRule, ErrorPatternKey } from './types';

/** 冷启动初始规则——从现有 prompt 规则中提取最关键的 6 条 */
const SEED_RULES: Array<{
  patternKey: ErrorPatternKey;
  rule: string;
  priority: 'critical' | 'high' | 'normal';
}> = [
  {
    patternKey: 'alias_chinese_column',
    rule: '禁止使用中文别名。聚合时保留原始列名，不要加 AS',
    priority: 'critical',
  },
  {
    patternKey: 'missing_group_by',
    rule: '使用聚合函数(SUM/AVG/COUNT)时必须加 GROUP BY',
    priority: 'critical',
  },
  {
    patternKey: 'wrong_aggregate',
    rule: 'SUM/AVG 只能用于数值列(wechat_added,interaction,demand,deal)，不能用于 name/department/month',
    priority: 'critical',
  },
  {
    patternKey: 'all_zero_result',
    rule: '如果查询结果全为0，检查列名是否与表结构匹配',
    priority: 'high',
  },
  {
    patternKey: 'invalid_month_format',
    rule: '月份值必须是中文格式：7月/8月/9月/10月，不要用纯数字',
    priority: 'high',
  },
  {
    patternKey: 'unknown_department',
    rule: '部门名用 LIKE 模糊匹配，不要用精确等号',
    priority: 'normal',
  },
];

/** 获取所有活跃的纠正规则（status != rejected） */
export function getActiveRules(): CorrectionRule[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM correction_rules WHERE status != 'rejected' ORDER BY priority DESC, occurrence_count DESC"
  ).all() as Record<string, unknown>[];
  return rows.map(rowToRule);
}

/** 获取所有纠正规则文本（用于注入 prompt） */
export function getActiveRuleTexts(): string[] {
  return getActiveRules().map(r => r.rule);
}

/** 插入或更新纠正规则（occurrenceCount 累加） */
export function upsertRule(
  patternKey: ErrorPatternKey,
  rule: string,
  priority: 'critical' | 'high' | 'normal' = 'normal'
): void {
  const db = getDb();
  const id = `cr_${patternKey}`;
  const now = Math.floor(Date.now() / 1000);

  const existing = db.prepare('SELECT id, occurrence_count FROM correction_rules WHERE id = ?').get(id) as { id: string; occurrence_count: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE correction_rules
       SET occurrence_count = occurrence_count + 1, last_seen = ?, rule = ?, priority = ?
       WHERE id = ?`
    ).run(now, rule, priority, id);
  } else {
    db.prepare(
      `INSERT INTO correction_rules (id, pattern_key, rule, priority, status, occurrence_count, effectiveness, first_seen, last_seen)
       VALUES (?, ?, ?, ?, 'auto', 1, 0, ?, ?)`
    ).run(id, patternKey, rule, priority, now, now);
  }
}

/** 冷启动：插入初始规则（幂等，用 INSERT OR IGNORE 防止并发冲突） */
export function seedInitialRules(): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO correction_rules (id, pattern_key, rule, priority, status, occurrence_count, effectiveness, first_seen, last_seen)
     VALUES (?, ?, ?, ?, 'auto', 0, 0, ?, ?)`
  );

  for (const seed of SEED_RULES) {
    insert.run(`cr_${seed.patternKey}`, seed.patternKey, seed.rule, seed.priority, now, now);
  }
}

/** 计算规则注入后的效果（失败率下降百分比） */
export function measureEffectiveness(patternKey: ErrorPatternKey): number {
  const db = getDb();
  const rule = db.prepare('SELECT first_seen FROM correction_rules WHERE id = ?').get(`cr_${patternKey}`) as { first_seen: number } | undefined;
  if (!rule) return 0;

  const beforeCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM query_logs WHERE status IN ('failed', 'repaired') AND created_at < ?"
  ).get(rule.first_seen) as { cnt: number }).cnt;

  const beforeTotal = (db.prepare(
    'SELECT COUNT(*) as cnt FROM query_logs WHERE created_at < ?'
  ).get(rule.first_seen) as { cnt: number }).cnt;

  const afterFail = (db.prepare(
    "SELECT COUNT(*) as cnt FROM query_logs WHERE status IN ('failed', 'repaired') AND created_at >= ?"
  ).get(rule.first_seen) as { cnt: number }).cnt;

  const afterTotal = (db.prepare(
    'SELECT COUNT(*) as cnt FROM query_logs WHERE created_at >= ?'
  ).get(rule.first_seen) as { cnt: number }).cnt;

  const beforeRate = beforeTotal > 0 ? beforeCount / beforeTotal : 0;
  const afterRate = afterTotal > 0 ? afterFail / afterTotal : 0;

  if (beforeRate === 0) return 0;
  return Math.round(((beforeRate - afterRate) / beforeRate) * 100);
}

/** 更新规则的 effectiveness 字段 */
export function updateEffectiveness(patternKey: ErrorPatternKey): void {
  const db = getDb();
  const eff = measureEffectiveness(patternKey);
  db.prepare('UPDATE correction_rules SET effectiveness = ? WHERE id = ?').run(eff, `cr_${patternKey}`);
}

function rowToRule(row: Record<string, unknown>): CorrectionRule {
  return {
    id: row.id as string,
    patternKey: row.pattern_key as ErrorPatternKey,
    rule: row.rule as string,
    priority: row.priority as 'critical' | 'high' | 'normal',
    status: row.status as 'auto' | 'approved' | 'rejected',
    occurrenceCount: row.occurrence_count as number,
    effectiveness: row.effectiveness as number,
    firstSeen: row.first_seen as number,
    lastSeen: row.last_seen as number,
    createdAt: row.created_at as number,
  };
}
