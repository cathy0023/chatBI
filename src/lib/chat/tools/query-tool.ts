import { z } from 'zod';
import { tool, zodSchema } from 'ai';
import { NL2SQLEngine } from '@/lib/semantic/nl2sql';
import { getDb } from '@/lib/db/connection';
import type { ToolContext } from '../types';

const inputSchema = z.object({
  query: z.string().describe('用户的自然语言查询，例如"9月成交top5"'),
});

export function createQueryTool(ctx: ToolContext) {
  return tool({
    description: '查询销售数据。将自然语言转为 SQL 并执行，返回结构化数据。用于查找具体数据、获取明细、筛选记录。',
    inputSchema: zodSchema(inputSchema),
    execute: async (params) => {
      const { query } = params;
      const db = getDb();
      const engine = new NL2SQLEngine(db);
      const result = await engine.query(query);

      ctx.send('data', {
        sql: result.sql,
        records: result.records,
        columns: result.columns,
      });

      return {
        records: result.records,
        columns: result.columns,
        rowCount: result.records.length,
        sql: result.sql,
      };
    },
  });
}
