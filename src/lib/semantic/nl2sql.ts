import { generateTextCompat } from '@/lib/llm/provider';
import { buildNL2SQLPrompt } from './prompt-builder';
import { validateSQL } from './validator';
import { logQuery } from './query-logger';
import { detectErrorPatterns, detectUnknownDepartment } from './pattern-detector';
import { upsertRule } from './correction-rules';
import type Database from 'better-sqlite3';
import type { QueryStatus } from './types';

export type NL2SQLResult = {
  sql: string;
  records: Record<string, unknown>[];
  columns: string[];
  confidence: number;
  source: 'generated' | 'repaired' | 'fallback';
};

function extractSQL(raw: string): string {
  let text = raw;
  const sqlBlockMatch = text.match(/```(?:sql)?\s*\n?([\s\S]*?)```/);
  if (sqlBlockMatch) text = sqlBlockMatch[1];
  return text
    .replace(/^--.*$/gm, '')
    .replace(/^#\s.*$/gm, '')
    .trim()
    .replace(/;\s*$/, '');
}

/**
 * Post-process SQL: if the question is a month comparison but the generated SQL
 * groups by name/department instead of just month, rewrite it to group by month.
 */
function postProcessSQL(sql: string, question: string): string {
  // Don't rewrite UNION queries — they're intentionally multi-part (e.g., individual vs overall)
  if (/\bUNION\b/i.test(sql)) return sql;

  // Fix BETWEEN on month field: SQLite text comparison fails for months like '10月' < '7月'
  const betweenMatch = sql.match(/WHERE\s+month\s+BETWEEN\s+'([^']+)'\s+AND\s+'([^']+)'/i);
  if (betweenMatch) {
    const startNum = parseInt(betweenMatch[1], 10);
    const endNum = parseInt(betweenMatch[2], 10);
    if (!isNaN(startNum) && !isNaN(endNum)) {
      const lo = Math.min(startNum, endNum);
      const hi = Math.max(startNum, endNum);
      const rangeMonths: string[] = [];
      for (let i = lo; i <= hi; i++) rangeMonths.push(`'${i}月'`);
      const inList = rangeMonths.join(',');
      sql = sql.replace(
        /WHERE\s+month\s+BETWEEN\s+'[^']+'\s+AND\s+'[^']+'/i,
        `WHERE month IN (${inList})`
      );
    }
  }

  const isMonthComparison = /对比|比较|相比/.test(question);
  const hasMultipleMonths = (sql.match(/['"]\d+月['"]/g) || []).length >= 2;

  if (!isMonthComparison || !hasMultipleMonths) return sql;

  // If GROUP BY contains name or department, it's grouping by person — rewrite to month aggregation
  // BUT: skip rewrite when user explicitly asks for per-person breakdown (e.g., "各销售的成交")
  const personIntentKws = ['各销售', '各人', '每人', '每个人', '各人员', '谁的', '人员'];
  const hasPersonIntent = personIntentKws.some(kw => question.includes(kw));
  if (hasPersonIntent) return sql;

  const groupByMatch = sql.match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|$)/i);
  if (groupByMatch) {
    const groupByCols = groupByMatch[1].trim();
    if (!/\bname\b|\bdepartment\b/i.test(groupByCols)) return sql; // already month-only grouping
  }

  // Extract the metric column from the original SQL (e.g., SUM(interaction) → "interaction")
  const aggMatch = sql.match(/(?:SUM|AVG|COUNT|MAX|MIN)\s*\(\s*(\w+)\s*\)/i);
  const metric = aggMatch ? aggMatch[1] : 'deal';

  // Rewrite: group by month only, keeping the WHERE clause
  const whereMatch = sql.match(/(WHERE\s+[\s\S]+?)(?:\s+GROUP BY|\s+ORDER BY|\s+LIMIT|$)/i);
  const whereClause = whereMatch ? whereMatch[1] : '';
  return `SELECT month, SUM(${metric}) AS ${metric} FROM sales_performance ${whereClause} GROUP BY month ORDER BY month`;
}

export class NL2SQLEngine {
  private db: Database.Database;
  private nameCache: string[] | null = null;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Get all distinct person names from the database (cached) */
  private getDistinctNames(): string[] {
    if (!this.nameCache) {
      const rows = this.db.prepare('SELECT DISTINCT name FROM sales_performance').all() as { name: string }[];
      this.nameCache = rows.map(r => r.name);
    }
    return this.nameCache;
  }

  /** Check which DB names appear in the user's question (longest first for most specific match) */
  private extractNamesFromQuestion(question: string): string[] {
    return this.getDistinctNames()
      .filter(name => question.includes(name))
      .sort((a, b) => b.length - a.length);
  }

  /** If the question mentions a person but the SQL lacks WHERE name = '...', inject it */
  private ensureNameFilter(sql: string, names: string[]): string {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`WHERE\\s+name\\s*=\\s*'${escaped}'`, 'i').test(sql)) {
        return sql; // Already has the correct filter
      }
    }

    const name = names[0];
    const safeName = name.replace(/'/g, "''"); // escape single quotes

    // If SQL already has a WRONG name filter (LLM hallucinated a different name), replace it
    const wrongNameFilter = sql.match(/WHERE\s+name\s*=\s*'[^']+'/i);
    if (wrongNameFilter) {
      return sql.replace(
        /WHERE\s+name\s*=\s*'[^']+'/i,
        `WHERE name = '${safeName}'`
      );
    }

    if (/WHERE/i.test(sql)) {
      // Already has a WHERE clause — prepend name filter with AND
      return sql.replace(/WHERE\s+/i, `WHERE name = '${safeName}' AND `);
    } else {
      // No WHERE clause — add one after FROM sales_performance
      return sql.replace(
        /FROM\s+sales_performance\s*/i,
        `FROM sales_performance WHERE name = '${safeName}' `
      );
    }
  }

  async query(question: string, abortSignal?: AbortSignal): Promise<NL2SQLResult> {
    const startTime = Date.now();
    let rawSql: string;
    try {
      rawSql = await this.generateSQL(question, abortSignal);
    } catch (llmError) {
      console.error('[NL2SQL] LLM failed:', llmError instanceof Error ? llmError.message : String(llmError));
      logQuery({ question, generatedSQL: '', status: 'failed', errorMessage: String(llmError), resultRowCount: 0, hasAllZeroRows: false, executionTimeMs: Date.now() - startTime });
      return this.fallback();
    }

    // Programmatic safeguard: if question mentions a person name but SQL lacks WHERE name = '...',
    // inject the filter regardless of what the LLM generated
    const mentionedNames = this.extractNamesFromQuestion(question);
    if (mentionedNames.length > 0 && !/\bUNION\b/i.test(rawSql)) {
      rawSql = this.ensureNameFilter(rawSql, mentionedNames);
      console.log('[NL2SQL] Name filter safeguard applied:', mentionedNames);
    }

    const validation = validateSQL(rawSql);
    if (!validation.valid) {
      const result = await this.selfRepair(question, rawSql, validation.reason, abortSignal);
      const elapsed = Date.now() - startTime;
      if (result.source === 'repaired') {
        logQuery({ question, generatedSQL: rawSql, status: 'repaired', repairedSQL: result.sql, errorMessage: validation.reason, resultRowCount: result.records.length, hasAllZeroRows: this.hasAllZeroRows(result.records), executionTimeMs: elapsed });
        this.learnFromRecord({ question, generatedSQL: rawSql, status: 'repaired', repairedSQL: result.sql, errorMessage: validation.reason, resultRowCount: result.records.length, hasAllZeroRows: this.hasAllZeroRows(result.records), executionTimeMs: elapsed });
      } else {
        logQuery({ question, generatedSQL: rawSql, status: 'failed', errorMessage: validation.reason, resultRowCount: 0, hasAllZeroRows: false, executionTimeMs: elapsed });
        this.learnFromRecord({ question, generatedSQL: rawSql, status: 'failed', errorMessage: validation.reason, resultRowCount: 0, hasAllZeroRows: false, executionTimeMs: elapsed });
      }
      return result;
    }

    try {
      const records = this.db.prepare(validation.sql).all() as Record<string, unknown>[];
      const elapsed = Date.now() - startTime;
      const allZero = this.hasAllZeroRows(records);
      logQuery({ question, generatedSQL: validation.sql, status: 'success', resultRowCount: records.length, hasAllZeroRows: allZero, executionTimeMs: elapsed });
      if (allZero) {
        this.learnFromRecord({ question, generatedSQL: validation.sql, status: 'success', resultRowCount: records.length, hasAllZeroRows: true, executionTimeMs: elapsed });
      }
      return {
        sql: validation.sql,
        records,
        columns: records.length > 0 ? Object.keys(records[0]) : [],
        confidence: 0.9,
        source: 'generated',
      };
    } catch (execError) {
      const msg = execError instanceof Error ? execError.message : String(execError);
      const result = await this.selfRepair(question, validation.sql, msg, abortSignal);
      const elapsed = Date.now() - startTime;
      if (result.source === 'repaired') {
        logQuery({ question, generatedSQL: validation.sql, status: 'repaired', repairedSQL: result.sql, errorMessage: msg, resultRowCount: result.records.length, hasAllZeroRows: this.hasAllZeroRows(result.records), executionTimeMs: elapsed });
        this.learnFromRecord({ question, generatedSQL: validation.sql, status: 'repaired', repairedSQL: result.sql, errorMessage: msg, resultRowCount: result.records.length, hasAllZeroRows: this.hasAllZeroRows(result.records), executionTimeMs: elapsed });
      } else {
        logQuery({ question, generatedSQL: validation.sql, status: 'failed', errorMessage: msg, resultRowCount: 0, hasAllZeroRows: false, executionTimeMs: elapsed });
        this.learnFromRecord({ question, generatedSQL: validation.sql, status: 'failed', errorMessage: msg, resultRowCount: 0, hasAllZeroRows: false, executionTimeMs: elapsed });
      }
      return result;
    }
  }

  /** 检查结果是否全为零值 */
  private hasAllZeroRows(records: Record<string, unknown>[]): boolean {
    if (records.length === 0) return false;
    return records.every(row =>
      Object.values(row).every(v => v === 0 || v === '0' || v === null)
    );
  }

  /** 从查询记录中学习错误模式，更新纠正规则 */
  private learnFromRecord(record: { question: string; generatedSQL: string; status: QueryStatus; repairedSQL?: string; errorMessage?: string; resultRowCount: number; hasAllZeroRows: boolean; executionTimeMs: number }): void {
    const patterns = detectErrorPatterns(record as import('./types').QueryRecord);
    const knownDepts = this.getKnownDepartments();
    if (detectUnknownDepartment(record as import('./types').QueryRecord, knownDepts)) {
      patterns.push('unknown_department');
    }
    const RULE_MAP: Record<string, { rule: string; priority: 'critical' | 'high' | 'normal' }> = {
      alias_chinese_column: { rule: '禁止使用中文别名。聚合时保留原始列名，不要加 AS', priority: 'critical' },
      missing_group_by: { rule: '使用聚合函数(SUM/AVG/COUNT)时必须加 GROUP BY', priority: 'critical' },
      wrong_aggregate: { rule: 'SUM/AVG 只能用于数值列(wechat_added,interaction,demand,deal)', priority: 'critical' },
      all_zero_result: { rule: '如果查询结果全为0，检查列名是否与表结构匹配', priority: 'high' },
      invalid_month_format: { rule: '月份值必须是中文格式：7月/8月/9月/10月', priority: 'high' },
      unknown_department: { rule: '部门名用 LIKE 模糊匹配，不要用精确等号', priority: 'normal' },
    };
    for (const p of patterns) {
      const entry = RULE_MAP[p];
      if (entry) upsertRule(p, entry.rule, entry.priority);
    }
  }

  /** 获取已知部门列表（缓存） */
  private deptCache: string[] | null = null;
  private getKnownDepartments(): string[] {
    if (!this.deptCache) {
      const rows = this.db.prepare('SELECT DISTINCT department FROM sales_performance').all() as { department: string }[];
      this.deptCache = rows.map(r => r.department);
    }
    return this.deptCache;
  }

  private async generateSQL(question: string, abortSignal?: AbortSignal): Promise<string> {
    const prompt = buildNL2SQLPrompt(question);
    const result = await generateTextCompat({ prompt, abortSignal });
    const sql = extractSQL(result.text);
    if (!sql || !sql.trim()) {
      throw new Error('LLM returned empty SQL');
    }
    return postProcessSQL(sql, question);
  }

  private async selfRepair(
    question: string,
    originalSql: string,
    errorMessage: string,
    abortSignal?: AbortSignal,
  ): Promise<NL2SQLResult> {
    const repairPrompt = `你之前生成的 SQL 有错误，请修正。

原始问题: "${question}"
错误的 SQL: ${originalSql}
错误信息: ${errorMessage}

表结构: sales_performance (id INTEGER, name TEXT, department TEXT, month TEXT, wechat_added INTEGER, interaction INTEGER, demand INTEGER, deal INTEGER)

请只输出修正后的 SQL，不要其他内容。`;

    try {
      const result = await generateTextCompat({ prompt: repairPrompt, abortSignal });
      const repairedSql = extractSQL(result.text);
      const validation = validateSQL(repairedSql);
      if (!validation.valid) return this.fallback();

      const records = this.db.prepare(validation.sql).all() as Record<string, unknown>[];
      return {
        sql: validation.sql,
        records,
        columns: records.length > 0 ? Object.keys(records[0]) : [],
        confidence: 0.7,
        source: 'repaired',
      };
    } catch {
      return this.fallback();
    }
  }

  private fallback(): NL2SQLResult {
    return {
      sql: '-- fallback: no results',
      records: [],
      columns: [],
      confidence: 0,
      source: 'fallback',
    };
  }
}
