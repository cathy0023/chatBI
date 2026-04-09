# ChatBI Agent 架构完全指南（学习者笔记）

> 写给后端/算法小白：用大白话 + 代码示例，从零理解这个系统是怎么把一句中文问题变成一张图表的。

---

## 一、这个系统是干什么的？

想象你是一个教育公司的销售主管。你手下有 4 个校区、几十个销售员，每个人每月有 4 个指标（加微信数、互动数、需求数、成交数），数据跨 7-10 月。

以前你查数据要：打开 Excel → 筛选 → 排序 → 画图。

现在你只需要打字：

```
你: 花园桥校区10月的成交情况
系统: 花园桥校区10月共成交 X 单，其中 TOP3 是...
      [右侧弹出一张柱状图]
```

**ChatBI 做的事就是：中文问题 → SQL 查询 → 统计分析 → 自然语言回复 + 可视化图表**

这不是一个简单的关键词搜索。系统里有一组 **Agent（智能代理）**，每个负责一个环节，像一个接力赛团队。

---

## 二、从 50,000 英尺看架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                          用户浏览器                                   │
│                                                                      │
│   ┌─────────────────┐        SSE 事件流          ┌────────────────┐ │
│   │  左侧：聊天面板   │ ◄──────────────────────── │  /api/chat     │ │
│   │  (发消息/看回复)  │                           │  (Next.js API) │ │
│   └─────────────────┘                            └───────┬────────┘ │
│                                                           │          │
│   ┌─────────────────┐                                     │          │
│   │  右侧：图表面板   │ ◄── uiSchema（图表数据）           │          │
│   │  (ECharts 图表)  │                                    │          │
│   └─────────────────┘                                     │          │
└──────────────────────────────────────────────────────────────────┼──┘
                                                               │
                                                    handleMessage()
                                                               │
                    ┌──────────────────────────────────────────┐
                    │            Agent Pipeline                 │
                    │                                          │
                    │  Step 1: RouterAgent                     │
                    │     "这句话是什么意图？"                   │
                    │          │                               │
                    │  Step 2: QueryAgent                      │
                    │     "去数据库里查什么数据？"                │
                    │          │                               │
                    │  Step 3: AnalysisAgent (可选)             │
                    │     "数据分析出什么结论？"                  │
                    │          │                               │
                    │  Step 4: ResponseGenerator                │
                    │     "用人话告诉用户结果"                   │
                    │          │                               │
                    │  Step 5: buildUISchema()                  │
                    │     "右侧图表应该怎么画？"                 │
                    │                                          │
                    └──────────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
               ┌────┴────┐          ┌─────┴─────┐
               │ SQLite  │          │   LLM     │
               │ (数据层) │          │ (大模型)   │
               └─────────┘          └───────────┘
```

### 几个关键概念（小白友好版）

| 概念 | 通俗解释 | 本项目中的对应 |
|------|---------|---------------|
| **Agent** | 一个专门做某件事的"工人" | RouterAgent、QueryAgent 等 |
| **Pipeline** | 工人们排成一条流水线 | handleMessage() 函数 |
| **LLM** | 大语言模型（如 GPT） | 用于理解中文、生成回复 |
| **SSE** | 服务器向浏览器推送数据的方式 | /api/chat 返回的事件流 |
| **Schema** | 数据的"形状描述" | Zod 定义的输入输出格式 |

---

## 三、跟着一个真实例子走一遍

用户输入：**"分析各部门10月成交情况"**

### Step 0: 前端发请求

```typescript
// src/lib/chat/use-chat.ts
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: '分析各部门10月成交情况', sessionId: 'xxx' }),
});
```

前端通过 `fetch` 把用户消息发到 `/api/chat`。注意这里没有用 WebSocket，而是用 **SSE（Server-Sent Events）**——服务器处理完后，通过事件流把结果一段段推回来。

### Step 1: API 路由接收请求

```typescript
// src/app/api/chat/route.ts (简化版)
export async function POST(request) {
  const { message, sessionId } = await request.json();

  // 1. 保存用户消息到数据库
  persistMessage(sessionId, 'user', message);

  // 2. 调用核心处理函数
  const result = await handleMessage(message, sessionId);

  // 3. 通过 SSE 把结果推给前端
  send('text', { text: result.text });       // 文字回复
  send('uiSchema', { uiSchema: result.uiSchema }); // 图表数据
  send('done', {});
}
```

**要点**：
- 这是一个 Next.js 的 **API Route**（`app/api/chat/route.ts`）
- 它只负责接收请求、调用核心逻辑、返回结果
- **真正的智能逻辑在 `handleMessage()` 里**

### Step 2: RouterAgent —— "这句话想干什么？"

```typescript
// src/lib/chat/message-handler.ts (Step 1)
const route = await routerAgent.execute({ message: '分析各部门10月成交情况' });
// 返回: { intent: 'analysis', agents: ['query', 'analysis'], confidence: 0.9 }
```

**RouterAgent 的工作**：把用户消息发给 LLM，让 LLM 判断意图。

它用的 prompt 长这样：

```
你是一个销售业绩 BI 系统的意图分类器。

将用户消息分类为:
- "query": 查找/搜索/展示具体数据
- "analysis": 分析/对比/趋势/排行/统计
- "generation": 生成/创建内容
- "training": 培训/练习/考核

agent 列表规则:
- analysis → ["query", "analysis"]

用户消息: "分析各部门10月成交情况"
```

LLM 返回 JSON：
```json
{ "intent": "analysis", "confidence": 0.9, "agents": ["query", "analysis"] }
```

**为什么需要这一步？** 因为不同意图需要不同的处理流程：
- 简单查询（"武莹的数据"）→ 只需 QueryAgent
- 分析对比（"谁的表现最好"）→ 需要 QueryAgent + AnalysisAgent
- 生成内容（"帮我写话术"）→ 需要 QueryAgent + GeneratorAgent

### Step 3: QueryAgent —— "去数据库里查什么？"

这是最关键的一步。它需要把一句自然语言翻译成数据库查询。

#### 3.1 LLM 理解用户意图

```typescript
// src/lib/agents/query-agent.ts
const result = await generateText({
  model: getDefaultModel(),
  prompt: QUERY_UNDERSTANDING_PROMPT.replace('{query}', '分析各部门10月成交情况'),
});
```

它给 LLM 的 prompt 是：

```
你是一个数据库查询参数提取器。

数据库表 sales_performance 的字段:
- name: 销售人员姓名
- department: 部门/校区名称
- month: 月份（有效值"7月""8月""9月""10月"）
- deal: 成交数量
...

从用户问题中提取查询参数。
只返回 JSON。

用户问题: "分析各部门10月成交情况"
```

LLM 返回：
```json
{
  "name": null,
  "department": null,
  "month": "10月",
  "metric": "deal",
  "metricMinValue": null,
  "isRanking": false,
  "isSummary": true
}
```

> **关键设计**：QueryAgent 不是让 LLM 直接写 SQL（那样不安全），而是让 LLM 提取结构化参数（月份、指标、是否排名等），然后用代码安全地构建 SQL。

#### 3.2 根据参数查数据库

```typescript
// src/lib/db/queries-sales.ts
const records = searchSalesByParams(params);
```

`searchSalesByParams` 根据提取到的参数构建 SQL：

```sql
SELECT * FROM sales_performance
WHERE month = '10月'
ORDER BY month, department, name
```

返回几十条记录，每条长这样：
```
{ name: '张三', department: '花园桥校区', month: '10月', deal: 5, ... }
{ name: '李四', department: '中关村校区', month: '10月', deal: 3, ... }
...
```

#### 3.3 兜底机制：关键词提取

如果 LLM 返回的参数全是 null（比如 LLM 偶尔抽风），系统有一个纯代码的关键词提取兜底：

```typescript
// 如果 LLM 提取全为空，用正则兜底
if (!params.name && !params.department && ...) {
  const keywordParams = extractQueryParams(input.query);
  params = { ...keywordParams };
}
```

`extractQueryParams` 用硬编码的字典做匹配：

```typescript
const MONTH_MAP = { '十月': '10月', '10月份': '10月', '10月': '10月' };
const METRIC_MAP = { '成交': 'deal', '互动': 'interaction', '加微': 'wechat_added' };
```

> **设计思路**：LLM 是主力，关键词提取是保底。两层防线确保系统不会因为 LLM 偶尔失误而挂掉。

### Step 4: AnalysisAgent —— "数据告诉我什么？"

因为 Router 判断 `intent: 'analysis'`，所以启动分析。

```typescript
// src/lib/chat/message-handler.ts (Step 3)
if (route.agents.includes('analysis')) {
  analysisResult = await analysisAgent.execute({
    query: '分析各部门10月成交情况',
    records,  // Step 3 查出来的几十条数据
  });
}
```

AnalysisAgent 做两件事：

#### 4.1 纯代码计算全量统计

```typescript
private computeFullStats(records) {
  // 遍历所有记录，聚合计算：
  // - 按月份汇总（每月总成交、总互动...）
  // - 按部门汇总
  // - 按人员汇总
  // - 全局 TOP5 人员
  // - 各月 TOP5 人员（按月分组排名）
  return { totalDeal, months, departments, topPerformers, monthlyTopPerformers, ... };
}
```

> **为什么不直接让 LLM 算？** 因为 LLM 算数容易出错（幻觉问题）。纯代码算统计 100% 准确，然后把统计结果作为 prompt 的一部分喂给 LLM，让 LLM 只负责"理解数据+写洞察"。

#### 4.2 把统计喂给 LLM，让它写分析

```
你是在线教育公司的销售数据分析专家。

【总体概况】
- 数据总条数: 42
- 覆盖月份: 1个 (10月)
- 总成交: 37单

【按月份统计】
10月: 成交=37, 加微=45, 互动=120, 需求=50, 人数=42

【成交TOP5人员（全局）】
1. 白浩5: 5单
2. 朱江霞: 4单
...

请基于以上全量统计数据，生成分析摘要和关键洞察。
```

LLM 返回结构化结果（用 `generateObject` 确保输出格式正确）：

```json
{
  "summary": "10月整体成交37单，花园桥校区表现突出...",
  "insights": ["花园桥校区成交最高", "加微转化率约82%", ...],
  "suggestedChartType": "bar"
}
```

### Step 5: ResponseGenerator —— "用人话说给用户听"

```typescript
const response = await responseGenerator.execute({
  query: '分析各部门10月成交情况',
  records,
  analysis: { summary, insights, suggestedChartType: 'bar' },
});
```

ResponseGenerator 再次调用 LLM，但这次的目标是**生成用户友好的回复**：

```
你是销售数据助手，基于全量统计数据回答用户问题。

【全量统计结果】
- 总成交: 37单
- 覆盖部门: 4个
...

【成交TOP5人员（全局）】
...

【各月TOP5成交人员】
...

【分析摘要】
10月整体成交37单...

【关键洞察】
1. 花园桥校区成交最高
...

回答规则:
1. 直接回答问题，不要说"为您找到N条结果"
2. 用具体数据说话
3. 推荐图表类型: 多人对比→bar
4. 中文回复，简洁专业
```

LLM 返回：

```json
{
  "text": "10月共成交37单，涉及4个校区。花园桥校区以15单位居第一...",
  "uiType": "bar"
}
```

### Step 6: buildUISchema —— "图表应该怎么画？"

```typescript
// src/lib/chat/message-handler.ts
function buildUISchema(records, query, analysis, uiType) {
  // 1. 检测用户关心的维度（月份？部门？人员？）
  const dimension = detectChartDimension(query); // → 'department'

  // 2. 检测用户关心的指标（成交？互动？加微？）
  const metric = detectMetricFromQuery(query); // → 'deal'

  // 3. 聚合数据：按部门求和成交数
  const aggregation = aggregateBy(records, 'department', 'deal');
  // → { "花园桥校区": 15, "中关村校区": 8, ... }

  return {
    type: 'bar',
    data: {
      rows: [...],           // 原始数据（给表格用）
      chartData: aggregation, // 聚合数据（给图表用）
      metric: 'deal',
      metricLabel: '成交数',
      dimensionLabel: '部门',
    },
    title: '分析各部门10月成交情况',
    summary: '...',
    insights: [...],
  };
}
```

### Step 7: 前端渲染

前端收到 SSE 事件后：

1. **`text` 事件** → 更新左侧聊天气泡的文本
2. **`uiSchema` 事件** → 传给右侧 `RenderArea` 组件

`RenderArea` 根据 `type` 决定渲染方式：

```typescript
// src/components/renderer/render-area.tsx (简化)
if (schema.type === 'bar') {
  // 用 ECharts 画柱状图
  // x轴: 部门名称
  // y轴: 成交数
  <ReactEChartsCore option={buildEChartsOption(schema)} />
}

if (schema.type === 'table') {
  // 用 HTML 表格展示明细数据
  <PaginatedSalesTable rows={schema.data.rows} />
}
```

---

## 四、核心组件详解

### 4.1 BaseAgent —— 所有 Agent 的"骨架"

```typescript
// src/lib/agents/base-agent.ts
export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly inputSchema: z.ZodSchema<TInput>;   // 输入格式定义
  abstract readonly outputSchema: z.ZodSchema<TOutput>; // 输出格式定义

  // 公开的执行入口（模板方法模式）
  async execute(input: unknown): Promise<TOutput> {
    // 1. 熔断器检查（如果连续失败 3 次，暂停服务）
    // 2. 验证输入（用 Zod schema 校验）
    // 3. 调用子类的 run() 方法
    // 4. 验证输出
    // 5. 失败自动重试 1 次
    // 6. 更新熔断器状态
  }

  // 子类必须实现的抽象方法
  protected abstract run(input: TInput): Promise<TOutput>;
}
```

**这个类提供了什么？**

| 能力 | 解释 | 为什么需要 |
|------|------|-----------|
| **输入输出验证** | 用 Zod schema 检查数据格式 | 防止 LLM 返回乱七八糟的东西 |
| **熔断器** | 连续失败 3 次后停止调用 | 防止 LLM API 挂掉时雪崩 |
| **自动重试** | 第一次失败后自动重试一次 | LLM 偶尔返回格式不对，重试可能就好了 |
| **类型安全** | 泛型 TInput/TOutput | TypeScript 编译时就能发现类型错误 |

**类比**：BaseAgent 就像一个"员工手册"，规定了每个员工必须：
- 上岗前检查装备（输入验证）
- 干活时有标准流程（run 方法）
- 交班前检查成果（输出验证）
- 累倒了就休息（熔断器）

### 4.2 RouterAgent —— 调度员

```typescript
// src/lib/agents/router-agent.ts
export class RouterAgent extends BaseAgent<RouterInput, RouterOutput> {
  readonly name = 'Router Agent';

  protected async run(input) {
    const result = await generateText({
      model: getDefaultModel(),
      prompt: `你是意图分类器... 用户消息: "${input.message}"`,
    });
    return parseRouterResult(result.text);
    // → { intent: 'analysis', agents: ['query', 'analysis'] }
  }
}
```

**它决定什么？**

| 用户说 | intent | agents | 含义 |
|--------|--------|--------|------|
| "武莹的销售数据" | query | ['query'] | 简单查询 |
| "分析各部门10月成交" | analysis | ['query','analysis'] | 查询+分析 |
| "帮我写跟进话术" | generation | ['query','generator'] | 查询+生成 |

> **注意**：即使用户要"分析"，agents 列表里也一定包含 'query'。因为分析之前必须先查数据。这是一个隐含的流水线依赖。

### 4.3 QueryAgent —— 数据检索员

这是系统里最复杂的 Agent，因为它要解决一个核心问题：**如何把自然语言变成精确的数据库查询？**

```
自然语言: "花园桥校区10月成交超过3单的有谁？"
        ↓ LLM 提取参数
结构化: { department: "花园桥校区", month: "10月", metric: "deal", metricMinValue: 3 }
        ↓ 代码构建 SQL
SQL: SELECT * FROM sales_performance WHERE department LIKE '%花园桥%' AND month = '10月' AND deal >= 3
```

**为什么不直接让 LLM 写 SQL？**

| 方案 | 优点 | 缺点 |
|------|------|------|
| LLM 直接写 SQL | 灵活 | 安全风险（SQL 注入）、不可控 |
| **LLM 提取参数 + 代码构建 SQL** ✓ | 安全、可控 | 参数设计需要预见所有场景 |

本项目选择了**参数提取**方案：
1. LLM 只负责"理解意思"（提取参数）
2. 代码负责"执行查询"（构建 SQL）
3. 参数是有限的（name、department、month、metric、metricMinValue、isRanking、isSummary）

**查询策略**：

```
if (isRanking)       → getTopPerformers()  // 排行榜
else if (有筛选条件)   → WHERE 条件查询      // 精确查询
else if (isSummary)   → 返回全量数据         // 汇总概览
else                  → 全量返回             // 兜底
```

### 4.4 AnalysisAgent —— 数据分析师

**核心设计**：不让 LLM 算数，让代码算。

```typescript
protected async run(input) {
  // Step 1: 代码算统计（100% 准确）
  const stats = this.computeFullStats(input.records);

  // Step 2: 把统计结果放进 prompt
  const prompt = this.buildPrompt(input.query, stats);

  // Step 3: 让 LLM 基于准确的统计数据写分析
  const { object } = await generateObject({
    model: getDefaultModel(),
    schema: analysisOutputSchema,
    prompt,  // 包含完整的统计数据
  });

  return object;
}
```

**computeFullStats 计算什么？**

| 统计项 | 解释 | 示例 |
|--------|------|------|
| `totalDeal` | 总成交数 | 37 |
| `months` | 按月份汇总 | { "10月": { deal: 37, count: 42 } } |
| `departments` | 按部门汇总 | { "花园桥校区": { deal: 15, count: 10 } } |
| `topPerformers` | 全局 TOP5 | [{ name: "白浩5", deal: 5 }, ...] |
| `monthlyTopPerformers` | 各月 TOP5 | { "10月": [{ name: "白浩5", deal: 5 }, ...] } |

> **为什么 computeFullStats 和 ResponseGenerator 的 computeStats 都要算？**
> 因为它们是独立的 Agent，各自需要自己的统计数据来构建 prompt。AnalysisAgent 侧重深度分析（洞察、趋势），ResponseGenerator 侧重用户友好的回复。

### 4.5 ResponseGenerator —— 回复撰写员

它是最后一个 Agent，负责生成用户看到的文字回复。

**关键设计**：
- 它会收到 AnalysisAgent 的分析结果（如果有的话）
- 它会自己再算一遍统计（为了独立性）
- 它同时决定推荐什么图表类型（uiType）

**LLM 调用方式不同**：

| Agent | LLM 调用方式 | 为什么 |
|-------|-------------|--------|
| RouterAgent | `generateText` | 返回纯文本 JSON，代码自己解析 |
| QueryAgent | `generateText` | 同上，返回参数 JSON |
| AnalysisAgent | `generateObject` | 需要结构化输出（schema 约束格式）|
| ResponseGenerator | `generateObject` | 同上 |

`generateObject` 和 `generateText` 的区别：
- `generateText`：LLM 自由输出文本，代码解析 JSON（可能失败）
- `generateObject`：框架强制 LLM 输出符合 schema 的 JSON（更可靠）

---

## 五、LLM 是如何集成的

### 5.1 模型配置

```typescript
// src/lib/llm/provider.ts
import { createOpenAI } from '@ai-sdk/openai';

const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const apiKey = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

export function getDefaultModel() {
  return openai(DEFAULT_MODEL);
}
```

**关键点**：
- 使用 **Vercel AI SDK**（`ai` 包），统一了不同 LLM 提供商的调用方式
- 通过环境变量配置，可以切换到任何 OpenAI 兼容的 API（如 DeepSeek、通义千问等）
- 整个项目只用了 `generateText` 和 `generateObject` 两个 API

### 5.2 LLM 在系统中的 4 个使用场景

```
场景 1: RouterAgent
  输入: 用户消息
  输出: 意图分类 JSON
  目的: 决定走哪条处理流水线

场景 2: QueryAgent
  输入: 用户消息 + 数据库表结构描述
  输出: 查询参数 JSON
  目的: 把自然语言变成结构化查询参数

场景 3: AnalysisAgent
  输入: 用户问题 + 全量统计数据
  输出: 分析摘要 + 洞察列表 + 图表推荐
  目的: 从数据中发现模式、给出专业解读

场景 4: ResponseGenerator
  输入: 用户问题 + 统计数据 + 分析结论
  输出: 自然语言回复 + 图表类型
  目的: 生成用户友好的回答
```

### 5.3 Prompt 工程：如何跟 LLM 说话

系统里每个 prompt 都遵循一个模式：

```
1. 角色定义（"你是销售数据分析专家"）
2. 背景数据（统计数据、查询结果）
3. 任务描述（"生成分析摘要"）
4. 约束规则（"中文回复，简洁专业"）
5. 输出格式（"只输出 JSON"）
```

**一个重要的设计决策**：不在 prompt 里放原始数据行（太多、太嘈杂），而是放**聚合统计**。这样 prompt 更短、LLM 更容易理解。

---

## 六、数据库层

### 6.1 表结构

```sql
-- 核心数据表
CREATE TABLE sales_performance (
  id INTEGER PRIMARY KEY,
  name TEXT,           -- 销售员姓名（如 "武莹1"）
  department TEXT,     -- 部门（如 "学习机-花园桥校区"）
  month TEXT,          -- 月份（"7月"、"8月"、"9月"、"10月"）
  wechat_added INT,    -- 加微信数
  interaction INT,     -- 互动次数
  demand INT,          -- 有需求数
  deal INT             -- 成交数
);

-- 聊天记录表
CREATE TABLE chat_sessions (...);
CREATE TABLE chat_messages (...);
```

### 6.2 查询策略

所有数据库查询都使用**参数化查询**（`?` 占位符），防止 SQL 注入：

```typescript
// 安全 ✓ — 参数化查询
db.prepare('SELECT * FROM sales_performance WHERE name = ?').all(params.name);

// 危险 ✗ — 字符串拼接（本项目没有这样做）
db.prepare(`SELECT * FROM sales_performance WHERE name = '${params.name}'`).all();
```

### 6.3 数据库是 SQLite

```
data/chatbi.db    ← 一个文件就是整个数据库
```

- 不需要安装数据库服务器
- 适合小型应用和原型
- 每次重启 Next.js 自动初始化表结构

---

## 七、前后端通信

### 7.1 为什么用 SSE 不用 WebSocket？

| | SSE | WebSocket |
|---|---|---|
| 方向 | 服务器 → 客户端（单向）| 双向 |
| 复杂度 | 简单（基于 HTTP）| 复杂（需要额外连接管理）|
| 适用场景 | 服务器推送结果 | 实时聊天、游戏 |

本项目是"用户问一次，服务器回答一次"，不需要双向通信，SSE 就够了。

### 7.2 SSE 事件协议

```
event: session    → { sessionId: "xxx" }        // 会话 ID
event: text       → { text: "10月共成交37单..." } // 文字回复
event: uiSchema   → { uiSchema: { ... } }       // 图表数据
event: done       → {}                           // 结束信号
event: error      → { error: "..." }            // 错误
```

前端 `useChat` hook 解析这些事件，更新 React 状态。

---

## 八、设计模式总结

### 8.1 模板方法模式（BaseAgent）

```
BaseAgent.execute()  ← 固定流程（验证 → 执行 → 验证 → 返回）
    │
    ├── RouterAgent.run()
    ├── QueryAgent.run()
    ├── AnalysisAgent.run()
    └── ResponseGenerator.run()
```

每个子类只需要实现 `run()` 方法，验证、重试、熔断等横切逻辑都在基类里。

### 8.2 策略模式（查询策略）

```typescript
if (params.isRanking)    → getTopPerformers()    // 排行策略
else if (有条件)          → WHERE 查询            // 过滤策略
else if (params.isSummary) → 全量返回             // 汇总策略
else                      → 全量返回              // 兜底策略
```

### 8.3 责任链模式（Agent Pipeline）

```
Router → Query → Analysis → Response → UISchema
```

每个 Agent 只做自己的事，结果传给下一个。不越权，不耦合。

### 8.4 熔断器模式（BaseAgent 内置）

```
正常状态 (closed) → 连续失败 3 次 → 熔断状态 (open, 拒绝请求)
                                        ↓ 60秒后
                                   半开状态 (half-open, 试探性允许一次)
                                        ↓ 成功
                                   正常状态 (closed)
```

来源：Netflix 的微服务设计，防止级联故障。

---

## 九、文件结构速查表

```
src/
├── app/api/chat/route.ts          ← API 入口（接收请求，SSE 返回）
├── lib/
│   ├── agents/
│   │   ├── base-agent.ts          ← Agent 基类（验证、熔断、重试）
│   │   ├── router-agent.ts        ← 意图分类（LLM 判断用户想干什么）
│   │   ├── query-agent.ts         ← 查询参数提取（LLM 提取 + SQL 查询）
│   │   ├── analysis-agent.ts      ← 数据分析（代码统计 + LLM 写洞察）
│   │   ├── response-generator.ts  ← 回复生成（LLM 写用户友好的文字）
│   │   └── router-rules.ts        ← 关键词匹配规则（备用路由）
│   ├── chat/
│   │   ├── message-handler.ts     ← ★ 核心：流水线编排 + 图表构建
│   │   └── use-chat.ts            ← 前端 Hook（发请求、解析 SSE）
│   ├── db/
│   │   ├── connection.ts          ← SQLite 连接
│   │   ├── schema.ts              ← 表结构定义
│   │   ├── queries.ts             ← 基础查询函数
│   │   └── queries-sales.ts       ← ★ 销售数据查询（参数提取 + SQL 构建）
│   ├── llm/
│   │   └── provider.ts            ← LLM 模型配置
│   └── search/
│       └── hybrid-search.ts       ← 混合搜索引擎（遗留，用于 SOP 数据）
├── types/
│   ├── agent.ts                   ← Agent 类型定义 + 注册表
│   └── database.ts                ← 数据库类型 + 列元数据
└── components/
    ├── chat/                      ← 聊天 UI 组件
    └── renderer/
        └── render-area.tsx        ← ★ 右侧图表面板（ECharts）
```

---

## 十、关键设计决策背后的思考

### Q1: 为什么用 4 个 Agent 而不是一个？

**一个 Agent 做所有事的问题**：
- Prompt 太长，LLM 容易迷失
- 职责不清晰，难以调试
- 无法灵活组合（简单查询不需要分析）

**4 个 Agent 的好处**：
- 每个 prompt 短、聚焦
- 可以按需组合（query-only vs query+analysis）
- 单个 Agent 失败不影响其他
- 便于独立测试和替换

### Q2: 为什么统计数据算两遍（AnalysisAgent + ResponseGenerator）？

理想情况下可以复用，但这里各算各的是因为：
- **独立性**：每个 Agent 自包含，不依赖另一个的内部结构
- **简化**：不需要设计复杂的 Agent 间数据传递协议
- **容错**：AnalysisAgent 失败了，ResponseGenerator 还能自己算基本统计

### Q3: 为什么 LLM 调用不是流式的（逐字返回）？

当前实现是等 LLM 完整返回后一次性推送。流式返回需要：
- 前端支持 Markdown 流式渲染
- Agent Pipeline 的流式编排
- 图表数据需要在所有文本完成后才能确定

对于 BI 查询场景（响应时间 2-5 秒），非流式可以接受。后续可以优化。

### Q4: 如果 LLM 挂了怎么办？

```
RouterAgent 失败 → 兜底路由（按 query 处理）
QueryAgent 失败 → 关键词提取兜底（extractQueryParams）
AnalysisAgent 失败 → 跳过分析，直接生成回复
ResponseGenerator 失败 → 格式化兜底文本（formatFallbackText）
```

每一层都有 fallback。系统不会因为单个 LLM 调用失败而完全不可用。

---

## 十一、延伸阅读

| 概念 | 推荐资源 |
|------|---------|
| Agent 模式 | Anthropic 的 [Building Effective Agents](https://docs.anthropic.com/en/docs/build-with-claude/agentic-patterns) |
| Vercel AI SDK | [sdk.vercel.ai](https://sdk.vercel.ai) — generateText/generateObject 文档 |
| Zod 验证 | [zod.dev](https://zod.dev) — TypeScript schema 验证库 |
| SSE 协议 | [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) |
| ECharts | [echarts.apache.org](https://echarts.apache.org) — 图表库 |
| Next.js App Router | [nextjs.org/docs](https://nextjs.org/docs) — API Routes、Server Components |
