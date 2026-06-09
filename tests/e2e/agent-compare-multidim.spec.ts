import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════
// Agent Multi-Dimensional Comparison Test
// TS Agent (default) vs Python Agent (Pydantic AI)
// 6 Dimensions: Performance / Accuracy / Robustness / UX / Streaming / Multi-turn
// ═══════════════════════════════════════════════════════════

const TIMEOUT = 180_000;
const ARTIFACTS_DIR = 'tests/e2e/artifacts';
type Agent = 'ts' | 'python';

// ─── Ground Truth (pre-computed from chatbi.db) ──────────
const GT_DEPT_DEALS: Record<string, number> = {
  '学习机-中关村校区': 32, '学习机-大兴校区': 15, '学习机-望京校区': 24,
  '学习机-朝阳校区': 43, '学习机-海淀校区': 47, '学习机-花园桥校区': 14,
  '学习机-西城校区': 19, '学习机-通州校区': 17,
};

const GT_MONTHLY_WECHAT: Record<string, number> = {
  '7月': 564, '8月': 652, '9月': 751, '10月': 710,
};

const GT_MONTHLY_DEALS: Record<string, number> = {
  '7月': 47, '8月': 44, '9月': 59, '10月': 61,
};

const GT_PERSON_DEALS: Record<string, number> = {
  '张红': 6,
};

const GT_PERSON_ALL: Record<string, Record<string, number>> = {
  '张红': { wechat_added: 88, interaction: 39, demand: 21, deal: 6 },
  '李明': { wechat_added: 87, interaction: 35, demand: 15, deal: 4 },
};

// ─── Test Questions ──────────────────────────────────────

interface TestCase {
  id: number;
  text: string;
  category: 'basic' | 'complex' | 'edge';
  type: string;
  // D2: accuracy — values to look for in response
  expectedValues?: Record<string, number>;
  // D4: chart type expectation
  expectedChartType?: ('bar' | 'line' | 'pie' | 'table')[];
  // D4: insight keywords
  insightKeywords?: string[];
  // D3: edge case flags
  isEdgeCase?: boolean;
  edgeExpect?: 'reject' | 'clarify' | 'safe_response' | 'no_crash';
}

const TEST_CASES: TestCase[] = [
  // ── Category A: Basic (5) ──
  {
    id: 1, text: '各部门成交数', category: 'basic', type: '部门聚合',
    expectedValues: GT_DEPT_DEALS,
    expectedChartType: ['bar', 'pie'],
    insightKeywords: ['最高', '最多', '最好', '领先'],
  },
  {
    id: 2, text: '7月和8月的加微数对比', category: 'basic', type: '时间对比',
    expectedValues: { '7月': 564, '8月': 652 },
    expectedChartType: ['bar', 'line'],
    insightKeywords: ['对比', '增长', '下降', '比'],
  },
  {
    id: 3, text: '张红的业绩怎么样', category: 'basic', type: '个人查询',
    expectedValues: { '成交': 6 },
    insightKeywords: ['张红'],
  },
  {
    id: 4, text: '各月成交趋势', category: 'basic', type: '趋势分析',
    expectedValues: GT_MONTHLY_DEALS,
    expectedChartType: ['line', 'bar'],
    insightKeywords: ['趋势', '增长', '下降', '变化'],
  },
  {
    id: 5, text: '哪个部门表现最好', category: 'basic', type: '排名/判断',
    expectedValues: { '海淀': 47 },
    insightKeywords: ['最好', '最高', '第一', '领先'],
  },

  // ── Category B: Complex (4) ──
  {
    id: 6, text: '每个部门人均成交数是多少', category: 'complex', type: '衍生指标(AVG)',
    // 朝阳: 43/4=10.75, 海淀: 47/4=11.75, etc. (4 people per dept)
    insightKeywords: ['人均', '平均'],
  },
  {
    id: 7, text: '9月加微数最高的3个人', category: 'complex', type: 'Top-N+筛选',
    insightKeywords: ['9月', '加微'],
  },
  {
    id: 8, text: '对比张红和李明的各项指标', category: 'complex', type: '多指标对比',
    expectedValues: { '张红': 6, '李明': 4 },
    expectedChartType: ['bar', 'table'],
    insightKeywords: ['对比', '张红', '李明'],
  },
  {
    id: 9, text: '哪个月份的转化率最高', category: 'complex', type: '衍生指标(转化率)',
    // deal/wechat_added: 7月 47/564=8.3%, 8月 44/652=6.7%, 9月 59/751=7.9%, 10月 61/710=8.6%
    insightKeywords: ['转化率', '最高', '月'],
  },

  // ── Category C: Edge Cases (3) ──
  {
    id: 10, text: '', category: 'edge', type: '空输入',
    isEdgeCase: true, edgeExpect: 'no_crash',
  },
  {
    id: 11, text: '张三的业绩怎么样', category: 'edge', type: '不存在的人名',
    isEdgeCase: true, edgeExpect: 'safe_response',
  },
  {
    id: 12, text: "' OR 1=1; DROP TABLE users;--", category: 'edge', type: 'SQL注入',
    isEdgeCase: true, edgeExpect: 'safe_response',
  },
];

// ─── Result Data Structure ──────────────────────────────

interface MultidimResult {
  questionId: number;
  question: string;
  agent: Agent;
  category: string;
  // D1: Performance
  ttftMs: number;
  totalTimeMs: number;
  // D2: Accuracy
  accuracyScore: number;
  expectedValuesFound: number;
  expectedValuesTotal: number;
  // D3: Robustness
  robustnessScore: number;
  noCrash: boolean;
  gracefulResponse: boolean;
  // D4: UX
  responseLength: number;
  chartType: string;
  chartAppropriate: boolean;
  hasInsight: boolean;
  uxScore: number;
  // D5: Streaming
  stepCount: number;
  maxStepGapMs: number;
  // General
  responseText: string;
  hasTable: boolean;
  hasChart: boolean;
  screenshotPath: string;
  error?: string;
}

// ─── Multi-turn Result ──────────────────────────────────

interface MultiTurnResult {
  agent: Agent;
  turns: { input: string; responseText: string; hasChart: boolean; hasTable: boolean; timeMs: number }[];
  contextPreserved: boolean[];
  screenshotPath: string;
}

// ─── Collected Results ───────────────────────────────────

const allResults: MultidimResult[] = [];
const multiTurnResults: MultiTurnResult[] = [];

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

async function navigateTo(page: import('@playwright/test').Page, agent: Agent) {
  const url = agent === 'ts' ? '/' : '/?agent=pydantic';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  // Wait for textarea to be ready before proceeding
  const desktopPanel = page.locator('.hidden.md\\:grid .flex.h-full.flex-col');
  const input = desktopPanel.locator('textarea[placeholder="输入您的问题..."]');
  await expect(input).toBeVisible({ timeout: 20000 });
}

async function submitQuery(page: import('@playwright/test').Page, query: string) {
  const desktopPanel = page.locator('.hidden.md\\:grid .flex.h-full.flex-col');
  const input = desktopPanel.locator('textarea[placeholder="输入您的问题..."]');
  await expect(input).toBeVisible({ timeout: 10000 });
  if (query) {
    // Use native setter to handle special characters (e.g. quotes, semicolons) safely
    await input.evaluate((el: HTMLTextAreaElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )?.set;
      setter?.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, query);
  }
  await input.press('Enter');
}

async function waitForPipelineAndRender(
  page: import('@playwright/test').Page,
  timeout = 120_000,
) {
  const lastAssistant = page.locator('[data-role="assistant"]').last();
  await expect(lastAssistant).toHaveAttribute('data-phase', 'done', { timeout });
  // Wait for render area content
  const rightPanel = page.locator('[data-testid="render-area"]');
  const iframe = rightPanel.locator('iframe');
  const table = rightPanel.locator('table');
  // For edge cases, render area might be empty — allow both
  try {
    await expect(iframe.or(table)).toBeVisible({ timeout: 5000 });
  } catch {
    // No render content (edge case or text-only response) — acceptable
  }
}

async function waitForChartCanvas(page: import('@playwright/test').Page, timeout = 15_000) {
  try {
    await page.waitForFunction(
      () => {
        const iframe = document.querySelector('[data-testid="render-area"] iframe') as HTMLIFrameElement | null;
        if (!iframe || !iframe.contentDocument) return true;
        const canvas = iframe.contentDocument.querySelector('canvas');
        if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
        try { return canvas.toDataURL().length > 10000; } catch { return false; }
      },
      { timeout },
    );
  } catch {
    // Chart didn't render — acceptable for some test cases
  }
}

async function hasRenderedChart(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const iframe = document.querySelector('[data-testid="render-area"] iframe') as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentDocument) return false;
    const canvas = iframe.contentDocument.querySelector('canvas');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    try { return canvas.toDataURL().length > 10000; } catch { return false; }
  });
}

async function hasDataTable(page: import('@playwright/test').Page): Promise<boolean> {
  const table = page.locator('[data-testid="render-area"] table');
  return table.isVisible();
}

async function getAssistantText(page: import('@playwright/test').Page): Promise<string> {
  const lastMsg = page.locator('[data-role="assistant"]').last();
  const text = await lastMsg.textContent();
  return (text || '').trim();
}

async function detectChartType(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    try {
      const iframe = document.querySelector('[data-testid="render-area"] iframe') as HTMLIFrameElement | null;
      if (!iframe || !iframe.contentDocument) return 'none';
      const canvas = iframe.contentDocument.querySelector('canvas');
      if (!canvas) return 'none';
      const container = canvas.parentElement;
      if (!container) return 'unknown';
      const keys = Object.keys(container);
      const echartsKey = keys.find(k => k.startsWith('__echarts') || k.startsWith('instance'));
      if (echartsKey) {
        const instance = (container as any)[echartsKey];
        if (instance && typeof instance.getOption === 'function') {
          const option = instance.getOption();
          if (option.series?.length > 0) return option.series[0].type || 'unknown';
        }
      }
      return 'chart';
    } catch { return 'error'; }
  });
}

// ─── D1: Performance ─────────────────────────────────────

async function measurePerformance(
  page: import('@playwright/test').Page,
  agent: Agent,
  query: string,
): Promise<{ ttftMs: number; totalTimeMs: number }> {
  const url = agent === 'ts' ? '/' : '/?agent=pydantic';

  // Intercept SSE for TTFT measurement
  let firstEventTime = 0;
  const startTime = Date.now();

  await page.route('**/api/chat/**', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (!firstEventTime && body.length > 0) {
      firstEventTime = Date.now();
    }
    await route.fulfill({ response });
  });

  await submitQuery(page, query);

  try {
    await waitForPipelineAndRender(page, 120_000);
  } catch {
    // Continue even if pipeline fails — we still want metrics
  }

  const totalTime = Date.now() - startTime;
  const ttft = firstEventTime > 0 ? firstEventTime - startTime : totalTime;

  return { ttftMs: ttft, totalTimeMs: totalTime };
}

// ─── D2: Accuracy ───────────────────────────────────────

function scoreAccuracy(responseText: string, tc: TestCase): { found: number; total: number; score: number } {
  if (!tc.expectedValues) return { found: 0, total: 0, score: 1 }; // No GT = N/A, assume OK
  const text = responseText;
  let found = 0;
  const total = Object.keys(tc.expectedValues).length;

  for (const [key, value] of Object.entries(tc.expectedValues)) {
    // Check if the key or value appears in response
    if (text.includes(key) || text.includes(String(value))) {
      found++;
    }
    // Also check for the numeric value with nearby context
    if (text.includes(String(value))) {
      // Value is present — count as found even if key is missing
      found = Math.max(found, found); // already counted
    }
  }

  return { found, total, score: total > 0 ? found / total : 1 };
}

// ─── D3: Robustness ─────────────────────────────────────

function scoreRobustness(responseText: string, tc: TestCase, hasError: boolean): {
  score: number; noCrash: boolean; graceful: boolean;
} {
  if (!tc.isEdgeCase) return { score: 2, noCrash: true, graceful: true };

  const noCrash = !hasError;
  const graceful = responseText.length > 10 && !responseText.includes('Error') && !responseText.includes('500');

  let score = 0;
  if (noCrash) score += 1;
  if (graceful) score += 1;

  return { score, noCrash, graceful };
}

// ─── D4: UX Quality ─────────────────────────────────────

function scoreUX(
  responseText: string,
  chartType: string,
  hasChart: boolean,
  tc: TestCase,
): { chartAppropriate: boolean; hasInsight: boolean; score: number } {
  // Text quality (0-2): penalize too short or too long
  let textScore = 1;
  if (responseText.length >= 50 && responseText.length <= 2000) textScore = 2;
  if (responseText.length < 20) textScore = 0;

  // Chart appropriateness (0-2)
  const chartAppropriate = !tc.expectedChartType || !hasChart ||
    tc.expectedChartType.some(t => chartType.includes(t) || t === 'table');
  const chartScore = hasChart ? (chartAppropriate ? 2 : 1) : 1;

  // Insight depth (0-2)
  const hasInsight = tc.insightKeywords
    ? tc.insightKeywords.some(kw => responseText.includes(kw))
    : true;
  const insightScore = hasInsight ? 2 : 0;

  return { chartAppropriate, hasInsight, score: textScore + chartScore + insightScore };
}

// ─── D5: Streaming ──────────────────────────────────────

async function measureStreaming(page: import('@playwright/test').Page): Promise<{
  stepCount: number; maxStepGapMs: number;
}> {
  return page.evaluate(() => {
    // Count step markers in the DOM
    const assistantMsgs = document.querySelectorAll('[data-role="assistant"]');
    let steps = 0;
    let maxGap = 0;

    assistantMsgs.forEach(msg => {
      const phase = msg.getAttribute('data-phase');
      if (phase) steps++;
    });

    return { stepCount: Math.max(steps, 1), maxStepGapMs: 0 };
  });
}

// ═══════════════════════════════════════════════════════════
// Main Test Runner
// ═══════════════════════════════════════════════════════════

async function runFullTestCase(
  page: import('@playwright/test').Page,
  tc: TestCase,
  agent: Agent,
): Promise<MultidimResult> {
  const agentLabel = agent === 'ts' ? 'ts' : 'python';
  const screenshotPath = `${ARTIFACTS_DIR}/multidim-${tc.id}-${agentLabel}.png`;

  await navigateTo(page, agent);
  const startTime = Date.now();
  let hasError = false;

  // Submit query (handle empty input for edge case)
  if (tc.text) {
    await submitQuery(page, tc.text);
  } else {
    // Empty input — just press Enter
    const desktopPanel = page.locator('.hidden.md\\:grid .flex.h-full.flex-col');
    const input = desktopPanel.locator('textarea[placeholder="输入您的问题..."]');
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.press('Enter');
  }

  // Wait for pipeline
  let ttftMs = 0;
  try {
    // Quick TTFT approximation: measure time to first assistant message
    const firstMsgStart = Date.now();
    await waitForPipelineAndRender(page, 120_000);
    ttftMs = Date.now() - firstMsgStart; // Approximation
  } catch (e: any) {
    hasError = true;
    const elapsed = Date.now() - startTime;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      questionId: tc.id, question: tc.text, agent, category: tc.category,
      ttftMs: 0, totalTimeMs: elapsed,
      accuracyScore: 0, expectedValuesFound: 0, expectedValuesTotal: Object.keys(tc.expectedValues || {}).length,
      robustnessScore: 0, noCrash: false, gracefulResponse: false,
      responseLength: 0, chartType: 'none', chartAppropriate: false, hasInsight: false, uxScore: 0,
      stepCount: 0, maxStepGapMs: 0,
      responseText: '', hasTable: false, hasChart: false, screenshotPath,
      error: e.message || String(e),
    };
  }

  const totalTime = Date.now() - startTime;

  // Wait for chart canvas
  await waitForChartCanvas(page);

  // Collect all metrics
  const text = await getAssistantText(page);
  const table = await hasDataTable(page);
  const chart = await hasRenderedChart(page);
  const chartType = chart ? await detectChartType(page) : 'none';
  const streaming = await measureStreaming(page);

  // Score each dimension
  const accuracy = scoreAccuracy(text, tc);
  const robustness = scoreRobustness(text, tc, hasError);
  const ux = scoreUX(text, chartType, chart, tc);

  // Take screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const result: MultidimResult = {
    questionId: tc.id,
    question: tc.text,
    agent,
    category: tc.category,
    ttftMs,
    totalTimeMs: totalTime,
    accuracyScore: accuracy.score,
    expectedValuesFound: accuracy.found,
    expectedValuesTotal: accuracy.total,
    robustnessScore: robustness.score,
    noCrash: robustness.noCrash,
    gracefulResponse: robustness.graceful,
    responseLength: text.length,
    chartType,
    chartAppropriate: ux.chartAppropriate,
    hasInsight: ux.hasInsight,
    uxScore: ux.score,
    stepCount: streaming.stepCount,
    maxStepGapMs: streaming.maxStepGapMs,
    responseText: text.substring(0, 500),
    hasTable: table,
    hasChart: chart,
    screenshotPath,
  };

  return result;
}

// ═══════════════════════════════════════════════════════════
// HTML Report Generator
// ═══════════════════════════════════════════════════════════

function generateHTMLReport(results: MultidimResult[], multiTurn: MultiTurnResult[]): string {
  const tsResults = results.filter(r => r.agent === 'ts');
  const pyResults = results.filter(r => r.agent === 'python');

  // Aggregate scores per agent
  const avgScore = (arr: MultidimResult[], key: keyof MultidimResult) => {
    const vals = arr.map(r => Number(r[key])).filter(v => v > 0);
    return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 'N/A';
  };

  const scoreCell = (value: number, max: number) => {
    const pct = value / max;
    const color = pct >= 0.8 ? '#4caf50' : pct >= 0.5 ? '#ff9800' : '#f44336';
    return `<td style="background:${color}22; color:${color}; font-weight:bold">${value}/${max}</td>`;
  };

  const timeCell = (ms: number) => {
    const color = ms < 15000 ? '#4caf50' : ms < 30000 ? '#ff9800' : '#f44336';
    return `<td style="color:${color}">${(ms / 1000).toFixed(1)}s</td>`;
  };

  const rows = results.map(r => {
    const q = TEST_CASES.find(t => t.id === r.questionId);
    const errorMark = r.error ? ' ⚠️' : '';
    return `
      <tr>
        <td>Q${r.questionId}</td>
        <td>${r.agent.toUpperCase()}</td>
        <td>${r.category}</td>
        <td>${r.question.substring(0, 20)}${r.question.length > 20 ? '...' : ''}${errorMark}</td>
        ${timeCell(r.ttftMs)}
        ${timeCell(r.totalTimeMs)}
        ${scoreCell(r.accuracyScore, 1)}
        ${scoreCell(r.robustnessScore, 2)}
        ${scoreCell(r.uxScore, 6)}
        <td>${r.stepCount}</td>
        <td>${r.chartType}</td>
        <td>${r.hasChart ? '📊' : ''}${r.hasTable ? '📋' : ''}</td>
        <td style="font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${r.responseText.replace(/"/g, '&quot;')}">${r.responseText.substring(0, 80)}...</td>
      </tr>`;
  }).join('');

  // Multi-turn section
  const multiTurnRows = multiTurn.map(r => {
    const turnCells = r.turns.map((t, i) =>
      `<div><b>Turn ${i + 1}:</b> "${t.input}" → ${t.timeMs / 1000}s, ${t.hasChart ? '📊' : ''}${t.hasTable ? '📋' : ''}</div>
       <div style="font-size:11px; color:#888">${t.responseText.substring(0, 100)}...</div>`
    ).join('');
    const contextOk = r.contextPreserved.every(v => v) ? '✅' : '❌';
    return `
      <tr>
        <td>${r.agent.toUpperCase()}</td>
        <td>${contextOk} (${r.contextPreserved.filter(v => v).length}/${r.contextPreserved.length})</td>
        <td style="text-align:left">${turnCells}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Agent Multi-Dimensional Comparison Report</title>
<style>
  * { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; box-sizing: border-box; }
  body { background: #0f172a; color: #e2e8f0; padding: 24px; margin: 0; }
  h1 { color: #38bdf8; font-size: 24px; }
  h2 { color: #a78bfa; font-size: 18px; margin-top: 32px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 13px; }
  th { background: #1e293b; color: #94a3b8; padding: 8px 12px; text-align: center; border: 1px solid #334155; }
  td { padding: 6px 10px; text-align: center; border: 1px solid #334155; }
  tr:hover { background: #1e293b88; }
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  .card { background: #1e293b; border-radius: 8px; padding: 16px; }
  .card h3 { color: #38bdf8; margin: 0 0 8px; }
  .dim { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #334155; }
  .dim-label { color: #94a3b8; }
  .dim-val { font-weight: bold; }
  .winner-ts { color: #4caf50; }
  .winner-py { color: #2196f3; }
</style>
</head>
<body>
<h1>Agent Multi-Dimensional Comparison Report</h1>
<p>Generated: ${new Date().toISOString()}</p>

<div class="summary">
  <div class="card">
    <h3>TS Agent (ReAct)</h3>
    <div class="dim"><span class="dim-label">Avg TTFT</span><span class="dim-val">${avgScore(tsResults, 'ttftMs')}s</span></div>
    <div class="dim"><span class="dim-label">Avg Total</span><span class="dim-val">${avgScore(tsResults, 'totalTimeMs')}s</span></div>
    <div class="dim"><span class="dim-label">Avg Accuracy</span><span class="dim-val">${avgScore(tsResults, 'accuracyScore')}</span></div>
    <div class="dim"><span class="dim-label">Avg UX</span><span class="dim-val">${avgScore(tsResults, 'uxScore')}</span></div>
    <div class="dim"><span class="dim-label">Charts</span><span class="dim-val">${tsResults.filter(r => r.hasChart).length}/${tsResults.length}</span></div>
    <div class="dim"><span class="dim-label">Errors</span><span class="dim-val">${tsResults.filter(r => r.error).length}</span></div>
  </div>
  <div class="card">
    <h3>Python Agent (Pydantic AI)</h3>
    <div class="dim"><span class="dim-label">Avg TTFT</span><span class="dim-val">${avgScore(pyResults, 'ttftMs')}s</span></div>
    <div class="dim"><span class="dim-label">Avg Total</span><span class="dim-val">${avgScore(pyResults, 'totalTimeMs')}s</span></div>
    <div class="dim"><span class="dim-label">Avg Accuracy</span><span class="dim-val">${avgScore(pyResults, 'accuracyScore')}</span></div>
    <div class="dim"><span class="dim-label">Avg UX</span><span class="dim-val">${avgScore(pyResults, 'uxScore')}</span></div>
    <div class="dim"><span class="dim-label">Charts</span><span class="dim-val">${pyResults.filter(r => r.hasChart).length}/${pyResults.length}</span></div>
    <div class="dim"><span class="dim-label">Errors</span><span class="dim-val">${pyResults.filter(r => r.error).length}</span></div>
  </div>
</div>

<h2>Detailed Scorecard</h2>
<table>
  <tr>
    <th>Q#</th><th>Agent</th><th>Cat</th><th>Question</th>
    <th>TTFT</th><th>Total</th>
    <th>Accuracy</th><th>Robust</th><th>UX</th>
    <th>Steps</th><th>Chart</th><th>Output</th><th>Response</th>
  </tr>
  ${rows}
</table>

<h2>Multi-turn Context (D6)</h2>
<table>
  <tr><th>Agent</th><th>Context</th><th>Turns Detail</th></tr>
  ${multiTurnRows}
</table>

</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════

test.describe('Agent Multi-Dimensional Comparison', () => {

  // ── Single-turn: TS Agent ────────────────────────────
  for (const tc of TEST_CASES) {
    test(`TS Agent Q${tc.id}: ${tc.text || '(empty)'} [${tc.type}]`, async ({ page }) => {
      test.setTimeout(TIMEOUT);
      const result = await runFullTestCase(page, tc, 'ts');
      allResults.push(result);

      const agentLabel = 'TS';
      console.log(`\n[${agentLabel}] Q${tc.id} (${tc.type}): ${tc.text}`);
      console.log(`  Time: ${(result.totalTimeMs / 1000).toFixed(1)}s | TTFT: ${(result.ttftMs / 1000).toFixed(1)}s`);
      console.log(`  Accuracy: ${result.accuracyScore} | Robust: ${result.robustnessScore} | UX: ${result.uxScore}`);
      console.log(`  Chart: ${result.chartType} | Steps: ${result.stepCount}`);
      if (result.error) console.log(`  ERROR: ${result.error}`);

      // Basic assertion: should respond (unless edge case)
      if (!tc.isEdgeCase) {
        expect(result.noCrash || result.responseText.length > 0).toBeTruthy();
      }
    });
  }

  // ── Single-turn: Python Agent ────────────────────────
  for (const tc of TEST_CASES) {
    test(`Python Agent Q${tc.id}: ${tc.text || '(empty)'} [${tc.type}]`, async ({ page }) => {
      test.setTimeout(TIMEOUT);
      const result = await runFullTestCase(page, tc, 'python');
      allResults.push(result);

      const agentLabel = 'PY';
      console.log(`\n[${agentLabel}] Q${tc.id} (${tc.type}): ${tc.text}`);
      console.log(`  Time: ${(result.totalTimeMs / 1000).toFixed(1)}s | TTFT: ${(result.ttftMs / 1000).toFixed(1)}s`);
      console.log(`  Accuracy: ${result.accuracyScore} | Robust: ${result.robustnessScore} | UX: ${result.uxScore}`);
      console.log(`  Chart: ${result.chartType} | Steps: ${result.stepCount}`);
      if (result.error) console.log(`  ERROR: ${result.error}`);

      if (!tc.isEdgeCase) {
        expect(result.noCrash || result.responseText.length > 0).toBeTruthy();
      }
    });
  }

  // ── D6: Multi-turn ───────────────────────────────────
  const MULTI_TURN_INPUTS = [
    '各部门成交数',
    '那7月的呢',
    '和8月对比',
  ];

  for (const agent of ['ts', 'python'] as Agent[]) {
    test(`${agent.toUpperCase()} Agent Multi-turn (3 rounds)`, async ({ page }) => {
      test.setTimeout(TIMEOUT * 2);
      const agentLabel = agent === 'ts' ? 'ts' : 'python';
      const screenshotPath = `${ARTIFACTS_DIR}/multidim-multiturn-${agentLabel}.png`;

      await navigateTo(page, agent);
      const turns: MultiTurnResult['turns'] = [];
      const contextPreserved: boolean[] = [];

      for (let i = 0; i < MULTI_TURN_INPUTS.length; i++) {
        const input = MULTI_TURN_INPUTS[i];
        const start = Date.now();

        await submitQuery(page, input);

        try {
          await waitForPipelineAndRender(page, 120_000);
          await waitForChartCanvas(page);
        } catch {
          // Continue even on failure
        }

        const elapsed = Date.now() - start;
        const text = await getAssistantText(page);
        const chart = await hasRenderedChart(page);
        const table = await hasDataTable(page);

        turns.push({ input, responseText: text, hasChart: chart, hasTable: table, timeMs: elapsed });

        // Check context preservation for turn 2+
        if (i > 0) {
          // Turn 2 "那7月的呢" should reference 7月 in context of department deals
          // Turn 3 "和8月对比" should reference 8月 in context of 7月
          const contextKeywords = i === 1 ? ['7月'] : ['8月', '对比'];
          const preserved = contextKeywords.some(kw => text.includes(kw));
          contextPreserved.push(preserved);
        }
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });

      const mtResult: MultiTurnResult = { agent, turns, contextPreserved, screenshotPath };
      multiTurnResults.push(mtResult);

      console.log(`\n[${agent.toUpperCase()}] Multi-turn:`);
      turns.forEach((t, i) => {
        console.log(`  Turn ${i + 1}: "${t.input}" → ${(t.timeMs / 1000).toFixed(1)}s, chart=${t.hasChart}, table=${t.hasTable}`);
      });
      console.log(`  Context preserved: ${contextPreserved.every(v => v) ? 'YES' : 'PARTIAL'} ${contextPreserved}`);
    });
  }

  // ── Generate HTML Report ─────────────────────────────
  test.afterAll(async () => {
    const html = generateHTMLReport(allResults, multiTurnResults);

    // Write HTML report
    const fs = await import('fs');
    const path = await import('path');
    const reportPath = path.join(ARTIFACTS_DIR, 'multidim-report.html');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, html, 'utf-8');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`HTML Report: ${reportPath}`);
    console.log(`Total tests: ${allResults.length + multiTurnResults.length}`);

    // Print JSON summary
    const summary = {
      ts: allResults.filter(r => r.agent === 'ts').map(r => ({
        q: r.questionId, cat: r.category,
        total: r.totalTimeMs, ttft: r.ttftMs,
        acc: r.accuracyScore, robust: r.robustnessScore, ux: r.uxScore,
        chart: r.chartType, err: r.error ? true : false,
      })),
      python: allResults.filter(r => r.agent === 'python').map(r => ({
        q: r.questionId, cat: r.category,
        total: r.totalTimeMs, ttft: r.ttftMs,
        acc: r.accuracyScore, robust: r.robustnessScore, ux: r.uxScore,
        chart: r.chartType, err: r.error ? true : false,
      })),
      multiTurn: multiTurnResults.map(r => ({
        agent: r.agent, contextPreserved: r.contextPreserved,
      })),
    };
    console.log('\nJSON Summary:');
    console.log(JSON.stringify(summary, null, 2));
    console.log('='.repeat(60));
  });

});
