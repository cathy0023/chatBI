import { RouterAgent } from '@/lib/agents/router-agent';
import { QueryAgent } from '@/lib/agents/query-agent';
import { AnalysisAgent } from '@/lib/agents/analysis-agent';
import { ResponseGenerator } from '@/lib/agents/response-generator';
import { updateSessionTitle } from '@/lib/db/queries';
import type { RouterOutput } from '@/types/agent';
import type { AnalysisOutput } from '@/lib/agents/analysis-agent';
import { getColumnLabel, SALES_COLUMN_META } from '@/types/database';

const routerAgent = new RouterAgent();
const queryAgent = new QueryAgent();
const analysisAgent = new AnalysisAgent();
const responseGenerator = new ResponseGenerator();

export type HandlerResult = {
  text: string;
  uiSchema?: unknown;
  agentTrace?: unknown;
};

const GREETING_PATTERNS = /^(你好|您好|嗨|hi|hello|hey|哈喽|早上好|下午好|晚上好)[\s!！。.]*$/i;

export async function handleMessage(userMessage: string, sessionId: string): Promise<HandlerResult> {
  // Auto-generate session title from first user message (non-greeting)
  if (!GREETING_PATTERNS.test(userMessage.trim())) {
    try {
      const title = userMessage.length > 30 ? userMessage.slice(0, 30) + '…' : userMessage;
      updateSessionTitle(sessionId, title);
    } catch {
      // Title update is non-critical
    }
  }

  // Step 0: Greeting fast-path — skip LLM calls
  if (GREETING_PATTERNS.test(userMessage.trim())) {
    return {
      text: '您好！我是 ChatBI 销售业绩分析助手，可以帮您查询和分析团队销售数据。\n\n您可以试试：\n- 「花园桥校区的业绩」\n- 「分析各部门10月成交情况」\n- 「成交排行榜」\n- 「武莹的销售数据」',
      uiSchema: null,
    };
  }

  // Step 1: Route the message (pure LLM)
  let route: RouterOutput;
  try {
    route = await routerAgent.execute({
      message: userMessage,
    });
  } catch (err) {
    console.error('[Handler] Router error:', err);
    route = {
      intent: 'query',
      confidence: 0.5,
      agents: ['query'],
      params: { message: userMessage },
    };
  }

  const trace = { route, steps: [] as string[] };

  try {
    // Step 2: Query with LLM understanding
    const queryResult = await queryAgent.execute({
      query: userMessage,
      searchType: 'sales',
    });
    trace.steps.push('query');

    const records = queryResult.records;

    // Step 3: If data found, generate response
    if (records.length > 0) {
      let analysisResult: AnalysisOutput | undefined;

      // Run analysis if routed to analysis agents
      if (route.agents.includes('analysis')) {
        try {
          analysisResult = await analysisAgent.execute({
            query: userMessage,
            records,
          });
          trace.steps.push('analysis');
        } catch (analysisErr) {
          console.error('[Handler] Analysis agent error:', analysisErr);
          trace.steps.push('analysis-fallback');
        }
      }

      // Step 4: Generate natural language response
      let responseText: string;
      let uiType: string;

      try {
        const response = await responseGenerator.execute({
          query: userMessage,
          records,
          analysis: analysisResult ? {
            summary: analysisResult.summary,
            insights: analysisResult.insights,
            suggestedChartType: analysisResult.suggestedChartType,
          } : undefined,
        });
        trace.steps.push('response');
        responseText = response.text;
        uiType = response.uiType;
      } catch (responseErr) {
        console.error('[Handler] Response generator error:', responseErr);
        trace.steps.push('response-fallback');
        responseText = formatFallbackText(records, analysisResult);
        uiType = analysisResult?.suggestedChartType || 'table';
      }

      const uiSchema = buildUISchema(records, userMessage, analysisResult, uiType);
      return { text: responseText, uiSchema, agentTrace: trace };
    }

    // No data found
    if (route.agents.includes('generator')) {
      return {
        text: '内容生成功能正在开发中，敬请期待。',
        uiSchema: null,
        agentTrace: trace,
      };
    }

    return {
      text: '抱歉，没有找到相关的销售数据。请尝试换个关键词，例如部门名称、人员姓名或月份。',
      uiSchema: null,
      agentTrace: trace,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      text: `处理您的问题时遇到错误：${errorMsg}。请稍后重试。`,
      agentTrace: { ...trace, error: errorMsg },
    };
  }
}

// Fallback text formatting when ResponseGenerator fails
function formatFallbackText(
  records: Record<string, unknown>[],
  analysis?: AnalysisOutput,
): string {
  if (analysis) {
    const insightList = analysis.insights.map((ins: string, i: number) => `${i + 1}. ${ins}`).join('\n');
    return `基于 ${records.length} 条数据的分析：\n\n摘要: ${analysis.summary}\n\n关键洞察:\n${insightList}`;
  }
  const items = records.slice(0, 5).map((r, i) => {
    const name = String(r.name || '');
    const dept = String(r.department || '');
    const month = String(r.month || '');
    const deal = Number(r.deal || 0);
    return `${i + 1}. ${name} [${dept}] ${month} - 成交: ${deal}`;
  });
  return `找到 ${records.length} 条结果:\n\n${items.join('\n')}`;
}

// Detect if the query asks for multi-month rankings (e.g., "各月前五名", "四个月各自的排名")
function detectMultiMonthRanking(query: string, records: Record<string, unknown>[]): boolean {
  const rankingKws = ['排名', '排行', '前五', '前5', 'top', '前几', '前10', '前十', '最好', '最高', '最多'];
  const multiMonthKws = ['各月', '每个月', '各自', '四个月', '各个月', '分别', '每月', '个月'];
  const lowerQuery = query.toLowerCase();
  const hasRanking = rankingKws.some(kw => lowerQuery.includes(kw));
  const hasMultiMonth = multiMonthKws.some(kw => query.includes(kw));
  const monthsInData = new Set(records.map(r => String(r.month || '')));
  return hasRanking && (hasMultiMonth || monthsInData.size > 1);
}

// Build composite-key chart data for multi-month ranking: "月份 姓名" → metric value
function buildRankingChartData(
  records: Record<string, unknown>[],
  metric: string,
): Record<string, number> {
  const byMonth: Record<string, Array<{ key: string; value: number }>> = {};
  for (const r of records) {
    const month = String(r.month || '');
    const name = String(r.name || '');
    const value = Number(r[metric] || 0);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push({ key: `${month} ${name}`, value });
  }
  const result: Record<string, number> = {};
  for (const month of Object.keys(byMonth).sort()) {
    const items = byMonth[month].sort((a, b) => b.value - a.value).slice(0, 5);
    for (const item of items) {
      result[item.key] = item.value;
    }
  }
  return result;
}

// Unified UISchema builder — single source of truth for right panel data
function buildUISchema(
  records: Record<string, unknown>[],
  query: string,
  analysis?: AnalysisOutput,
  uiType?: string,
): unknown {
  const rows = records.map(r => ({
    name: String(r.name || ''),
    department: String(r.department || ''),
    month: String(r.month || ''),
    wechat_added: Number(r.wechat_added || 0),
    interaction: Number(r.interaction || 0),
    demand: Number(r.demand || 0),
    deal: Number(r.deal || 0),
  }));

  // Determine the aggregation dimension and metric from the query
  const dimension = detectChartDimension(query);
  const metric = detectMetricFromQuery(query);

  // For multi-month ranking queries, use table view with all rows
  const isMultiMonthRanking = detectMultiMonthRanking(query, records);
  const aggregation = isMultiMonthRanking
    ? buildRankingChartData(records, metric)
    : aggregateBy(records, dimension, metric);

  return {
    type: isMultiMonthRanking ? 'table' : (uiType || analysis?.suggestedChartType || 'table'),
    data: {
      rows,
      // Chart data: single aggregation, dimension-aware
      chartData: aggregation,
      dimension,
      metric,
      metricLabel: getColumnLabel(metric),
      dimensionLabel: getColumnLabel(dimension),
      totalCount: records.length,
      ...(analysis?.dataSummary || {}),
    },
    title: query,
    summary: analysis?.summary,
    insights: analysis?.insights,
  };
}

// Generic aggregation: group records by any dimension field, sum any metric field
function aggregateBy(
  records: Record<string, unknown>[],
  dimension: string,
  metric: string,
): Record<string, number> {
  const agg: Record<string, number> = {};
  for (const r of records) {
    const key = String(r[dimension] || 'unknown');
    const value = Number(r[metric] || 0);
    agg[key] = (agg[key] || 0) + value;
  }
  // Sort by value descending (month dimension keeps natural order)
  if (dimension !== 'month') {
    return Object.fromEntries(Object.entries(agg).sort(([, a], [, b]) => b - a));
  }
  return agg;
}

// Detect which dimension the user wants to see on the chart axis
function detectChartDimension(query: string): 'name' | 'month' | 'department' {
  const personKeywords = ['销售员', '销售人员', '人员', '谁', '个人', '每个人', '各人', '各位', '名字'];
  const monthKeywords = ['月份', '各月', '每月', '月度', '趋势', '变化', '走势'];
  const deptKeywords = ['部门', '校区', '各部', '各部门', '团队', '中心'];

  const lowerQuery = query.toLowerCase();

  if (personKeywords.some(kw => lowerQuery.includes(kw))) return 'name';
  if (deptKeywords.some(kw => lowerQuery.includes(kw))) return 'department';
  if (monthKeywords.some(kw => lowerQuery.includes(kw))) return 'month';

  return 'month';
}

// Detect which metric the user cares about — reuses column metadata labels
function detectMetricFromQuery(query: string): string {
  // Match Chinese labels from SALES_COLUMN_META against the query
  for (const [key, meta] of Object.entries(SALES_COLUMN_META)) {
    if (meta.role === 'metric' && query.includes(meta.label.replace('数', ''))) {
      return key;
    }
  }
  // Extra Chinese aliases not in the label
  if (/成交|销量|成单/.test(query)) return 'deal';
  if (/互动|企微/.test(query)) return 'interaction';
  return 'deal';
}
