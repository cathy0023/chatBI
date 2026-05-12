import { z } from 'zod';
import { tool, zodSchema } from 'ai';
import { NL2SQLEngine } from '@/lib/semantic/nl2sql';
import { getDb } from '@/lib/db/connection';
import type { ToolContext } from '../types';

/** Cached list of all DB names (static data, safe to cache for server lifetime) */
let cachedAllDbNames: string[] | null = null;
function getAllDbNames(db: ReturnType<typeof getDb>): string[] {
  if (!cachedAllDbNames) {
    cachedAllDbNames = (db.prepare('SELECT DISTINCT name FROM sales_performance').all() as { name: string }[]).map(r => r.name);
  }
  return cachedAllDbNames;
}

const inputSchema = z.object({
  query: z.string().describe('用户的自然语言查询，例如"9月成交top5"'),
});

function suggestSimilarName(
  db: ReturnType<typeof getDb>,
  sql: string,
  query: string,
): string | null {
  // Extract name from SQL WHERE clause
  const nameMatch = sql.match(/WHERE\s+name\s*=\s*'([^']+)'/i)
    || sql.match(/WHERE\s+name\s*=\s*"([^"]+)"/i);
  const targetName = nameMatch?.[1];
  if (!targetName || targetName.length < 2) return null;

  // Level 1: Substring match
  const similar = db.prepare(
    `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? AND name != ? LIMIT 5`,
  ).all(`%${targetName}%`, targetName) as { name: string }[];

  if (similar.length > 0) {
    const nameList = similar.map(n => n.name).join('、');
    return `未找到「${targetName}」的销售记录。数据库中名字包含「${targetName}」的有：${nameList}。请使用正确的名字重新调用 queryTool 查询。`;
  }

  // Level 2: Character-level match
  for (const char of targetName) {
    const charMatches = db.prepare(
      `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5`,
    ).all(`%${char}%`) as { name: string }[];

    if (charMatches.length > 0) {
      const nameList = charMatches.map(n => n.name).join('、');
      return `未找到「${targetName}」的销售记录。名字中包含相似字符「${char}」的有：${nameList}。请使用正确的名字重新调用 queryTool 查询。`;
    }
  }

  return null;
}

export function createQueryTool(ctx: ToolContext) {
  return tool({
    description: '查询销售数据。将自然语言转为 SQL 并执行，返回结构化数据。用于查找具体数据、获取明细、筛选记录。',
    inputSchema: zodSchema(inputSchema),
    execute: async (params) => {
      let { query } = params;
      const db = getDb();

      // Database-first: if any DB name appears in the query, skip regex-based rewriting
      const hasExactDbName = getAllDbNames(db).some(name => query.includes(name));

      // Auto-resolve short names to full DB names before NL2SQL
      // e.g., "马玉鹏的销售数据" → "马玉鹏2的销售数据" (single fuzzy match)
      // Skip if query already contains a valid DB name (handles names with trailing digits)
      const nameMatch = !hasExactDbName && query.match(/([^\x00-\x7F]{2,4})(?:的|个人|和整体|走势|折线|柱状|饼图|\d)/);
      if (nameMatch) {
        const candidate = nameMatch[1];
        if (!/部门|校区|销售|成交|数据|月份|趋势|对比|比较|排名|汇总|合计|总计|查询|查看|帮我|请问|分析/.test(candidate)) {
          const exactMatch = db.prepare(
            `SELECT COUNT(*) as cnt FROM sales_performance WHERE name = ?`,
          ).get(candidate) as { cnt: number };
          if (exactMatch.cnt === 0) {
            const fuzzyMatches = db.prepare(
              `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5`,
            ).all(`%${candidate}%`) as { name: string }[];
            if (fuzzyMatches.length === 1) {
              const resolved = fuzzyMatches[0].name;
              query = query.replace(
                new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                resolved,
              );
              // Prevent digit boundary confusion: "马玉鹏2" + "7月" → "马玉鹏2 7月"
              query = query.replace(
                new RegExp(resolved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d)'),
                `${resolved} $1`,
              );
            }
          }
        }
      }

      const engine = new NL2SQLEngine(db);
      const result = await engine.query(query, ctx.abortSignal);

      // Don't send `data` SSE event here — the gateway sends data/chart/text
      // in the correct order after the ReAct loop finishes, ensuring the left
      // panel (text answer) appears before the right panel (data/chart).

      // Populate shared tool context so chartTool/analysisTool can access the data
      // When LLM calls queryTool multiple times (e.g., "person vs overall" comparison),
      // append results and annotate each record with its source label so the chart
      // tool can detect multi-series data (isMultiSeries needs name+month+>=2 names).
      if (ctx.data.length > 0 && ctx.columns.length > 0) {
        // Detect which person this query is about: extract from the SQL WHERE clause
        const nameMatch = result.sql.match(/name\s*=\s*'([^']+)'/i);
        const personName = nameMatch ? nameMatch[1] : '整体';
        // Annotate each record with its source so buildMultiSeriesOption can group by name
        // When SQL has no WHERE name= clause (overall/aggregate query), label as '整体'
        const annotated = result.records.map(r => ({ ...r, name: personName }));
        ctx.data = [...ctx.data, ...annotated];
        const newCols = result.columns.filter(c => !ctx.columns.includes(c));
        // Ensure 'name' column is present for multi-series detection
        if (!ctx.columns.includes('name')) {
          ctx.columns = [...ctx.columns, 'name', ...newCols];
        } else {
          ctx.columns = [...ctx.columns, ...newCols];
        }
        ctx.sql = result.sql;
      } else {
        // First query: annotate with person name or '整体'
        const nameMatch = result.sql.match(/name\s*=\s*'([^']+)'/i);
        const personName = nameMatch ? nameMatch[1] : '整体';
        const annotated = result.records.map(r => ({ ...r, name: personName }));
        ctx.data = annotated;
        // Ensure 'name' column is always present (for multi-series detection)
        const cols = result.columns.includes('name')
          ? result.columns
          : ['name', ...result.columns];
        ctx.columns = cols;
        ctx.sql = result.sql;
      }

      // When no results, attach fuzzy name suggestions so the LLM can retry
      let suggestion: string | null = null;
      if (result.records.length === 0) {
        suggestion = suggestSimilarName(db, result.sql, query);
      }

      return {
        records: result.records,
        columns: result.columns,
        rowCount: result.records.length,
        sql: result.sql,
        ...(suggestion ? { suggestion } : {}),
      };
    },
  });
}
