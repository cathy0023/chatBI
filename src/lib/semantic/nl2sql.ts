import { generateTextCompat } from '@/lib/llm/provider';
import { buildNL2SQLPrompt } from './prompt-builder';
import { matchFewShots } from './few-shots';
import { validateSQL } from './validator';
import type Database from 'better-sqlite3';

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

export class NL2SQLEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async query(question: string): Promise<NL2SQLResult> {
    let rawSql: string;
    try {
      rawSql = await this.generateSQL(question);
    } catch (llmError) {
      console.error('[NL2SQL] LLM failed:', llmError instanceof Error ? llmError.message : String(llmError));
      return this.fallback();
    }

    const validation = validateSQL(rawSql);
    if (!validation.valid) {
      return this.selfRepair(question, rawSql, validation.reason);
    }

    try {
      const records = this.db.prepare(validation.sql).all() as Record<string, unknown>[];
      return {
        sql: validation.sql,
        records,
        columns: records.length > 0 ? Object.keys(records[0]) : [],
        confidence: 0.9,
        source: 'generated',
      };
    } catch (execError) {
      const msg = execError instanceof Error ? execError.message : String(execError);
      return this.selfRepair(question, validation.sql, msg);
    }
  }

  private async generateSQL(question: string): Promise<string> {
    const fewShots = matchFewShots(question);
    const prompt = buildNL2SQLPrompt(question, fewShots);
    const result = await generateTextCompat({ prompt });
    const sql = extractSQL(result.text);
    if (!sql || !sql.trim()) {
      throw new Error('LLM returned empty SQL');
    }
    return sql;
  }

  private async selfRepair(
    question: string,
    originalSql: string,
    errorMessage: string,
  ): Promise<NL2SQLResult> {
    const repairPrompt = `你之前生成的 SQL 有错误，请修正。

原始问题: "${question}"
错误的 SQL: ${originalSql}
错误信息: ${errorMessage}

表结构: sales_performance (id INTEGER, name TEXT, department TEXT, month TEXT, wechat_added INTEGER, interaction INTEGER, demand INTEGER, deal INTEGER)

请只输出修正后的 SQL，不要其他内容。`;

    try {
      const result = await generateTextCompat({ prompt: repairPrompt });
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
