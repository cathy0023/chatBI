import { NextRequest } from 'next/server';
import { ensureSession, persistMessage, loadSessionMessages } from '@/lib/chat/session';
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

/** Cache last successful query per session for chart type change detection */
const lastSuccessCtx = new Map<string, { resolvedQuery: string; sql: string }>();

/**
 * Per-session entity resolution cache.
 * Maps short/ambiguous names to their confirmed full names.
 * Example: { "郑威": "郑威16", "李": "李明达6" }
 * Persisted across turns so that once the user confirms a name mapping,
 * it applies to all subsequent queries in the session.
 */
const entityResolutionCache = new Map<string, Map<string, string>>();

/** Cached list of all DB names (static data, safe to cache for server lifetime) */
let cachedAllDbNames: string[] | null = null;
function getAllDbNames(db: ReturnType<typeof getDb>): string[] {
  if (!cachedAllDbNames) {
    cachedAllDbNames = (db.prepare('SELECT DISTINCT name FROM sales_performance').all() as { name: string }[]).map(r => r.name);
  }
  return cachedAllDbNames;
}

/**
 * Apply cached entity resolutions to a query string.
 * Replaces short/ambiguous names with their confirmed full names.
 * Returns the rewritten query (or original if no mappings apply).
 */
function applyEntityResolutions(message: string, sessionId: string): string {
  const cache = entityResolutionCache.get(sessionId);
  if (!cache || cache.size === 0) return message;

  let result = message;
  for (const [shortName, resolvedName] of cache) {
    if (result.includes(shortName)) {
      result = result.replace(new RegExp(shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), resolvedName);
      console.log(`[Chat] Entity resolved: "${shortName}" → "${resolvedName}"`);
    }
  }
  return result;
}

/**
 * Detect if the message contains a person name that:
 * 1. Does NOT exactly match any DB name (not a precise name)
 * 2. Has multiple fuzzy (substring) matches in DB
 * Returns a disambiguation suggestion, or null if no ambiguity.
 */
function detectAmbiguousName(
  message: string,
  db: ReturnType<typeof getDb>,
): { suggestion: string | null; ambiguousName: string; autoResolvedQuery?: string; resolvedName?: string } | null {
  // Database-first: if any DB name appears in the query, no ambiguity needed.
  // This handles names with trailing digits (e.g., "杨文平3") that the regex would split.
  const allDbNames = getAllDbNames(db);
  if (allDbNames.some(name => message.includes(name))) return null;

  // Fallback: Extract candidate name via regex when no exact DB name found
  const nameMatch = message.match(/([^\x00-\x7F]{2,4})(?:的|个人|和整体|走势|折线|柱状|饼图|\d)/);
  if (!nameMatch) return null;

  const candidate = nameMatch[1];

  // Skip if it's a department keyword or common term
  if (/部门|校区|销售|成交|数据|月份|趋势|对比|比较|排名|汇总|合计|总计|查询|查看|帮我|请问|分析/.test(candidate)) return null;

  // Check if exact name exists in DB
  const exactMatch = db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_performance WHERE name = ?`,
  ).get(candidate) as { cnt: number };
  if (exactMatch.cnt > 0) return null; // exact match, no ambiguity

  // Check fuzzy matches (substring)
  const fuzzyMatches = db.prepare(
    `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5`,
  ).all(`%${candidate}%`) as { name: string }[];

  if (fuzzyMatches.length === 0) {
    // Substring match failed — fall back to character-level matching
    // e.g., "武恩" → char "武" → finds "武莹"
    for (const char of candidate) {
      const charMatches = db.prepare(
        `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5`,
      ).all(`%${char}%`) as { name: string }[];
      if (charMatches.length > 0) {
        const nameList = charMatches.map(n => `「${n.name}」`).join('、');
        const suggestion = `未在系统中找到「${candidate}」。名字中包含相似字符「${char}」的有 ${nameList}，您是指哪位？`;
        return { suggestion, ambiguousName: candidate };
      }
    }
    return null; // no match at any level
  }

  // Single fuzzy match — auto-resolve by rewriting the query
  // (NL2SQL's ensureNameFilter won't fire because the short name isn't in extractNamesFromQuestion)
  if (fuzzyMatches.length === 1) {
    const resolvedName = fuzzyMatches[0].name;
    let rewritten = message.replace(
      new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      resolvedName,
    );
    // Prevent digit boundary confusion: "武恩1" + "7月" → "武恩1 7月"
    rewritten = rewritten.replace(
      new RegExp(resolvedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d)'),
      `${resolvedName} $1`,
    );
    console.log(`[Chat] Auto-resolved single match: "${candidate}" → "${resolvedName}", query: "${message}" → "${rewritten}"`);
    // Return as a rewrite signal (not a disambiguation question)
    return { suggestion: null, ambiguousName: candidate, autoResolvedQuery: rewritten, resolvedName };
  }

  // Multiple matches — ask for disambiguation
  const nameList = fuzzyMatches.map(n => `「${n.name}」`).join('、');
  const suggestion = `名字中包含"${candidate}"的有 ${nameList}，您是指哪位？`;
  return { suggestion, ambiguousName: candidate };
}

/**
 * Detect follow-up references where the user refers back to previous results
 * (e.g., "右侧没展示出来", "上面那个", "刚才的图", "再看一下").
 * Returns the previous query string, or null if this is a new independent query.
 *
 * Heuristic: if the message is short (≤15 chars), contains no data-specific keywords
 * (person names, departments, months, metrics), and a previous query exists in cache,
 * then treat it as a follow-up.
 */
function resolveFollowUp(message: string, sessionId: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length > 15) return null;

  // Must contain reference/deixis keywords
  if (!/右侧|左侧|上面|下面|刚才|之前|那个|这个|再看|重新|没展示|看不到|没显示|没出来|看一下|看一下|再看看|还是|怎么|什么|展示一下/.test(trimmed)) return null;

  // Must NOT contain new data query intent
  if (/销售|成交|部门|校区|前\d|top|排名|排行|各月|分别|对比|比较|\d+月|微信|互动|需求|添加|转化/.test(trimmed)) return null;

  // Must NOT be a confirmation (handled separately)
  if (/^(是|是的|对|对的|确认|没错|嗯|OK|ok|Yes|yes)$/i.test(trimmed)) return null;

  const ctx = lastSuccessCtx.get(sessionId);
  if (!ctx) return null;

  return ctx.resolvedQuery;
}

/**
 * When the assistant asked for disambiguation (e.g., "名字中包含'郑威'的有 「郑威16」、「郑威8」")，
 * and the user directly answers with a specific name (e.g., "郑威16"), resolve it:
 * 1. Cache the entity mapping (short → full name)
 * 2. Rewrite the query using the previous user message + confirmed name
 */
function resolveDisambiguationResponse(message: string, sessionId: string, db: ReturnType<typeof getDb>): string | null {
  const trimmed = message.trim();

  // Check if the message itself is a valid person name in DB
  const exactMatch = db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_performance WHERE name = ?`,
  ).get(trimmed) as { cnt: number };
  if (exactMatch.cnt === 0) return null;

  // Check if the previous assistant message was a disambiguation question
  const history = loadSessionMessages(sessionId) as { role: string; content: string }[];
  if (history.length === 0) return null;

  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant?.content) return null;

  // Check if it's a disambiguation message pattern
  if (!/名字中包含.*的有|您是指.*吗/.test(lastAssistant.content)) return null;

  // Check if the confirmed name was one of the suggestions
  if (!lastAssistant.content.includes(`「${trimmed}」`)) return null;

  // Find the original query (2 messages back — the one that triggered disambiguation)
  const msgs = [...history].reverse();
  let originalQuery = '';
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === 'user') {
      // The first user message after reversal is the current "郑威16",
      // the second one is the original "郑威的销售数据"
      if (i + 1 < msgs.length && msgs[i + 1].role === 'user') {
        originalQuery = msgs[i + 1].content;
      }
      break;
    }
  }

  // Extract the short name from the disambiguation message
  // Extract the original ambiguous name from the assistant's disambiguation message.
  // Handles multiple formats: "未在系统中找到「XXX」" / "名字中包含"XXX"" / "未找到「XXX」"
  const shortNameMatch = lastAssistant.content.match(/名字中包含"([^"]+)"/)
    || lastAssistant.content.match(/未在系统中找到「([^」]+)」/)
    || lastAssistant.content.match(/未找到「([^」]+)」/);
  const shortName = shortNameMatch?.[1];

  // Cache the entity resolution
  if (shortName && shortName !== trimmed) {
    let cache = entityResolutionCache.get(sessionId);
    if (!cache) {
      cache = new Map();
      entityResolutionCache.set(sessionId, cache);
    }
    cache.set(shortName, trimmed);
    console.log(`[Chat] Disambiguation cached: "${shortName}" → "${trimmed}"`);
  }

  // Rewrite the original query with the confirmed name
  let rewritten = originalQuery;
  if (shortName && originalQuery.includes(shortName)) {
    rewritten = originalQuery.replace(
      new RegExp(shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      trimmed,
    );
  } else {
    rewritten = `${trimmed}的销售数据`;
  }

  // Prevent digit boundary confusion: "杨文平3" + "7月" → "杨文平37月" → "杨文平3 7月"
  rewritten = rewritten.replace(
    new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d)'),
    `${trimmed} $1`,
  );

  console.log(`[Chat] Disambiguation resolved: "${message}" → "${rewritten}"`);
  return rewritten;
}

/**
 * Detect chart-type-only follow-up messages (e.g., "我要走势图", "换成饼图").
 * Returns reconstructed query + stored SQL, or null if not a chart type change.
 */
function resolveChartTypeChange(message: string, sessionId: string): { query: string; sql: string } | null {
  const trimmed = message.trim();

  // Must contain chart type keywords
  if (!/走势|折线|柱状|柱形|条形|饼图|雷达/.test(trimmed)) return null;

  // Must NOT contain data query intent (otherwise it's a new query, not a type change)
  if (/销售|成交|部门|校区|前\d|top|排名|排行|各月|分别|对比|比较|\d+月/.test(trimmed)) return null;

  // Exclude confirmations (handled separately)
  if (/^(是|是的|对|对的|确认|没错|嗯|OK|ok|Yes|yes)$/i.test(trimmed)) return null;

  const ctx = lastSuccessCtx.get(sessionId);
  if (!ctx) return null;

  // Strip old chart type keywords and append new ones for correct chart type detection
  const chartTypePattern = /走势图?|折线图?|柱状图?|柱形图?|条形图?|饼图?|雷达图?|趋势图?|变化趋势/;
  const baseQuery = ctx.resolvedQuery.replace(chartTypePattern, '').replace(/\s+/g, ' ').trim();

  const newQuery = `${baseQuery} ${trimmed}`;
  console.log(`[Chat] Chart type change: "${trimmed}" → "${newQuery}"`);
  return { query: newQuery, sql: ctx.sql };
}

/**
 * Detect name correction pattern: "是马玉鹏", "是郑威16".
 * When the user says "是XXX" after getting a "name not found" suggestion,
 * extract the corrected name and rewrite the previous query.
 */
function resolveNameCorrection(message: string, sessionId: string, db: ReturnType<typeof getDb>): string | null {
  const trimmed = message.trim();
  const correctionMatch = trimmed.match(/^是(.{1,6})$/);
  if (!correctionMatch) return null;

  const correctedName = correctionMatch[1].trim();

  // Skip if the corrected name looks like a pure confirmation (just "的" etc.)
  if (/^(的|了|吗|吧|啊|呢|吧)$/.test(correctedName)) return null;

  // Check if the previous assistant message was a "not found" or "did you mean" suggestion
  const history = loadSessionMessages(sessionId) as { role: string; content: string }[];
  if (history.length === 0) return null;

  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant?.content) return null;

  // Must be a name-related suggestion (not a data analysis response)
  if (!/未找到|您是指|名字中包含|没有找到/.test(lastAssistant.content)) return null;

  // Find the original substantive user query (skip other corrections/confirmations)
  const msgs = [...history].reverse();
  const confirmationPattern = /^(是|是的|对|对的|确认|没错|嗯|OK|ok|Yes|yes)$/i;
  const nameCorrectionPattern = /^是.{1,6}$/;
  let originalQuery = '';
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === 'user') {
      const content = msgs[i].content.trim();
      if (confirmationPattern.test(content) || nameCorrectionPattern.test(content)) continue;
      originalQuery = content;
      break;
    }
  }

  if (!originalQuery) return null;

  // If the corrected name doesn't exactly match a DB name, try fuzzy resolution
  // e.g., "马玉鹏" → "马玉鹏2" (DB has names with numeric suffixes)
  const exactMatch = db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_performance WHERE name = ?`,
  ).get(correctedName) as { cnt: number };

  let resolvedName = correctedName;
  if (exactMatch.cnt === 0) {
    const fuzzyMatches = db.prepare(
      `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5`,
    ).all(`%${correctedName}%`) as { name: string }[];

    if (fuzzyMatches.length === 1) {
      // Single fuzzy match — auto-resolve (same logic as detectAmbiguousName)
      resolvedName = fuzzyMatches[0].name;
      console.log(`[Chat] Name correction auto-resolved: "${correctedName}" → "${resolvedName}"`);
    } else if (fuzzyMatches.length > 1) {
      // Multiple matches — return a disambiguation question
      const nameList = fuzzyMatches.map(n => `「${n.name}」`).join('、');
      console.log(`[Chat] Name correction ambiguous: "${correctedName}" has ${fuzzyMatches.length} matches`);
      return `名字中包含"${correctedName}"的有 ${nameList}，您是指哪位？`;
    }
    // If no fuzzy matches, keep the corrected name as-is (NL2SQL/suggestSimilarName will handle it)
  }

  // Extract the wrong name from the original query
  const wrongName = extractNameFromQuery(originalQuery);
  let targetReplace: string | null = wrongName;

  if (!targetReplace) {
    // Try to find any 2-4 char Chinese name in the original query
    const nameInQuery = originalQuery.match(/([^\x00-\x7F]{2,4})(?:的|\d)/);
    targetReplace = nameInQuery?.[1] || null;
  }

  let rewritten: string;
  if (targetReplace) {
    // Replace the wrong name, then ensure resolvedName (which may end with a digit)
    // doesn't merge with a following digit in the query (e.g., "马玉鹏2" + "7月" → "马玉鹏27月")
    const rawRewritten = originalQuery.replace(targetReplace, resolvedName);
    rewritten = rawRewritten.replace(
      new RegExp(resolvedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d)'),
      `${resolvedName} $1`,
    );
  } else {
    // Fallback: reconstruct query with resolved name + time/chart context
    const timeRange = originalQuery.match(/\d+[-~到至]\d+月份?/)?.[0] || '';
    const chartSuffix = originalQuery.match(/(走势|折线|柱状|柱形|条形|饼图|雷达|趋势|变化趋势)图?/)?.[0] || '';
    rewritten = `${resolvedName}${timeRange ? ' ' + timeRange : ''}${chartSuffix ? ' ' + chartSuffix : ''}的销售数据`;
  }

  // Cache entity resolution if the resolved name exists in DB
  const resolvedExactMatch = db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_performance WHERE name = ?`,
  ).get(resolvedName) as { cnt: number };
  const cacheKey = wrongName || extractNameFromQuery(originalQuery);
  if (resolvedExactMatch.cnt > 0 && cacheKey && cacheKey !== resolvedName) {
    let cache = entityResolutionCache.get(sessionId);
    if (!cache) {
      cache = new Map();
      entityResolutionCache.set(sessionId, cache);
    }
    cache.set(cacheKey, resolvedName);
    console.log(`[Chat] Name correction cached: "${cacheKey}" → "${resolvedName}"`);
  }

  console.log(`[Chat] Name correction resolved: "${trimmed}" → "${rewritten}"`);
  return rewritten;
}

/**
 * Legacy pipeline: NL2SQL → execute → analyze → chart.
 * Extracted as a standalone function so it can be used as a fallback.
 */
/**
 * Check if the user's message is a short confirmation ("是", "对的", "确认" etc.)
 * and the previous assistant message suggested a specific name.
 * Returns the rewritten query with the suggested name if applicable.
 */
function resolveConfirmation(message: string, sessionId: string): string | null {
  const trimmed = message.trim();
  if (!/^(是|是的|对|对的|确认|没错|嗯|OK|ok|Yes|yes)$/i.test(trimmed)) return null;

  const history = loadSessionMessages(sessionId) as { role: string; content: string }[];
  if (history.length === 0) return null;

  // Find the last assistant message
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant?.content) return null;

  // Extract suggested name from pattern like "您是指「XXX」" or "名字中包含...的有：XXX"
  const bracketMatch = lastAssistant.content.match(/[「「]([^」」]+)[」」]/g);
  if (!bracketMatch || bracketMatch.length === 0) return null;

  // The first bracket is always the target (not-found) name.
  // Remaining brackets are the suggestions.
  // Only auto-resolve when there is exactly ONE suggestion —
  // multiple suggestions mean "是的" is ambiguous.
  if (bracketMatch.length < 2) return null;
  if (bracketMatch.length > 2) {
    // Multiple options — tell user to pick one
    const targetName = bracketMatch[0].replace(/[「」]/g, '');
    const options = bracketMatch.slice(1).map(b => b.replace(/[「」]/g, '')).join('、');
    return `请直接输入您要查询的名字（${options}），我再帮您查询。`;
  }

  // Exactly one suggestion — auto-resolve
  const suggestedName = bracketMatch[1].replace(/[「」]/g, '');
  if (!suggestedName || suggestedName.length < 2) return null;

  // Find the original substantive user query — skip pure confirmation messages
  // (e.g., "是马玉鹏" is a name correction, not a data query)
  const msgs = [...history].reverse();
  const confirmationPattern = /^(是|是的|对|对的|确认|没错|嗯|OK|ok|Yes|yes)$/i;
  const nameCorrectionPattern = /^是.{1,6}$/; // "是马玉鹏", "是郑威16" etc.
  let originalQuery = '';
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === 'user') {
      const content = msgs[i].content.trim();
      // Skip pure confirmations and name corrections — look for the real query
      if (confirmationPattern.test(content) || nameCorrectionPattern.test(content)) continue;
      originalQuery = content;
      break;
    }
  }

  // Reconstruct: replace the wrong name with the suggested name in original query
  // Preserve chart-type intent from the original query
  const wrongName = extractNameFromQuery(originalQuery);
  let rewritten: string;
  if (wrongName) {
    rewritten = originalQuery.replace(wrongName, suggestedName);
    // Prevent digit boundary confusion: "杨文平3" + "7月" → "杨文平37月" → "杨文平3 7月"
    rewritten = rewritten.replace(
      new RegExp(suggestedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d)'),
      `${suggestedName} $1`,
    );
  } else {
    // Try to extract chart-type suffix from original query (e.g., "走势图", "饼图")
    const chartSuffix = originalQuery.match(/(走势|折线|柱状|柱形|条形|饼图|雷达|趋势|变化趋势)图?/)?.[0] || '';
    // Also extract time range (e.g., "7-10月份")
    const timeRange = originalQuery.match(/\d+[-~到至]\d+月份?/)?.[0] || '';
    rewritten = `${suggestedName}${timeRange ? ' ' + timeRange : ''}${chartSuffix ? ' ' + chartSuffix : ''}的销售数据`;
  }

  // Persist entity resolution for the session so future queries auto-resolve
  // Use the original failed name (first bracket match in assistant message)
  // since extractNameFromQuery may not always extract it from the query text
  const originalFailedName = bracketMatch[0]?.replace(/[「」]/g, '');
  const cacheKey = wrongName || originalFailedName;
  if (cacheKey && cacheKey !== suggestedName) {
    let cache = entityResolutionCache.get(sessionId);
    if (!cache) {
      cache = new Map();
      entityResolutionCache.set(sessionId, cache);
    }
    cache.set(cacheKey, suggestedName);
    console.log(`[Chat] Entity cached: "${cacheKey}" → "${suggestedName}"`);
  }

  console.log(`[Chat] Confirmation resolved: "${trimmed}" → "${rewritten}"`);
  return rewritten;
}

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

  // Resolve short confirmations ("是" → "郑威16的走势图")
  let resolvedMessage = resolveConfirmation(message, sessionId) || message;

  // Resolve name corrections ("是马玉鹏" → rewrite previous query with corrected name)
  if (resolvedMessage === message) {
    const nameCorrection = resolveNameCorrection(message, sessionId, getDb());
    if (nameCorrection) {
      resolvedMessage = nameCorrection;
    }
  }

  // Resolve disambiguation responses (user directly answers "郑威16" after being asked which one)
  if (resolvedMessage === message) {
    const disambiguation = resolveDisambiguationResponse(message, sessionId, getDb());
    if (disambiguation) {
      resolvedMessage = disambiguation;
    }
  }

  // Resolve follow-up references ("右侧没展示出来", "上面那个", "刚才的图")
  // These are NOT new queries — the user is referring back to the previous result
  const followUp = resolveFollowUp(resolvedMessage, sessionId);
  if (followUp) {
    resolvedMessage = followUp;
    console.log(`[Chat] Follow-up resolved: "${message}" → "${followUp}"`);
  }

  // Apply cached entity resolutions (e.g., "郑威" → "郑威16" if previously confirmed)
  resolvedMessage = applyEntityResolutions(resolvedMessage, sessionId);
  if (resolvedMessage !== message) {
    console.log(`[Chat] Entity-resolved message: "${message}" → "${resolvedMessage}"`);
  }

  const db = getDb();

  // Check if user wants to change chart type of previous query
  const chartChange = resolveChartTypeChange(resolvedMessage, sessionId);
  if (chartChange) {
    // Re-query using cached SQL
    send('status', { phase: 'executing' });
    try {
      const cachedRecords = db.prepare(chartChange.sql).all() as Record<string, unknown>[];
      const columns = cachedRecords.length > 0 ? Object.keys(cachedRecords[0]) : [];
      send('data', { sql: chartChange.sql, records: cachedRecords, columns });

      // Generate new chart with the modified query
      send('status', { phase: 'generating_chart' });
      const chartHtml = await generateChartCode(chartChange.query, cachedRecords, columns);
      if (chartHtml) {
        send('chart', { html: chartHtml });
      }
      persistMessage(sessionId, 'assistant', `已切换图表类型`, JSON.stringify({
        chartHtml: chartHtml || null,
        records: cachedRecords.length > 0 ? cachedRecords : null,
        columns: columns.length > 0 ? columns : null,
        sql: chartChange.sql,
      }));
      send('done', {});
      return;
    } catch (err) {
      console.error('[Chat] Chart type change failed:', err);
      // Fall through to normal pipeline
    }
  }

  // Pre-check: detect ambiguous person names before NL2SQL
  // If the user mentions a short name that has multiple DB matches (e.g., "郑威" → "郑威16", "郑威8"),
  // ask for disambiguation instead of letting NL2SQL generate a full-table query
  const ambiguousName = detectAmbiguousName(resolvedMessage, db);
  if (ambiguousName) {
    if (ambiguousName.autoResolvedQuery) {
      // Single fuzzy match — auto-resolve and continue pipeline
      resolvedMessage = ambiguousName.autoResolvedQuery;
      // Also cache the resolution for future queries
      let cache = entityResolutionCache.get(sessionId);
      if (!cache) {
        cache = new Map();
        entityResolutionCache.set(sessionId, cache);
      }
      cache.set(ambiguousName.ambiguousName, ambiguousName.resolvedName!);
      console.log(`[Chat] Auto-resolved entity cached: "${ambiguousName.ambiguousName}" → "${ambiguousName.resolvedName}"`);
    } else {
      // Multiple matches — ask for disambiguation
      send('text', { text: ambiguousName.suggestion! });
      persistMessage(sessionId, 'assistant', ambiguousName.suggestion!);
      send('done', {});
      return;
    }
  }

  // Phase 1: Generate SQL
  send('status', { phase: 'generating_sql' });
  const engine = new NL2SQLEngine(db);
  const result = await engine.query(resolvedMessage);

  // Post-process: rewrite month-comparison SQL
  if (/对比|比较|相比/.test(message) && !/\bUNION\b/i.test(result.sql)) {
    const groupByMatch = result.sql.match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|$)/i);
    if (groupByMatch && /\bname\b|\bdepartment\b/i.test(groupByMatch[1])) {
      const whereMatch = result.sql.match(/(WHERE\s+[\s\S]+?)(?:\s+GROUP BY|\s+ORDER BY|\s+LIMIT|$)/i);
      const whereClause = whereMatch ? whereMatch[1] : '';
      // Extract the actual aggregated metric from the original SQL instead of hardcoding 'deal'
      const metricMatch = result.sql.match(/SUM\((\w+)\)/i);
      const metric = metricMatch ? metricMatch[1] : 'deal';
      const rewrittenSql = `SELECT month, SUM(${metric}) AS ${metric} FROM sales_performance ${whereClause} GROUP BY month ORDER BY month`.trim();
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
    const suggestion = suggestSimilarName(db, result.sql, resolvedMessage);
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
    const extractedName = extractNameFromQuery(resolvedMessage);
    if (extractedName) {
      const individualRecords = result.records.filter(r =>
        String(r.name || '').includes(extractedName) ||
        String(r.name || '').includes('个人'),
      );
      const hasIndividualData = individualRecords.length > 0
        && individualRecords.some(r => Number(r.deal || 0) > 0);
      if (!hasIndividualData) {
        const suggestion = suggestSimilarName(db, result.sql, resolvedMessage, extractedName);
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

  // Cache successful query for chart type change detection
  lastSuccessCtx.set(sessionId, { resolvedQuery: resolvedMessage, sql: result.sql });

  // Phase 3: Generate analysis text
  send('status', { phase: 'analyzing' });
  const { dimension, metric } = recommendChart(resolvedMessage, result.records);
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

用户问题: ${resolvedMessage}

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
  let chartHtml: string | undefined;
  try {
    chartHtml = await generateChartCode(resolvedMessage, result.records, result.columns);
    if (chartHtml) {
      send('chart', { html: chartHtml });
    }
  } catch (err) {
    console.error('[Chat] Chart generation failed:', err);
  }

  persistMessage(sessionId, 'assistant', analysisText, JSON.stringify({
    chartHtml: chartHtml || null,
    records: result.records.length > 0 ? result.records : null,
    columns: result.columns.length > 0 ? result.columns : null,
    sql: result.sql,
  }));
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

    // Default: use legacy pipeline directly (entity resolution + NL2SQL is most reliable)
    // ReAct pipeline is available via ?mode=react for future use when LLM proxy supports tool calling
    return createSSEStream(async (send) => {
      send('session', { sessionId: sid });
      await executeLegacyPipeline(message, sid, send);
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
    `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? AND name != ? LIMIT 5`,
  ).all(`%${targetName}%`, targetName) as { name: string }[];

  if (similar.length > 0) {
    const nameList = similar.map(n => `「${n.name}」`).join('、');
    return `未找到「${targetName}」的销售记录。您是指 ${nameList} 吗？`;
  }

  // Level 2: Character-level match (any character from the target name)
  for (const char of targetName) {
    const charMatches = db.prepare(
      `SELECT DISTINCT name FROM sales_performance WHERE name LIKE ? LIMIT 5`,
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
    const nameList = allNames.slice(0, 10).map(n => `「${n.name}」`).join('、');
    const more = allNames.length > 10 ? ` 等${allNames.length}人` : '';
    return `系统中没有找到「${targetName}」的销售记录。\n\n目前系统中的销售人员有：${nameList}${more}\n\n请问您要查询的是哪位？`;
  }

  return null;
}
