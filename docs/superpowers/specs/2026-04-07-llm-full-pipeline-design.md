# ChatBI 全链路 LLM 化改造 — 设计与实施方案

> 日期: 2026-04-07
> 状态: 待审批
> 范围: RouterAgent / QueryAgent / AnalysisAgent / MessageHandler

---

## 1. 现状问题

| Agent | LLM 使用 | 核心缺陷 |
|-------|----------|---------|
| RouterAgent | 关键词优先，LLM fallback | 关键词命中率低，大部分查询走不到 LLM |
| QueryAgent | **零 LLM**，纯正则 | 无法理解复杂自然语言（"上个月表现最好的是谁"） |
| AnalysisAgent | generateText + 手动 JSON.parse | 结构不稳定，LLM 返回格式不可控 |
| MessageHandler | 硬编码 if/else | query 场景 uiSchema.type 永远是 table，无智能推荐 |

**用户体感**：问不同问题得到相同答案、右侧图表不智能、回答像机器模板。

---

## 2. 目标架构

```
用户输入
  │
  ▼
┌─────────────┐
│ Greeting    │──── 命中 → 直接返回欢迎语（保留，不走 LLM）
│ Fast-path   │
└─────┬───────┘
      │ 未命中
      ▼
┌─────────────┐     LLM 调用 1
│ RouterAgent │────────────────→ 智谱 GLM-4-Flash
│ (纯 LLM)    │←──────────────── intent + agents + params
└─────┬───────┘
      │
      ▼
┌─────────────┐     LLM 调用 2
│ QueryAgent  │────────────────→ 智谱 GLM-4-Flash
│ (LLM 理解)  │←──────────────── 结构化查询参数
└─────┬───────┘
      │ params → searchSales() (确定性 SQL，保留不动)
      │
      ▼
┌─────────────┐     LLM 调用 3 (analysis 场景)
│ AnalysisAgent│───────────────→ 智谱 GLM-4-Flash
│ (generateObj)│←──────────────── {summary, insights, chartType}
└─────┬───────┘
      │
      ▼
┌─────────────┐     LLM 调用 4
│ ResponseGen │────────────────→ 智谱 GLM-4-Flash
│ (新增)       │←──────────────── 自然语言回复文本
└─────┬───────┘
      │
      ▼
  { text, uiSchema, agentTrace } → SSE → 前端 (不变)
```

**关键决策**：
- `searchSales()` SQL 查询层保留 — LLM 负责"理解意图"，SQL 负责"精确取数"
- 前端 `render-area.tsx` 零改动 — UISchema 接口不变
- 智谱通过 OpenAI 兼容协议接入 — 只改环境变量

---

## 3. 各组件详细设计

### 3.1 RouterAgent — 去掉关键词层

**文件**: `src/lib/agents/router-agent.ts`

**改动**:
- 删除 `import { matchByKeywords }` 和整个 Layer 1 关键词分支
- 保留 LLM `generateObject` 调用，优化 prompt

**新 prompt 设计**:
```
你是一个销售业绩 BI 系统的意图分类器。

数据域: 在线教育销售团队，字段包括姓名、部门、月份、加微/互动/需求/成交四个指标（7-10月）。

将用户消息分类为:
- "query": 查找/搜索/展示具体数据（"武莹的业绩""花园桥校区9月数据"）
- "analysis": 分析/对比/趋势/排行/统计（"分析各部门成交""谁表现最好""环比变化"）
- "generation": 生成/创建内容（"帮我写跟进话术"）

返回:
- intent: 意图类型
- confidence: 0-1 置信度
- agents: 需要调用的 agent 列表
  - query → ["query"]
  - analysis → ["query", "analysis"]
  - generation → ["query", "generator"]
- params: 提取的参数（如人名、部门、月份等）

用户消息: "{message}"
```

**Zod schema 保持不变**（已有 `routerOutputSchema`）。

---

### 3.2 QueryAgent — LLM 参数提取（核心改造）

**文件**: `src/lib/agents/query-agent.ts`

**改动**:
- 新增 LLM 调用，用 `generateObject` 提取查询参数
- 删除对 `queries-sales.ts` 中 `extractQueryParams()` 的依赖（该函数保留但不再主流程使用）
- `searchSales()` 函数保留不动

**新增 schema**:
```typescript
const queryUnderstandingSchema = z.object({
  name: z.string().nullable().describe('提到的人名，如"武莹""李明"'),
  department: z.string().nullable().describe('提到的部门/校区，如"花园桥校区"'),
  month: z.string().nullable().describe('提到的月份，标准化为"7月"-"10月"格式'),
  metric: z.enum(['wechat_added', 'interaction', 'demand', 'deal']).nullable()
    .describe('关注的指标'),
  metricMinValue: z.number().nullable()
    .describe('指标最小值，如"有没有成交"→ deal >= 1'),
  isRanking: z.boolean().describe('是否在问排行榜/排名'),
  isSummary: z.boolean().describe('是否在问汇总/概览/各部门'),
});
```

**新 prompt 设计**:
```
你是一个数据库查询参数提取器。

数据库表 sales_performance 的字段:
- name: 销售人员姓名
- department: 部门/校区名称
- month: 月份（值为"7月""8月""9月""10月"）
- wechat_added: 加微信数量
- interaction: 企微互动次数
- demand: 有需求数量
- deal: 成交数量

从用户问题中提取查询参数。注意:
1. 人名要精确匹配（如"武莹"不是"武"）
2. 月份要标准化（"九月"→"9月"，"上个月"→ 无法确定则为 null）
3. "有没有成交"类问题 → metric="deal", metricMinValue=1
4. "排行榜""排名""谁最好" → isRanking=true
5. "汇总""各部门""概览" → isSummary=true
6. 如果问题中没有提到某个字段，设为 null

用户问题: "{query}"
```

**改造后的 run 方法**:
```typescript
protected async run(input: QueryInput): Promise<QueryOutput> {
  if (input.searchType === 'sales') {
    // LLM 提取参数（替代 extractQueryParams 正则）
    const { object: params } = await generateObject({
      model: getDefaultModel(),
      schema: queryUnderstandingSchema,
      prompt: QUERY_UNDERSTANDING_PROMPT.replace('{query}', input.query),
    });

    // 用提取的参数查询（searchSales 逻辑保留）
    const records = searchSalesByParams(params);
    return {
      records: records.map(r => ({ ...r })),
      totalCount: records.length,
      query: input.query,
      searchType: 'sales',
      confidence: records.length > 0 ? Math.min(0.6 + records.length * 0.02, 0.95) : 0,
    };
  }
  // ... legacy SOP search 保持不变
}
```

**新增 `searchSalesByParams`**（在 `queries-sales.ts` 中）:
```typescript
// 接收 LLM 提取的结构化参数，替代 extractQueryParams
export function searchSalesByParams(params: {
  name?: string | null;
  department?: string | null;
  month?: string | null;
  metric?: string | null;
  metricMinValue?: number | null;
  isRanking?: boolean;
  isSummary?: boolean;
}): SalesRecord[] {
  // 复用现有 searchSales 的 WHERE 拼接逻辑
  // 只是参数来源从正则变成 LLM
}
```

---

### 3.3 AnalysisAgent — generateObject 替代 generateText

**文件**: `src/lib/agents/analysis-agent.ts`

**改动**:
- `generateText` → `generateObject` + Zod schema
- 删除手动 `JSON.parse` 和 markdown 代码块剥离逻辑
- 删除 `parsed.xxx || defaultValue` 防御代码（Zod 验证已兜底）

**改造后的 run 方法**:
```typescript
protected async run(input: AnalysisInput): Promise<AnalysisOutput> {
  // ... 构建 recordsSummary、departments 等上下文（保留）

  const { object } = await generateObject({
    model: getDefaultModel(),
    schema: analysisOutputSchema,  // 已有的 Zod schema
    prompt: `你是在线教育公司的销售数据分析专家...`,  // 优化后的 prompt
  });

  return object;  // Zod 已验证，直接返回
}
```

**收益**: 消除 JSON 解析失败的风险，结构化输出 100% 符合 schema。

---

### 3.4 ResponseGenerator — 新增组件

**文件**: `src/lib/agents/response-generator.ts`（新建）

**职责**: 将查询结果转换为自然语言回复（替代 `formatQueryResults` / `formatAnalysisWithInsights` 模板函数）

**Schema**:
```typescript
const responseOutputSchema = z.object({
  text: z.string().describe('给用户的自然语言回复，中文'),
  uiType: z.enum(['table', 'bar', 'pie', 'line', 'radar']).describe('推荐的图表类型'),
});
```

**Prompt 设计**:
```
你是一个销售数据助手，用简洁自然的语言向用户汇报数据查询结果。

规则:
1. 直接回答用户的问题，不要说"为您找到N条结果"这种机器话
2. 数据多时只列出关键数据，其余概括说明
3. 推荐最适合的图表类型展示数据
4. 用中文回复

用户问题: "{query}"
数据记录: {records 的 JSON 摘要}
```

---

### 3.5 MessageHandler — 编排层调整

**文件**: `src/lib/chat/message-handler.ts`

**改动**:
- 引入 ResponseGenerator
- 替换 `formatQueryResults` → ResponseGenerator 生成
- 替换 `buildBasicTableSchema` → LLM 推荐图表类型
- 分析流程的 `formatAnalysisWithInsights` 也替换

**改造后的核心流程**:
```typescript
// Step 1: Route (纯 LLM)
const route = await routerAgent.execute({ message: userMessage });

// Step 2: Query (LLM 理解 + SQL 查询)
const queryResult = await queryAgent.execute({ query: userMessage, searchType: 'sales' });

if (queryResult.records.length > 0) {
  if (route.agents.includes('analysis')) {
    // Step 3a: Analysis (generateObject)
    const analysisResult = await analysisAgent.execute({ ... });
    // Step 4a: Response (LLM 生成回复)
    const response = await responseGenerator.execute({
      query: userMessage,
      records: queryResult.records,
      analysis: analysisResult,
    });
    return {
      text: response.text,
      uiSchema: buildUISchema(queryResult.records, analysisResult, response.uiType),
      agentTrace: trace,
    };
  }

  // Step 3b: Query-only → Response (LLM 生成回复)
  const response = await responseGenerator.execute({
    query: userMessage,
    records: queryResult.records,
  });
  return {
    text: response.text,
    uiSchema: buildUISchema(queryResult.records, undefined, response.uiType),
    agentTrace: trace,
  };
}
```

**`buildUISchema` 统一构建函数**:
```typescript
function buildUISchema(
  records: Record<string, unknown>[],
  analysis?: AnalysisOutput,
  chartType?: string,
): unknown {
  return {
    type: chartType || (analysis?.suggestedChartType ?? 'table'),
    data: {
      rows: records.slice(0, 20),
      departments: groupByDepartment(records),
      totalCount: records.length,
    },
    title: /* from query or analysis */,
    summary: analysis?.summary,
    insights: analysis?.insights,
  };
}
```

---

## 4. 实施分阶段

### Phase 1: Query 理解 LLM 化（最大收益，优先做）

**目标**: QueryAgent 用 LLM 提取参数，替代正则

| 步骤 | 文件 | 改动 |
|------|------|------|
| 1.1 | `queries-sales.ts` | 新增 `searchSalesByParams()` 函数 |
| 1.2 | `query-agent.ts` | 引入 `generateObject` + `queryUnderstandingSchema` |
| 1.3 | `query-agent.ts` | 删除 `searchSales(input.query)` 调用，改用 LLM 参数 |
| 1.4 | 测试 | 更新 `message-handler.test.ts` 验证新流程 |

**验证标准**:
- "上个月表现最好的是谁" → LLM 正确提取 isRanking=true, metric=deal
- "花园桥校区9月有没有成交" → department=花园桥校区, month=9月, metric=deal, metricMinValue=1
- "武莹的销售数据" → name=武莹
- 正则无法理解的复杂问法 → LLM 能处理

### Phase 2: Analysis Agent 结构化输出

**目标**: 消除 JSON 解析失败

| 步骤 | 文件 | 改动 |
|------|------|------|
| 2.1 | `analysis-agent.ts` | `generateText` → `generateObject` |
| 2.2 | `analysis-agent.ts` | 删除 JSON.parse 和代码块剥离逻辑 |

**验证标准**:
- 连续 20 次调用无 JSON 解析错误
- Zod 验证通过率 100%

### Phase 3: Router 纯 LLM 化

**目标**: 去掉关键词层

| 步骤 | 文件 | 改动 |
|------|------|------|
| 3.1 | `router-agent.ts` | 删除 `matchByKeywords` 调用 |
| 3.2 | `router-agent.ts` | 优化 prompt，增加少样本示例 |
| 3.3 | `router-rules.ts` | 可保留但不被主流程调用 |

**验证标准**:
- "帮我看看这个月谁最强" → analysis 意图（不是 query）
- "武莹" → query 意图
- "生成一份跟进话术" → generation 意图

### Phase 4: ResponseGenerator + MessageHandler 整合

**目标**: 自然语言回复替代模板

| 步骤 | 文件 | 改动 |
|------|------|------|
| 4.1 | `response-generator.ts` | 新建 agent |
| 4.2 | `message-handler.ts` | 引入 ResponseGenerator，替换模板函数 |
| 4.3 | `message-handler.ts` | 统一 `buildUISchema` |

**验证标准**:
- 回复不再是"为您找到N条结果"机器话
- 图表类型由 LLM 推荐（query 场景也可能出 bar/pie）

---

## 5. 不改动的部分

| 组件 | 原因 |
|------|------|
| `searchSales()` SQL 查询逻辑 | 确定性取数，不需要 LLM |
| `render-area.tsx` | UISchema 接口不变 |
| `use-chat.ts` | SSE 解析不变 |
| `page.tsx` | 前端布局不变 |
| `chat/route.ts` | SSE 流式接口不变 |
| `provider.ts` | 已支持 OpenAI 兼容，只改环境变量 |
| 数据库 schema | 表结构不变 |

---

## 6. 环境变量配置

切换到智谱模型只需设置：

```env
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_API_KEY=<智谱 API Key>
LLM_MODEL=glm-4-flash
```

推荐模型选择：

| 模型 | 适用场景 | 价格 |
|------|---------|------|
| glm-4-flash | Router / Query 理解（高频低复杂度） | ¥0.1/百万token |
| glm-4-air | Analysis / Response（需要更强推理） | ¥0.5/百万token |
| glm-4-plus | 复杂分析（可选升级） | ¥5/百万token |

建议先用 `glm-4-flash` 全链路，验证通过后再按环节选模型。

---

## 7. 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| LLM 延迟叠加（4 次调用） | 高 | Router 和 Query 理解可并行调用；缓存常见查询 |
| LLM 参数提取不准 | 中 | 保留 `searchSales()` 的 fallback LIKE 查询兜底 |
| 智谱 API 不可用 | 低 | 保留 keyword fallback 作为降级路径 |
| Token 成本超预期 | 低 | glm-4-flash 极便宜，单次查询 < ¥0.001 |

---

## 8. 改动量汇总

| 类别 | 数字 |
|------|------|
| 改动文件 | 5 个 |
| 新建文件 | 1 个（`response-generator.ts`） |
| 新增代码 | ~250 行（prompt + schema） |
| 删除代码 | ~200 行（正则映射、JSON 解析、模板函数） |
| 净增代码 | ~50 行 |
| 前端改动 | 0 |
| 数据库改动 | 0 |
