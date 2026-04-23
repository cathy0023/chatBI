import { NextRequest } from 'next/server';
import { ensureSession, persistMessage } from '@/lib/chat/session';
import { createSSEStream, type SSESender } from '@/lib/chat/sse-helper';
import { NL2SQLEngine } from '@/lib/semantic/nl2sql';
import { getDb } from '@/lib/db/connection';
import { generateTextCompat } from '@/lib/llm/provider';
import { generateChartCode } from '@/lib/chart/code-generator';
import { getSession, updateSessionTitle } from '@/lib/db/queries';
import { recommendChart, aggregateBy } from '@/lib/agents/chart-recommender';
import { ReActGateway } from '@/lib/chat/react-gateway';
import { DEFAULT_TENANT } from '@/lib/chat/types';

const GREETING_PATTERN = /^(你好|hi|hello|嗨|hey|哈喽|早上好|下午好|晚上好|您好)\s*[!.?？。！]?\s*$/i;

const GREETING_RESPONSE = '你好！我是 ChatBI 销售数据分析助手。你可以问我关于销售业绩的问题，比如：\n\n- **9月成交top5的销售**\n- **各部门成交汇总**\n- **每月成交趋势**\n\n试试看吧！';

/**
 * Legacy pipeline: NL2SQL → execute → analyze → chart.
 * Extracted as a standalone function so it can be used as a fallback.
 */
async function executeLegacyPipeline(message: string, sessionId: string, send: SSESender): Promise<void> {
  // Auto-generate session title
  if (!GREETING_PATTERN.test(message.trim())) {
    try {
      const session = getSession(sessionId);
      if (!session?.title) {
        const title = message.length > 30 ? message.slice(0, 30) + '…' : message;
        updateSessionTitle(sessionId, title);
      }
    } catch { /* non-critical */ }
  }

  // Greeting fast-path
  if (GREETING_PATTERN.test(message.trim())) {
    send('text', { text: GREETING_RESPONSE });
    persistMessage(sessionId, 'assistant', GREETING_RESPONSE);
    send('done', {});
    return;
  }

  // Phase 1: Generate SQL
  send('status', { phase: 'generating_sql' });
  const db = getDb();
  const engine = new NL2SQLEngine(db);
  const result = await engine.query(message);

  // Post-process: rewrite month-comparison SQL
  if (/对比|比较|相比/.test(message) && !/\bUNION\b/i.test(result.sql)) {
    const groupByMatch = result.sql.match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|$)/i);
    if (groupByMatch && /\bname\b|\bdepartment\b/i.test(groupByMatch[1])) {
      const whereMatch = result.sql.match(/(WHERE\s+[\s\S]+?)(?:\s+GROUP BY|\s+ORDER BY|\s+LIMIT|$)/i);
      const whereClause = whereMatch ? whereMatch[1] : '';
      const rewrittenSql = `SELECT month, SUM(deal) AS deal FROM sales_performance ${whereClause} GROUP BY month ORDER BY month`.trim();
      try {
        const rewrittenRecords = db.prepare(rewrittenSql).all() as Record<string, unknown>[];
        result.sql = rewrittenSql;
        result.records = rewrittenRecords;
        result.columns = rewrittenRecords.length > 0 ? Object.keys(rewrittenRecords[0]) : [];
      } catch { /* keep original result */ }
    }
  }

  // No results — try fuzzy name matching
  if (result.records.length === 0) {
    const suggestion = suggestSimilarName(db, result.sql, message);
    if (suggestion) {
      send('text', { text: suggestion });
      persistMessage(sessionId, 'assistant', suggestion);
      send('done', {});
      return;
    }
    send('text', { text: '抱歉，没有找到相关的销售数据。请尝试换个关键词，例如部门名称、人员姓名或月份。' });
    persistMessage(sessionId, 'assistant', '抱歉，没有找到相关的销售数据。');
    send('done', {});
    return;
  }

  // UNION query with missing individual data
  if (/\bUNION\b/i.test(result.sql)) {
    const extractedName = extractNameFromQuery(message);
    if (extractedName) {
      const individualRecords = result.records.filter(r =>
        String(r.name || '').includes(extractedName) ||
        String(r.name || '').includes('个人'),
      );
      const hasIndividualData = individualRecords.length > 0
        && individualRecords.some(r => Number(r.deal || 0) > 0);
      if (!hasIndividualData) {
        const suggestion = suggestSimilarName(db, result.sql, message, extractedName);
        if (suggestion) {
          send('text', { text: suggestion });
          persistMessage(sessionId, 'assistant', suggestion);
          send('done', {});
          return;
        }
      }
    }
  }

  // Phase 2: Send data
  send('status', { phase: 'executing' });
  send('data', { sql: result.sql, records: result.records, columns: result.columns });

  // Phase 3: Generate analysis text
  send('status', { phase: 'analyzing' });
  const { dimension, metric } = recommendChart(message, result.records);
  const uniqueNames = new Set(result.records.map(r => String(r.name || '')));
  const uniqueMonths = new Set(result.records.map(r => String(r.month || '')));
  const isComparison = uniqueNames.size >= 2 && uniqueMonths.size >= 2;

  let statsText: string;
  if (isComparison) {
    const byName: Record<string, Record<string, number>> = {};
    for (const r of result.records) {
      const n = String(r.name || '');
      const m = String(r.month || '');
      const v = Number(r[metric] || 0);
      if (!byName[n]) byName[n] = {};
      byName[n][m] = (byName[n][m] || 0) + v;
    }
    statsText = Object.entries(byName).map(([name, months]) =>
      `${name}: ${Object.entries(months).map(([m, v]) => `${m}=${v}`).join(', ')}`
    ).join('\n');
  } else {
    const aggData = aggregateBy(result.records, dimension, metric);
    const totalDeal = Object.values(aggData).reduce((s, v) => s + v, 0);
    statsText = `按"${dimension}"分组的"${metric}"合计:\n${Object.entries(aggData).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n总计: ${totalDeal}`;
  }

  let analysisText = '';
  try {
    const analysisResult = await generateTextCompat({
      prompt: `你是资深销售数据分析顾问。根据以下统计数据，为用户提供有洞察力的分析。

用户问题: ${message}

【统计数据】
${statsText}

规则:
1. 提供总结、见解和洞察，而非罗列数据
2. 指出关键发现：谁表现突出、谁需要关注、有什么趋势或规律
3. 如果是个人与整体对比，分析个人在整体中的占比和差距
4. 引用的数字必须与上述统计完全一致，禁止自行计算
5. 控制在150字以内，简洁有力
6. 不要说"查询到N条数据"或"根据样本"`,
    });
    analysisText = analysisResult.text;
  } catch {
    analysisText = '';
  }
  if (!analysisText || analysisText.trim().length === 0) {
    analysisText = `查询到 ${result.records.length} 条数据。`;
  }
  send('text', { text: analysisText });

  // Phase 4: Generate chart
  send('status', { phase: 'generating_chart' });
  try {
    const chartHtml = await generateChartCode(message, result.records, result.columns);
    if (chartHtml) {
      send('chart', { html: chartHtml });
    }
  } catch (err) {
    console.error('[Chat] Chart generation failed:', err);
  }

  persistMessage(sessionId, 'assistant', analysisText);
  send('done', {});
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId } = body as { message: string; sessionId?: string };

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const sid = ensureSession(sessionId);
    persistMessage(sid, 'user', message);

    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');

    if (mode === 'legacy') {
      // Legacy pipeline (opt-in)
      return createSSEStream(async (send) => {
        send('session', { sessionId: sid });
        await executeLegacyPipeline(message, sid, send);
      });
    }

    // ReAct pipeline (default) with fallback to legacy
    const gateway = new ReActGateway();
    return createSSEStream(async (send) => {
      send('session', { sessionId: sid });
      try {
        await gateway.execute(message, {
          sessionId: sid,
          tenant: DEFAULT_TENANT,
          message,
        }, send);
      } catch (reactError) {
        console.warn('[Chat] ReAct pipeline failed, falling back to legacy:', reactError instanceof Error ? reactError.message : String(reactError));
        await executeLegacyPipeline(message, sid, send);
      }
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Extract name from user query text.
 * Tries patterns like "XXX个人", "XXX和整体", "查XXX的", "这个XXX".
 */
function extractNameFromQuery(query: string): string | null {
  // Order: more specific patterns first to avoid "这个白浩" capturing "这个"
  const patterns = [
    /(?:这个|那位)\s*(\S{2,4}?)\s*(?:的|个人)/,  // "这个白浩的/个人" → "白浩"
    /(\S{2,4}?)\s*(?:和|与|跟)\s*整体/,          // "白浩和整体" → "白浩"
    /(?:查|看|了解)\s*(\S{2,4}?)\s*的/,          // "查白浩的" → "白浩"
    /(\S{2,4}?)个人/,                           // "白浩个人" → "白浩"
  ];
  for (const p of patterns) {
    const m = query.match(p);
    if (m && m[1]) {
      // Safety: strip demonstrative prefixes if captured
      const cleaned = m[1].replace(/^(?:这个|那个|那位)/, '');
      return cleaned.length >= 2 ? cleaned : m[1];
    }
  }
  return null;
}

/**
 * Search for similar names using three-level matching:
 * 1. Substring match (LIKE %name%)
 * 2. Character-level match (any char from the target)
 * 3. List all available names as fallback
 */
function suggestSimilarName(
  db: ReturnType<typeof getDb>,
  sql: string,
  query: string,
  overrideName?: string,
): string | null {
  // Extract name: try override → SQL WHERE → query text
  let targetName = overrideName;

  if (!targetName) {
    const nameMatch = sql.match(/WHERE\s+name\s*=\s*'([^']+)'/i)
      || sql.match(/WHERE\s+name\s*=\s*"([^"]+)"/i);
    targetName = nameMatch?.[1];
  }

  if (!targetName) {
    targetName = extractNameFromQuery(query) ?? undefined;
  }

  if (!targetName || targetName.length < 2) return null;

  // Level 1: Substring match
  const similar = db.prepare(
    `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? AND name != ? LIMIT 3`,
  ).all(`%${targetName}%`, targetName) as { name: string }[];

  if (similar.length > 0) {
    const nameList = similar.map(n => `「${n.name}」`).join('、');
    return `未找到「${targetName}」的销售记录。您是指 ${nameList} 吗？`;
  }

  // Level 2: Character-level match (any character from the target name)
  for (const char of targetName) {
    const charMatches = db.prepare(
      `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 3`,
    ).all(`%${char}%`) as { name: string }[];

    if (charMatches.length > 0) {
      const nameList = charMatches.map(n => `「${n.name}」`).join('、');
      return `未找到「${targetName}」的销售记录。名字中包含相似字符的有 ${nameList}，您是指其中某位吗？`;
    }
  }

  // Level 3: No match — list all available names
  const allNames = db.prepare(
    `SELECT DISTINCT name FROM sales_performance ORDER BY name`,
  ).all() as { name: string }[];

  if (allNames.length > 0) {
    const nameList = allNames.slice(0, 10).map(n => n.name).join('、');
    const more = allNames.length > 10 ? ` 等${allNames.length}人` : '';
    return `系统中没有找到「${targetName}」的销售记录。\n\n目前系统中的销售人员有：${nameList}${more}\n\n请问您要查询的是哪位？`;
  }

  return null;
}
