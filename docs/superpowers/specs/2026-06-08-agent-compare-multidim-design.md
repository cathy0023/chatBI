# Agent Multi-Dimensional Comparison Test Design

> Date: 2026-06-08
> Status: Draft

## Background

Existing E2E comparison tests (`agent-compare.spec.ts`, `agent-compare-5q.spec.ts`) only cover a single dimension: basic response existence + screenshot. This design defines a comprehensive multi-dimensional comparison between the **TS Agent** (default ReAct pipeline) and **Python Agent** (Pydantic AI pipeline via `?agent=pydantic`).

## Scope

### Agents Under Test

| Agent | URL | Pipeline |
|---|---|---|
| TS Agent (default) | `/` | `react-gateway.ts` → `react-executor.ts` → tools (query/analysis/chart) |
| Python Agent | `/?agent=pydantic` | Next.js proxy → Python Pydantic AI service |

### Dimensions (6)

#### D1: Performance Latency

| Metric | Collection Method |
|---|---|
| TTFT (time to first SSE event) | Intercept SSE stream, record `onmessage` first event timestamp |
| Pipeline total time | `data-phase="done"` timestamp minus input Enter timestamp |
| SQL execution time | Parse SSE `step` events with `tool_call` type for `query` tool, extract duration |
| Chart render time | From `step` event (chart tool call) to canvas `toDataURL().length > 10000` |

**Scoring**: Lower is better. Score = percentile rank across all test cases.

#### D2: Data Accuracy (SQL + Values)

Ground truth pre-computed from `chatbi.db`:

```typescript
const GROUND_TRUTH: Record<string, { sqlPattern: RegExp; expectedValues: Record<string, number> }> = {
  '各部门成交数': {
    sqlPattern: /GROUP BY department/i,
    expectedValues: {
      '学习机-中关村校区': 32, '学习机-大兴校区': 15, '学习机-望京校区': 24,
      '学习机-朝阳校区': 43, '学习机-海淀校区': 47, '学习机-花园桥校区': 14,
      '学习机-西城校区': 19, '学习机-通州校区': 17,
    },
  },
  // ... more entries
};
```

**Validation**:
1. Response text must contain expected numeric values (fuzzy match ±1 for rounding)
2. If table rendered, parse table rows and cross-check
3. SQL pattern match (GROUP BY, WHERE, JOIN correctness)

**Scoring**: % of expected values found correctly.

#### D3: Robustness (Edge Cases)

5 boundary test cases:
| # | Input | Expected Behavior |
|---|---|---|
| 1 | Empty input (Enter with no text) | Graceful rejection or clarification prompt |
| 2 | Non-existent person: "张三的业绩" | Should respond "no data found" or similar, not crash |
| 3 | Ambiguous: "表现怎么样" | Should ask for clarification or make reasonable assumption |
| 4 | SQL injection: "'; DROP TABLE sales_performance; --" | Must NOT execute raw SQL, should return safe response |
| 5 | Very long input (500+ chars of repeated text) | Should handle without timeout or crash |

**Scoring**: Pass/fail per case. No crash = 1 point, graceful handling = 2 points.

#### D4: UX Quality (Response + Chart)

| Metric | Method |
|---|---|
| Response text length | `textContent().length` — too short (<50) or too long (>2000) penalized |
| Chart type appropriateness | Bar/line for time series, pie/bar for category comparison — check ECharts `series[0].type` |
| Insight depth | Check if response contains comparative language ("最", "相比", "增长", "下降") |

**Scoring**: 0-2 per metric, summed.

#### D5: Streaming Experience (SSE Progress)

| Metric | Method |
|---|---|
| Step event count | Count `data-phase` transitions and SSE `step` events |
| Time between steps | Max gap between consecutive step events |
| Progress indicator presence | Check if `data-phase` attribute updates progressively |

**Scoring**: More steps with smaller gaps = better (indicates smooth streaming).

#### D6: Multi-turn Context

3-turn conversation per agent:
| Turn | Input | Validates |
|---|---|---|
| 1 | "各部门成交数" | Basic query |
| 2 | "那7月的呢" | Contextual follow-up (should filter to 7月) |
| 3 | "和8月对比" | Comparative follow-up (should compare 7月 vs 8月) |

**Scoring**: Turn 2 and 3 must reference context from previous turns. Keyword check for context preservation.

### Test Questions (12 total)

#### Category A: Basic Queries (5 — reused from existing)

| # | Question | Type | GT Available |
|---|---|---|---|
| 1 | 各部门成交数 | Department aggregation | Yes |
| 2 | 7月和8月的加微数对比 | Time comparison | Yes |
| 3 | 张红的业绩怎么样 | Person lookup | Yes |
| 4 | 各月成交趋势 | Trend analysis | Yes |
| 5 | 哪个部门表现最好 | Ranking/judgment | Yes |

#### Category B: Complex Queries (4 — new)

| # | Question | Type | GT Available |
|---|---|---|---|
| 6 | 每个部门人均成交数是多少 | Derived metric (AVG) | Yes |
| 7 | 9月加微数最高的3个人 | Top-N + filter | Yes |
| 8 | 对比张红和李明的各项指标 | Multi-metric comparison | Yes |
| 9 | 哪个月份的转化率最高 | Derived metric (deal/wechat_added) | Yes |

#### Category C: Edge Cases (3 — new)

| # | Question | Type | GT Available |
|---|---|---|---|
| 10 | (empty input) | Empty input | N/A |
| 11 | 张三的业绩怎么样 | Non-existent person | N/A |
| 12 | ' OR 1=1; DROP TABLE users;-- | SQL injection | N/A |

### Ground Truth Reference

Pre-computed from `chatbi.db`:

```
Department deal totals: 中关村32, 大兴15, 望京24, 朝阳43, 海淀47, 花园桥14, 西城19, 通州17
Monthly wechat: 10月710, 7月564, 8月652, 9月751
Monthly deal: 10月61, 7月47, 8月44, 9月59
张红 total deals: 6
Top by deal: 杨洋19, 王刚16, 郑敏16, 吴涛14, 韩超12
```

## Test Architecture

### File Structure

```
tests/e2e/
  agent-compare-multidim.spec.ts   ← Single spec file (main)
  artifacts/
    multidim-report.html           ← Generated HTML report
    multidim-{N}-{agent}.png       ← Screenshots per test case
```

### Spec Structure

```
describe('Agent Multi-Dimensional Comparison')
  ├── describe('D1-D5: Single-turn queries (12 × 2 agents)')
  │   ├── test('TS Q1: 各部门成交数') → runFullTestCase(page, Q1, 'ts')
  │   ├── test('Python Q1: 各部门成交数') → runFullTestCase(page, Q1, 'python')
  │   └── ... (24 tests total)
  ├── describe('D6: Multi-turn conversation (2 agents)')
  │   ├── test('TS Multi-turn') → runMultiTurnTest(page, 'ts')
  │   └── test('Python Multi-turn') → runMultiTurnTest(page, 'python')
  └── afterAll → generateHTMLReport(allResults)
```

### Result Data Structure

```typescript
interface MultidimResult {
  questionId: number;
  agent: 'ts' | 'python';
  // D1: Performance
  ttftMs: number;
  totalTimeMs: number;
  sqlTimeMs: number | null;
  chartRenderMs: number | null;
  // D2: Accuracy
  accuracyScore: number; // 0-1
  expectedValuesFound: number;
  expectedValuesTotal: number;
  // D3: Robustness
  robustnessScore: number; // 0-2
  errorHandled: boolean;
  gracefulResponse: boolean;
  // D4: UX Quality
  responseLength: number;
  chartType: string;
  chartAppropriate: boolean;
  hasInsight: boolean;
  uxScore: number; // 0-6
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
```

### HTML Report

Static HTML with embedded CSS, generated in `afterAll`:
- **Scorecard table**: rows = questions, columns = dimensions, cells = scores with color coding (green/yellow/red)
- **Summary row**: average scores per agent per dimension
- **Winner column**: which agent wins per question/dimension
- **Screenshots**: expandable thumbnails

### Agent Team Execution

After code is written, use agent team to parallelize test execution:
1. **Agent 1 (TS tester)**: Runs all TS agent test cases via `npx playwright test --grep "TS Agent"`
2. **Agent 2 (Python tester)**: Runs all Python agent test cases via `npx playwright test --grep "Python Agent"`
3. **Agent 3 (Reporter)**: Collects results, generates HTML report, presents comparison summary

## Success Criteria

1. All 26 test cases (12×2 + 2 multi-turn) complete without framework errors
2. HTML report generated with color-coded scorecard
3. At least 3 dimensions show measurable differences between agents
4. Ground truth validation catches at least 1 data accuracy issue (if any)
5. Edge cases properly handled (no crashes)
