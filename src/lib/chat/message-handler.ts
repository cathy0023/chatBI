import { streamText } from 'ai';
import { RouterAgent } from '@/lib/agents/router-agent';
import { UnifiedAnalysisResponse, type UnifiedOutput } from '@/lib/agents/unified-analysis-response';
import { matchByKeywords } from '@/lib/agents/router-rules';
import { getSession, updateSessionTitle } from '@/lib/db/queries';
import { queryAgent } from '@/lib/agents/agent-instances';
import { buildUISchema } from '@/lib/agents/chart-recommender';
import { KEYWORD_CONFIDENCE_THRESHOLD, GREETING_PATTERNS, GREETING_RESPONSE } from '@/lib/agents/constants';
import { buildDataAnalystPrompt } from '@/lib/chat/prompts/data-analyst';
import { getDefaultModel } from '@/lib/llm/provider';
import type { RouterOutput } from '@/types/agent';

const routerAgent = new RouterAgent();
const unifiedAgent = new UnifiedAnalysisResponse();

// ==================== Types ====================

export type SSEEvent =
  | { type: 'text'; data: { text: string } }
  | { type: 'uiSchema'; data: { uiSchema: unknown } }
  | { type: 'visualization'; data: unknown }
  | { type: 'done'; data: Record<string, unknown> }
  | { type: 'error'; data: { error: string } };

export type HandlerResult = {
  text: string;
  uiSchema?: unknown;
  agentTrace?: unknown;
};

// ==================== Legacy Handler (for tests) ====================

/**
 * Legacy synchronous handler — used by tests and SSE wrapper.
 * For streaming, use handleStreaming() instead.
 */
export async function handleMessage(userMessage: string, sessionId: string): Promise<HandlerResult> {
  // Auto-generate session title from first user message
  if (!GREETING_PATTERNS.test(userMessage.trim())) {
    try {
      const session = getSession(sessionId);
      if (!session || !session.title) {
        const title = userMessage.length > 30 ? userMessage.slice(0, 30) + '…' : userMessage;
        updateSessionTitle(sessionId, title);
      }
    } catch {
      // Title update is non-critical — ignore
    }
  }

  // Greeting fast-path
  if (GREETING_PATTERNS.test(userMessage.trim())) {
    return { text: GREETING_RESPONSE, uiSchema: null };
  }

  // Route → Query → Process
  const { route, routeSource, queryResult } = await routeAndQuery(userMessage);
  const trace = { route: { ...route, source: routeSource }, steps: ['query'] as string[] };

  return processQueryResult(queryResult.records, userMessage, route, trace);
}

// ==================== Streaming Handler ====================

/**
 * Streaming handler — yields SSE events for real-time response.
 * This is the primary entry point for route.ts.
 */
export async function* handleStreaming(
  userMessage: string,
  sessionId: string,
): AsyncGenerator<SSEEvent> {
  // Auto-generate session title
  if (!GREETING_PATTERNS.test(userMessage.trim())) {
    try {
      const session = getSession(sessionId);
      if (!session || !session.title) {
        const title = userMessage.length > 30 ? userMessage.slice(0, 30) + '…' : userMessage;
        updateSessionTitle(sessionId, title);
      }
    } catch {
      // Title update is non-critical — ignore
    }
  }

  // Greeting fast-path
  if (GREETING_PATTERNS.test(userMessage.trim())) {
    yield { type: 'text', data: { text: GREETING_RESPONSE } };
    yield { type: 'done', data: {} };
    return;
  }

  // Route → Query
  const { route, routeSource, queryResult } = await routeAndQuery(userMessage);

  // No results — return fallback message
  if (queryResult.records.length === 0) {
    if (route.agents.includes('generator')) {
      yield { type: 'text', data: { text: '内容生成功能正在开发中，敬请期待。' } };
    } else {
      yield { type: 'text', data: { text: '抱歉，没有找到相关的销售数据。请尝试换个关键词，例如部门名称、人员姓名或月份。' } };
    }
    yield { type: 'done', data: {} };
    return;
  }

  // Data found → stream text analysis
  const systemPrompt = buildDataAnalystPrompt(userMessage, queryResult.records);
  let fullText = '';

  // Generate instant fallback text from data (no LLM needed)
  const fallbackText = formatDataSummary(queryResult.records, userMessage);

  try {
    const streamResult = streamText({
      model: getDefaultModel(),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Set a deadline: if LLM doesn't produce text in 15s, use fallback
    const deadline = setTimeout(() => {
      if (fullText.length === 0) {
        console.log('[Handler] LLM text timeout, using fallback');
      }
    }, 15000);

    for await (const chunk of streamResult.textStream) {
      fullText += chunk;
      yield { type: 'text', data: { text: fullText } };
    }

    clearTimeout(deadline);
    await streamResult.text;
  } catch {
    // streamText failed → use fallback text
    console.error('[Handler] streamText error, using fallback text');
  }

  // If LLM produced no text, use the data-based fallback
  if (fullText.length === 0) {
    fullText = fallbackText;
    yield { type: 'text', data: { text: fullText } };
  }

  // === Chart: ALWAYS produce a chart event ===
  // Use buildUISchema which generates reliable ECharts options from data
  const uiSchema = buildUISchema(queryResult.records, userMessage);
  yield { type: 'uiSchema', data: { uiSchema } };

  yield { type: 'done', data: {} };
}

// ==================== Shared Helpers ====================

/**
 * Route and query — shared between streaming and legacy paths.
 */
async function routeAndQuery(userMessage: string): Promise<{
  route: RouterOutput;
  routeSource: 'keyword' | 'llm' | 'fallback';
  queryResult: Awaited<ReturnType<typeof queryAgent.execute>>;
}> {
  const keywordMatch = matchByKeywords(userMessage);

  // High-confidence keyword match — skip LLM router
  if (keywordMatch && keywordMatch.confidence >= KEYWORD_CONFIDENCE_THRESHOLD) {
    const route: RouterOutput = {
      intent: (keywordMatch.intent as RouterOutput['intent']) || 'query',
      confidence: keywordMatch.confidence,
      agents: keywordMatch.agents,
      params: {},
    };
    try {
      const queryResult = await queryAgent.execute({ query: userMessage, searchType: 'sales' });
      return { route, routeSource: 'keyword', queryResult };
    } catch (queryErr) {
      console.error('[routeAndQuery] keyword query failed, falling back:', queryErr instanceof Error ? queryErr.message : String(queryErr));
      // Return empty results — handler will show "no data" message
      return {
        route,
        routeSource: 'keyword',
        queryResult: { records: [], totalCount: 0, query: userMessage, searchType: 'sales', confidence: 0 },
      };
    }
  }

  // LLM router + query in parallel
  try {
    const [llmRoute, queryResult] = await Promise.all([
      routerAgent.execute({ message: userMessage }),
      queryAgent.execute({ query: userMessage, searchType: 'sales' }),
    ]);
    return { route: llmRoute, routeSource: 'llm', queryResult };
  } catch (outerErr) {
    // LLM router failed — graceful degradation: try query alone
    try {
      const queryResult = await queryAgent.execute({ query: userMessage, searchType: 'sales' });
      return {
        route: { intent: 'query', confidence: 0.5, agents: ['query'], params: {} },
        routeSource: 'fallback',
        queryResult,
      };
    } catch (innerErr) {
      // Both router and query failed — return empty result gracefully
      console.error('[Handler] RouteAndQuery: both router and query failed', innerErr instanceof Error ? innerErr.message : String(innerErr));
      return {
        route: { intent: 'query', confidence: 0.5, agents: ['query'], params: {} },
        routeSource: 'fallback',
        queryResult: { records: [], totalCount: 0, query: userMessage, searchType: 'sales', confidence: 0 },
      };
    }
  }
}

/**
 * Process query results with unified agent — extracted for testability.
 */
export async function processQueryResult(
  records: Record<string, unknown>[],
  query: string,
  routeResult: RouterOutput,
  traceData: { route: unknown; steps: string[] },
): Promise<HandlerResult> {
  if (records.length === 0) {
    if (routeResult.agents.includes('generator')) {
      return {
        text: '内容生成功能正在开发中，敬请期待。',
        uiSchema: null,
        agentTrace: traceData,
      };
    }
    return {
      text: '抱歉，没有找到相关的销售数据。请尝试换个关键词，例如部门名称、人员姓名或月份。',
      uiSchema: null,
      agentTrace: traceData,
    };
  }

  const shouldAnalyze = routeResult.agents.includes('analysis');

  let unifiedResult: UnifiedOutput;
  try {
    unifiedResult = await unifiedAgent.execute({
      query,
      records,
      needsAnalysis: shouldAnalyze,
    });
    traceData.steps.push('unified');
  } catch (unifiedErr) {
    console.error('[Handler] Unified agent error:', unifiedErr);
    traceData.steps.push('unified-fallback');
    return {
      text: formatFallbackText(records),
      uiSchema: buildUISchema(records, query),
      agentTrace: traceData,
    };
  }

  const analysisOutput = shouldAnalyze
    ? {
        summary: unifiedResult.summary,
        insights: unifiedResult.insights,
        dataSummary: unifiedResult.dataSummary,
        suggestedChartType: unifiedResult.suggestedChartType,
      }
    : undefined;

  const uiSchema = buildUISchema(records, query, analysisOutput, unifiedResult.uiType);
  return { text: unifiedResult.text, uiSchema, agentTrace: traceData };
}

function formatList(items: Array<{ label: string; value: number }>, unit: string): string {
  const lines = items.slice(0, 10).map((item, i) => `${i + 1}. ${item.label}: ${item.value}笔`);
  return `查询到 ${items.length} ${unit}，前10名：\n${lines.join('\n')}`;
}

function formatDataSummary(records: Record<string, unknown>[], query: string): string {
  if (records.length === 0) return '没有找到匹配的数据。';

  const keys = Object.keys(records[0]);
  const wantPerson = /销售|人员|谁|top|前|排行|排名|个人|名字/.test(query);
  const deal = (r: Record<string, unknown>) => Number(r.deal || 0);

  // Month trend (no person/dept dimension)
  if (keys.includes('month') && !keys.includes('name') && !keys.includes('department')) {
    return `月度数据：\n${records.map(r => `${r.month}: ${deal(r)}笔`).join(' → ')}`;
  }

  // Determine display dimension by data shape + query intent
  const showPerson = keys.includes('name') && (wantPerson || !keys.includes('department'));
  const dim = showPerson ? 'name' : 'department';
  const unit = showPerson ? '条数据' : '个部门';

  return formatList(records.map(r => ({ label: String(r[dim] || ''), value: deal(r) })), unit);
}

function formatFallbackText(records: Record<string, unknown>[]): string {
  const items = records.slice(0, 5).map((r, i) => {
    const name = String(r.name || '');
    const dept = String(r.department || '');
    const month = String(r.month || '');
    const deal = Number(r.deal || 0);
    return `${i + 1}. ${name} [${dept}] ${month} - 成交: ${deal}`;
  });
  return `找到 ${records.length} 条结果:\n\n${items.join('\n')}`;
}
