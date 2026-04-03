# ChatBI 多Agent协作系统 — 宫内实施计划

> 创建日期: 2026-04-03
> 关联Spec: `docs/superpowers/specs/2026-04-03-chatbi-multi-agent-design.md`
> 状态: Draft

---

## 全局约定

### 项目根目录

```
C:/Users/chenyan/cy-test/chatBI/
├── src/                        # 源代码
│   ├── app/                    # Next.js App Router (API Routes)
│   ├── components/             # React 组件
│   ├── lib/                    # 核心库（Agent、数据库、工具）
│   ├── types/                  # TypeScript 类型定义
│   └── styles/                 # 全局样式
├── prisma/                     # 数据库 schema（或 drizzle）
├── data/                       # 种子数据（Excel/CSV/JSON）
├── tests/                      # 测试
├── docs/                       # 设计文档
├── next.config.ts
├── package.json
├── tsconfig.json
└── .env.local                  # 环境变量（API Keys）
```

### 抑制依赖

| 包 | 用途 |
|---|------|
| `next` | 全栈框架 |
| `react` + `react-dom` | UI |
| `shadcn/ui` | 组件库（Button, Input, Card, ScrollArea, Dialog 等） |
| `tailwindcss` | shadcn/ui 依赖的 CSS 框架 |
| `better-sqlite3` | SQLite 驱动 |
| `zod` | Schema 校验 |
| `echarts` + `echarts-for-react` | 图表渲染 |
| `ai` (Vercel AI SDK) | LLM 流式调用 |
| `uuid` | ID 生成 |

### 类型系统约定

所有共享类型定义在 `src/types/` 下：
- `agent.ts` — Agent 相关类型（AgentDefinition, AgentMessage 等）
- `schema.ts` — UI Schema 类型（UISchema, ChartConfig 等）
- `database.ts` — 数据库记录类型（SopRecord, ChatSession, ChatMessage）
- `metadata.ts` — 各 category 的 metadata 类型

### Agent 基类约定

所有 Agent 继承 `src/lib/agents/base-agent.ts`，BaseAgent<TInput, TOutput>），：
- `inputSchema` / `outputSchema` — Zod schema，自动校验
- `execute(input)` — 入口方法，先校验再调用 run
- `run(input)` — 子类实现的业务逻辑

---

## Phase 1: MVP — 查询 + 基础对话

> 目标: 用户可以对话查询SOP数据，获得文本回复

---

### Task 1.1: 项目初始化

**做什么**: 创建 Next.js 项目，安装依赖。配置 TypeScript。

**文件**:
- `package.json` — 初始化，添加依赖
- `tsconfig.json` — strict 模式
- `next.config.ts` — 基本配置
- `.env.local` — LLM API Key 模板
- `src/app/layout.tsx` — 根布局
- `src/app/page.tsx` — 首页

**步骤**:
1. `npx create-next-app@latest` 初始化项目（选择 TypeScript, App Router, Tailwind CSS）
2. `npx shadcn@latest init` 初始化 shadcn/ui
3. 安装 shadcn 组件: `npx shadcn@latest add button input card scroll-area dialog separator avatar badge skeleton`
4. 安装额外依赖: `better-sqlite3`, `zod`, `ai`, `uuid`, `echarts`, `echarts-for-react`
3. 创建 `.env.local` 模板: `OPENAI_API_KEY=` 或 `ANTHROPIC_API_KEY=`
4. 创建基础布局: 左侧 Chat Panel + 右侧 Dynamic Rendering Area

**测试**: `npm run build` 成功. 页面可访问.

**提交**: `feat: init Next.js project with core dependencies`

---

### Task 1.2: 类型系统

**做什么**: 定义所有共享的 TypeScript 类型和 Zod schema。

**文件**:
- `src/types/agent.ts` — Agent 类型
- `src/types/schema.ts` — UI Schema 类型和 Zod schema
- `src/types/database.ts` — 数据库记录类型
- `src/types/metadata.ts` — 各 category metadata 类型
- `src/types/index.ts` — 统一导出

**步骤**:
1. 定义 `AgentDefinition` 类型（name, systemPrompt, tools, model?, keywords, description）
2. 定义 `AgentMessage` 类型（type, data, metadata）
3. 定义 `UISchema` 及各 config 类型（ChartConfig, TableConfig 等）
4. 定义 Zod schema: `uiSchemaSchema`, `routerOutputSchema`, `queryOutputSchema`
5. 定义 `SopRecord`, `ChatSession`, `ChatMessage` 数据库类型
6. 定义 `ScriptMeta`, `KpiMeta`, `CaseMeta`, `TrainingMeta`

**测试**: 类型文件编译无错误. Zod schema 能正确校验合法数据和拒绝非法数据.

**提交**: `feat: add shared type definitions and Zod schemas`

---

### Task 1.3: 数据库层

**做什么**: SQLite 数据库初始化. 种子数据导入. 查询工具函数。

**文件**:
- `src/lib/db/connection.ts` — SQLite 连接管理（单例）
- `src/lib/db/schema.ts` — CREATE TABLE 语句
- `src/lib/db/seed.ts` — 数据导入脚本
- `src/lib/db/queries.ts` — 查询工具函数
- `data/sample-sop-data.json` — 样本数据（10-20条测试数据）
- `scripts/import-data.ts` — CLI 导入脚本

**步骤**:
1. 实现 `getDb()` 单例连接（使用 better-sqlite3）
2. 编写建表 SQL: `sop_records`, `chat_sessions`, `chat_messages`
3. 实现种子数据导入: 解析 JSON → 插入 `sop_records`
4. 实现查询函数:
   - `searchSopRecords(query, filters)` — 结构化查询
   - `getSopRecordById(id)` — 单条查询
   - `getSopRecordsByCategory(category)` — 按类型查询
5. 创建 10-20 条涵盖 4 种 category 的测试数据

**测试**: 单元测试覆盖所有查询函数. 导入脚本可正确执行.

**提交**: `feat: add SQLite database layer with seed data`

---

### Task 1.4: BaseAgent 基类

**做什么**: 实现所有 Agent 的抽象基类，集成 Zod 校验。

**文件**:
- `src/lib/agents/base-agent.ts` — Agent 基类
- `src/lib/agents/types.ts` — Agent 相关工具类型

**步骤**:
1. 实现 `BaseAgent<TInput, TOutput>` 抽象类:
   - `abstract inputSchema: z.ZodSchema<TInput>`
   - `abstract outputSchema: z.ZodSchema<TOutput>`
   - `async execute(input: unknown): Promise<TOutput>` — 先校验输入，调用 run，校验输出
   - `protected abstract run(input: TInput): Promise<TOutput>` — 子类实现
2. 错误处理: 校验失败抛 `AgentValidationError`，run 失败抛 `AgentExecutionError`
3. 重试逻辑: `execute` 内置 1 次重试（附带错误信息）

**测试**: 测试 BaseAgent 的校验逻辑（合法输入通过、非法输入拒绝、重试机制）.

**提交**: `feat: add BaseAgent base class with Zod validation`

---

### Task 1.5: Router Agent

**做什么**: 实现意图识别和任务调度的 Router Agent。

**文件**:
- `src/lib/agents/router-agent.ts` — Router Agent 实现
- `src/lib/agents/router-rules.ts` — 关键词规则引擎
- `src/lib/agents/agent-registry.ts` — Agent 注册表

**步骤**:
1. 实现 `agent-registry.ts`:
   - 定义 4 个 Agent 配置: query, analysis, generator, ui-builder
   - 每个 Agent 定义 keywords 和 description
2. 实现 `router-rules.ts`:
   - `matchByKeywords(query)` — 关键词匹配，返回 { agents, confidence }
   - 规则列表: "查找/找到/搜索" → query, "分析/对比/趋势" → analysis + ui-builder
 等
3. 实现 `RouterAgent`:
   - `run(input)`: 先走规则匹配，高置信度直接返回；低置信度调用 LLM 分类
   - 输出: `{ intent, confidence, agents[], params }`
   - LLM 调用使用 Vercel AI SDK `generateObject()`

**测试**: 单元测试关键词匹配逻辑. LLM 意图分类（mock AI SDK）.

**提交**: `feat: add Router Agent with layered decision chain`

---

### Task 1.6: Query Agent

**做什么**: 实现数据查询和语义检索。

**文件**:
- `src/lib/agents/query-agent.ts` — Query Agent 实现
- `src/lib/search/vector-search.ts` — 向量语义检索（MVP 用简化版）
- `src/lib/search/hybrid-search.ts` — 混合检索（向量 + 关键词）

**步骤**:
1. MVP 阶段向量检索简化实现:
   - 使用 LLM embedding API 对用户查询生成 embedding
   - 余弦相似度计算（直接在 JS 中实现，数据量小不需要专门向量库）
   - 返回 top-K 结果
2. 实现 `HybridSearch`:
   - 向量检索 + 关键词 LIKE 查询
   - 合并去重，按相关性排序
3. 实现 `QueryAgent`:
   - `run(input)`: 根据参数选择查询方式
   - 结构化查询: 直接 SQL
   - 语义查询: 向量/混合检索
   - 输出: `{ records[], totalCount, query }`

**测试**: 测试 SQL 查询、向量检索（mock embedding）、混合检索逻辑.

**提交**: `feat: add Query Agent with hybrid search`

---

### Task 1.7: Chat API

**做什么**: 实现流式对话 API 端点。

**文件**:
- `src/app/api/chat/route.ts` — Chat API (POST, 流式响应)
- `src/lib/chat/session.ts` — 会话管理
- `src/lib/chat/message-handler.ts` — 消息处理编排

**步骤**:
1. 实现 `session.ts`:
   - `createSession()` / `getSession()` / `addMessage()`
   - 先持久化再执行（借鉴 Claude Code）
2. 实现 `message-handler.ts`:
   - 接收用户消息 → 先写入 chat_messages
   - 调用 RouterAgent.execute()
   - 根据路由结果调用对应 Agent
   - 返回文本响应
3. 实现 API route:
   - POST handler，使用 Vercel AI SDK `streamText()` 流式返回
   - 支持 SSE

**测试**: API 集成测试. Mock LLM 响应. 验证消息持久化.

**提交**: `feat: add Chat API with streaming and Router Agent orchestration`

---

### Task 1.8: Chat UI

**做什么**: 前端对话界面。

**文件**:
- `src/components/chat/chat-panel.tsx` — 对话面板容器
- `src/components/chat/message-list.tsx` — 消息列表
- `src/components/chat/message-item.tsx` — 单条消息
- `src/components/chat/chat-input.tsx` — 输入框
- `src/components/chat/use-chat.ts` — Chat hook（调用 API）

**步骤**:
1. 实现 `use-chat.ts` hook:
   - 管理 messages 状态
   - 调用 `/api/chat` 端点
   - 处理 SSE 流式响应
   - 追加 assistant 消息
2. 实现 `chat-input.tsx`:
   - 文本输入 + 发送按钮
   - Enter 发送. Shift+Enter 换行
3. 实现 `message-item.tsx`:
   - 区分 user / assistant 消息样式
   - Markdown 渲染 assistant 回复
4. 实现 `message-list.tsx`:
   - 渲染消息列表. 自动滚动到底部
5. 实现 `chat-panel.tsx`:
   - 组合以上组件
   - 占位右侧 Dynamic Rendering Area（Phase 2 填充）

**测试**: 组件渲染测试. 用户输入和流式响应 mock.

**提交**: `feat: add Chat UI with streaming message display`

---

### Task 1.9: MVP 集成测试

**做什么**: 端到端测试 MVP 完整流程。

**文件**:
- `tests/e2e/chat-query.test.ts` — E2E 测试

**步骤**:
1. 测试场景:
   - 用户输入"查找价格异议处理话术" → 返回相关话术列表
   - 用户输入"最近一个月转化率怎么样" → 返回KPI数据
   - 用户输入模糊查询 → Router 正确分类或请求用户确认

**提交**: `test: add MVP integration tests`

---

## Phase 2: 核心体验 — 分析 + 动态图表

> 目标: 用户可以获取数据分析和可视化图表

---

### Task 2.1: Analysis Agent

**做什么**: 实现统计分析和洞察提取。

**文件**:
- `src/lib/agents/analysis-agent.ts` — Analysis Agent
- `src/lib/analysis/statistics.ts` — 统计计算工具函数

**步骤**:
1. 实现 `statistics.ts`:
   - `calculateTrend(records)` — 趋势计算
   - `calculateComparison(groupA, groupB)` — 对比分析
   - `calculateDistribution(records, field)` — 分布统计
2. 实现 `AnalysisAgent`:
   - `run(input)`: 接收 QueryAgent 的数据结果
   - 使用 LLM 进行分析推理（数据 → 洞察）
   - 同时用统计函数计算关键指标
   - 输出: `{ summary, insights[], dataSummary, suggestedChartType? }`

**测试**: 统计函数单元测试. Analysis Agent 集成测试（mock LLM）.

**提交**: `feat: add Analysis Agent with statistical functions`

---

### Task 2.2: UI Builder Agent

**做什么**: 根据分析结果生成 UI Schema。

**文件**:
- `src/lib/agents/ui-builder-agent.ts` — UI Builder Agent
- `src/lib/ui-schema/templates.ts` — ECharts option 模板库

**步骤**:
1. 实现 `templates.ts`:
   - 预定义常用 ECharts option 模板: line, bar, pie, radar, heatmap
   - 每个模板有合理的默认值（颜色、字体、图例位置等中文友好）
2. 实现 `UIBuilderAgent`:
   - `run(input)`: 接收 analysisResult + userIntent
   - 使用 LLM 生成 UI Schema JSON
   - 如果用户指定了图表类型，按用户要求生成
   - 否则根据数据特征智能推荐
   - 输出经过 `uiSchemaSchema` Zod 校验
   - 校验失败重试 1 次（附带 Zod 错误信息）

**测试**: Zod 校验测试（合法/非法 schema）. 模板生成测试.

**提交**: `feat: add UI Builder Agent with ECharts templates and Zod validation`

---

### Task 2.3: DynamicRenderer

**做什么**: 前端动态渲染引擎. 根据 UI Schema 渲染对应组件。

**文件**:
- `src/components/renderer/dynamic-renderer.tsx` — 动态渲染入口
- `src/components/renderer/dynamic-chart.tsx` — ECharts 图表渲染
- `src/components/renderer/dynamic-table.tsx` — 表格渲染
- `src/components/renderer/dynamic-comparison.tsx` — 对比面板
- `src/components/renderer/chart-error-boundary.tsx` — 图表错误边界

**步骤**:
1. 实现 `chart-error-boundary.tsx`:
   - React ErrorBoundary 包裹图表组件
   - 渲染失败时降级为表格或原始数据展示
2. 实现 `dynamic-chart.tsx`:
   - 接收 ChartConfig
   - 初始化 ECharts 实例
   - `setOption(config.echartsOption)` 渲染
   - 响应式: 监听容器尺寸变化. `resize()`
   - 清理: `dispose()`
3. 实现 `dynamic-table.tsx`:
   - 接收 TableConfig. 渲染 HTML 表格
   - 高亮标记
4. 实现 `dynamic-comparison.tsx`:
   - 接收 ComparisonConfig. 渲染对比面板
   - 可选雷达图
5. 实现 `dynamic-renderer.tsx`:
   - 根据 `schema.type` 分发到对应组件
   - 包裹 ChartErrorBoundary

**测试**: 各渲染组件的快照测试. ErrorBoundary 降级测试.

**提交**: `feat: add DynamicRenderer with ECharts, Table, and Comparison panels`

---

### Task 2.4: 双通道输出

**做什么**: 连接 Chat API 和 DynamicRenderer. 实现文本 + 图表并行输出。

**文件**:
- `src/lib/chat/message-handler.ts` — 更新: 处理 UI Schema
- `src/app/api/chat/route.ts` — 更新: 双通道响应
- `src/components/chat/message-item.tsx` — 更新: 支持 UI Schema 展示
- `src/components/chat/use-chat.ts` — 更新: 解析 UI Schema

**步骤**:
1. 更新 `message-handler.ts`:
   - Agent 链完成后. 如果包含 UI Schema. 附加到消息的 `ui_schema` 字段
2. 更新 API route:
   - 流式响应中包含 UI Schema 数据（作为特殊事件）
3. 更新 `use-chat.ts`:
   - 解析 SSE 中的 UI Schema 事件
   - 存储到消息的 `uiSchema` 字段
4. 更新 `message-item.tsx`:
   - 如果消息有 `uiSchema`. 在文本下方渲染 `<DynamicRenderer schema={uiSchema} />`

**测试**: 端到端测试: 用户问数据分析 → Chat 回复文本 + 右侧渲染图表.

**提交**: `feat: add dual-channel output (chat text + dynamic charts)`

---

### Task 2.5: 对话历史

**做什么**: 实现多轮对话. 历史记录持久化。

**文件**:
- `src/app/api/sessions/route.ts` — 会话 CRUD API
- `src/components/chat/session-list.tsx` — 会话列表侧边栏
- `src/lib/chat/session.ts` — 更新: 多会话管理

**步骤**:
1. 实现会话 API: GET 列表, POST 创建, DELETE 删除
2. 实现侧边栏: 显示历史会话列表
3. 切换会话时加载对应消息历史

**测试**: API 测试. 组件渲染测试.

**提交**: `feat: add multi-session chat history with sidebar`

---

## Phase 3: 增强 — 生成 + 培训 + 打磨

> 目标: 完整的多Agent ChatBI应用

---

### Task 3.1: Generator Agent

**做什么**: 实现内容生成（话术、方案、培训材料）。

**文件**:
- `src/lib/agents/generator-agent.ts` — Generator Agent

**步骤**:
1. 实现 `GeneratorAgent`:
   - `run(input)`: 接收上下文 + 模板需求
   - 使用 LLM 生成内容
   - 输出: `{ content, type, metadata }`

**测试**: Mock LLM 生成测试.

**提交**: `feat: add Generator Agent for content creation`

---

### Task 3.2: 高级 UI 组件

**做什么**: 时间线、Dashboard 等高级 UI 组件。

**文件**:
- `src/components/renderer/dynamic-timeline.tsx` — 时间线组件
- `src/components/renderer/dynamic-dashboard.tsx` — 仪表盘组件

**步骤**:
1. 实现 `dynamic-timeline.tsx`: 按时间线渲染事件列表
2. 实现 `dynamic-dashboard.tsx`: 递归渲染多个子 UISchema

**提交**: `feat: add Timeline and Dashboard rendering components`

---

### Task 3.3: 数据导入工具

**做什么**: 用户可上传 Excel/CSV/JSON 导入数据。

**文件**:
- `src/app/api/import/route.ts` — 导入 API
- `src/components/settings/data-import.tsx` — 导入 UI
- `src/lib/import/parser.ts` — 文件解析器

**步骤**:
1. 实现解析器: CSV/Excel/JSON → SopRecord[]
2. 实现 API: 接收文件, 解析, 入库
3. 实现导入 UI: 文件上传 + 预览 + 确认

**提交**: `feat: add data import tool for Excel/CSV/JSON`

---

### Task 3.4: UI 打磨

**做什么**: 响应式适配. 加载状态. 整体 UI 优化。

**文件**:
- 全局样式调整
- 各组件响应式适配
- 加载骨架屏（Skeleton）

**提交**: `feat: polish UI with responsive design and loading states`

---

### Task 3.5: 上下文压缩

**做什么**: 借鉴 Claude Code 的上下文管理， 实现长对话 token 控制。

**文件**:
- `src/lib/chat/context-manager.ts` — 上下文管理器
- `src/lib/chat/token-estimator.ts` — Token 估算

**步骤**:
1. 实现 `token-estimator.ts`: 粗略估算当前消息的 token 数
2. 实现 `context-manager.ts`:
   - 达到阈值（如 80% 上下文窗口）时触发压缩
   - 压缩策略: 保留最近 5 轮对话 + 系统摘要（LLM 生成）
   - 熔断器: 连续 3 次压缩失败暂停

**提交**: `feat: add context compression for long conversations`

---

## 依赖关系图

```
Phase 1 (必须按顺序):
  1.1 项目初始化
    → 1.2 类型系统
    → 1.3 数据库层
    → 1.4 BaseAgent 基类
    → 1.5 Router Agent (依赖 1.4)
    → 1.6 Query Agent (依赖 1.3, 1.4)
    → 1.7 Chat API(依赖 1.5, 1.6)
    → 1.8 Chat UI(依赖 1.7)
    → 1.9 MVP 集成测试(依赖 1.8)

Phase 2 (1.9 完成后开始):
  2.1 Analysis Agent(依赖 1.4, 1.6)
  2.2 UI Builder Agent(依赖 1.4, 2.1)
  2.3 DynamicRenderer(依赖 1.2, 2.2)
  2.4 双通道输出(依赖 2.3, 1.7)
  2.5 对话历史(依赖 1.3, 1.7)

Phase 3(Phase 2 完成后开始):
  3.1 Generator Agent(依赖 1.4)
  3.2 高级 UI 组件(依赖 2.3)
  3.3 数据导入工具(依赖 1.3)
  3.4 UI 打磨(依赖 2.4)
  3.5 上下文压缩(依赖 1.7)
```

---

## 技术决策备忘

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据库 | SQLite (better-sqlite3) | 数据量小，零配置，嵌入式 |
| ORM | 不使用 ORM | SQL 简单直接，数据量小 |
| Schema 校验 | Zod v4 | 借鉴 Claude Code，全量校验 |
| 流式 API | Vercel AI SDK `streamText()` | 原生 TS 支持，与 Next.js 深度集成 |
| 向量检索 | 简化实现（JS 内余弦相似度） | 数据量小，不需要专门向量库 |
| 图表 | ECharts | JSON option 原生支持，图表类型最全 |
| CSS | Tailwind CSS | shadcn/ui 依赖，统一风格 |
| 组件库 | shadcn/ui | 用户指定，基于 Radix UI + Tailwind |

---

*实施计划完成。下一步: 按 Phase 顺序执行任务。*
