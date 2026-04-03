# ChatBI 多Agent协作系统设计文档

> 创建日期: 2026-04-03
> 状态: Finalized (设计已定稿)
> 作者: Claude + User

---

## 一、项目概述

### 1.1 产品定位
一个面向在线教育销售主管的 **ChatBI（对话式商业智能）** 应用，通过自然语言对话查询和分析销售SOP数据，并支持动态生成可视化界面。

### 1.2 核心价值
- **降低数据分析门槛** — 销售主管无需学习复杂BI工具，通过对话即可获取洞察
- **提升SOP管理效率** — 快速查询话术、分析效果、优化流程
- **动态可视化** — 根据用户需求自动生成图表、对比面板、详情页等

### 1.3 目标用户
**销售主管** — 主要使用场景：
- 日常管理（查看团队业绩、分析转化率、优化销售策略）[核心]
- 汇报展示（生成数据可视化、制作培训材料、输出报告）[核心]
- 培训新人（查找话术、演示流程、考核知识点）[未来目标]
- 客户跟进（查找解决方案、生成跟进计划）[未来目标]

---

## 二、数据资产

### 2.1 数据类型
**结构化业务数据** — 在线教育销售环节的SOP相关数据

### 2.2 数据内容（按重要性排序）
| 类型 | 描述 | 占比 |
|------|------|------|
| **销售话术和流程** | 不同场景的沟通模板、跟进流程、转化策略 | 主要 |
| **数据报表和KPI** | 销售业绩、转化率、跟进效率等指标数据 | 次要 |
| **客户案例和问题库** | 常见问题解答、成功案例分析、异议处理 | 补充 |
| **培训材料和考核** | 销售培训文档、知识点、测试题、评分标准 | 偶尔 |

### 2.3 数据规模
约 **1000条** 数据记录

---

## 三、核心功能需求

### 3.1 对话交互场景（按优先级）

#### P0 - 查询信息
> "找出转化率最高的销售话术"
> "哪些客户案例适合教育行业"
> "展示本周转化率最高的销售案例"

#### P0 - 分析和洞察
> "分析最近一个月销售下降的原因"
> "对比新老销售的跟进效率差异"
> "分析不同话术的客户响应率"

#### P1 - 生成和创建（未来目标）
> "根据这个客户情况生成新的话术"
> "创建针对高净值客户的SOP流程"

#### P1 - 培训考核（未来目标）
> "帮我准备一个针对新人的话术培训材料"
> "给出5个常见的客户异议及应答练习"

### 3.2 动态界面生成

用户提问后，系统自动判断是否需要生成可视化界面：

| 用户意图 | 生成界面类型 |
|----------|--------------|
| 查看销售数据趋势 | 折线图/柱状图（用户可指定图表类型） |
| 对比两个销售的话术效果 | 对比表格/雷达图 |
| 查看某个客户的跟进记录 | 时间线 + 状态流详情页 |
| 分析团队业绩分布 | 饼图/热力图/分布图 |

**核心规则**：
- 用户有明确图表要求 → 按用户指定类型渲染
- 用户未指定 → 系统智能推荐最合适的可视化方式

---

## 四、技术选型决策

### 4.1 多Agent框架方案

**最终选择：自研轻量方案**

#### 排除的方案及原因

| 框架 | 排除原因 |
|------|----------|
| LangGraph | 场景简单（4个功能Agent），图结构工作流是杀鸡用牛刀 |
| AutoGen | 主要Python生态，不需要agent间自然语言对话 |
| agent-swarm-kit | 社区太小，成熟度不够，生产环境风险高 |

#### 选择自研的原因

1. **数据量小**（1000条）— 不需要复杂的数据处理管道
2. **Agent分工明确** — 不需要通用的图编排引擎
3. **核心创新点是动态UI生成** — 必须自研，无现成框架支持

### 4.2 技术栈

| 层级 | 技术选型 | 理由 |
|------|----------|------|
| **前端框架** | Next.js + React | 全栈统一、SSR支持、生态成熟 |
| **UI组件库** | shadcn/ui + Tailwind CSS | 用户指定，基于 Radix UI |
| **对话体验** | Vercel AI SDK | 流式响应、原生TS支持 |
| **Agent编排** | 自研Router + 4功能Agent | 轻量、可控、适配场景 |
| **数据存储** | PostgreSQL / SQLite | 1000条足够，SQL查询灵活 |
| **向量检索** | 内嵌embedding | 支持语义查询SOP内容 |

---

## 五、系统架构设计

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│  ┌───────────┐  ┌──────────────────────────────┐│
│  │ Chat Panel │  │    Dynamic Rendering Area     ││
│  │ (对话输入) │  │  (图表/表格/详情/对比面板)     ││
│  └─────┬─────┘  └──────────┬───────────────────┘│
└────────┼───────────────────┼──────────────────────┘
         │   WebSocket/SSE   │
         ▼                   ▼
┌─────────────────────────────────────────────────┐
│                API Layer (Next.js)                │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │ Chat API     │  │ Component Render API     │  │
│  │ (流式响应)   │  │ (动态组件加载)            │  │
│  └──────┬──────┘  └──────────────────────────┘  │
└─────────┼───────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────┐
│              Agent Orchestration                  │
│  ┌──────────┐                                    │
│  │  Router   │ ─── 意图识别 + 任务拆解            │
│  │  Agent    │                                    │
│  └──┬───┬───┬───┬──┘                             │
│     │   │   │   │                                 │
│  ┌──▼┐┌▼──┐┌▼──┐┌▼───┐                          │
│  │ Q ││ A ││ G ││ UI │  ← 4个功能Agent           │
│  └───┘└───┘└───┘└────┘                          │
└─────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────┐
│              Data Layer                           │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │ PostgreSQL│  │ Vector   │  │ SOP Data   │    │
│  │ (结构化)  │  │ (语义检索)│  │ (1000条)   │    │
│  └──────────┘  └──────────┘  └────────────┘    │
└─────────────────────────────────────────────────┘
```

### 5.1 关键设计决策

1. **前后端分离但统一框架** — Next.js 全栈，前后端共享类型定义
2. **双通道输出** — Chat面板负责文本对话，Dynamic Rendering Area负责可视化展示，两个区域并行工作
3. **Agent间通过结构化数据通信** — 不是自然语言对话，而是传递 JSON schema

---

## 六、Agent设计

### 6.1 Agent总览

```
                    ┌─────────────┐
                    │ Router Agent │  ← 入口，理解意图，分发任务
                    └──┬──┬──┬──┬─┘
                       │  │  │  │
         ┌─────────────┘  │  │  └─────────────┐
         ▼                ▼  ▼                ▼
  ┌─────────────┐  ┌──────────┐  ┌──────────────┐
  │ Query Agent │  │Analysis  │  │ UI Builder   │
  │ (查询数据)   │  │Agent     │  │ Agent        │
  └─────────────┘  │(分析洞察) │  │(生成界面)     │
                   └──────────┘  └──────────────┘
                        │
                        ▼
                   ┌──────────┐
                   │Generator │  ← 按需调用
                   │Agent     │
                   │(生成内容) │
                   └──────────┘
```

### 6.2 各Agent职责

| Agent | 职责 | 输入 | 输出 |
|-------|------|------|------|
| **Router** | 意图识别、任务分类、决定调度策略 | 用户自然语言 | 调度指令（JSON） |
| **Query** | 从数据源检索数据 | 结构化查询参数 | 数据结果集 |
| **Analysis** | 统计分析、趋势计算、对比分析 | Query的结果数据 | 分析结论 + 数据摘要 |
| **Generator** | 生成话术、方案、培训材料 | 上下文 + 模板 | 文本内容 |
| **UI Builder** | 根据数据生成可视化组件配置 | 数据 + 用户意图 | UI Schema（JSON） |

### 6.3 调度策略

```
用户提问 → Router判断意图
  │
  ├── 简单查询（"找到XX话术"） → Query Agent → 文本回答
  │
  ├── 数据分析（"分析转化率趋势"） → Query → Analysis → 文本 + UI Builder → 图表
  │
  ├── 对比分析（"对比A和B"） → Query → Analysis → UI Builder → 对比面板
  │
  └── 内容生成（"生成新话术"） → Query → Generator → 文本回答
```

### 6.4 Agent间通信协议

Agent间通过结构化JSON传递数据，不使用自然语言对话：

```typescript
// Agent间传递的消息格式
interface AgentMessage {
  type: 'query_result' | 'analysis_result' | 'ui_schema' | 'generated_content';
  data: unknown;
  metadata: {
    sourceAgent: string;
    targetAgent: string;
    timestamp: number;
  };
}
```

---

## 七、数据模型

### 7.1 存储方案

**SQLite** 作为本地数据库：
- 数据量小（几千条），SQLite足够
- 零配置，嵌入式部署
- 静态数据无需并发写入

向量检索：better-sqlite3 + embedding JSON 存储，支持语义查询。

### 7.2 表结构

```sql
-- 核心表：统一存储所有SOP数据
CREATE TABLE sop_records (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,        -- 'script' | 'kpi' | 'case' | 'training'
  title TEXT NOT NULL,
  content TEXT NOT NULL,         -- 核心内容（话术文本/数据JSON/案例正文等）
  tags TEXT,                     -- JSON数组，标签如 ["价格异议","高净值客户"]
  metadata TEXT,                 -- JSON，不同category有不同字段
  embedding TEXT,                -- 向量化后的embedding JSON数组
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 对话历史
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES chat_sessions(id),
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT NOT NULL,
  ui_schema TEXT,                -- 如果AI生成了界面，保存UI Schema JSON
  agent_trace TEXT,              -- Agent执行轨迹JSON（调试用）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 7.3 metadata 按category差异化

```typescript
// 话术流程
type ScriptMeta = {
  scenario: string;       // "价格异议处理" | "需求挖掘" | "促成成交"
  stage: string;          // "开场" | "深入" | "收尾"
  target_customer: string;// "新客户" | "老客户" | "高净值"
  effectiveness_score?: number;
};

// KPI报表
type KpiMeta = {
  metric_name: string;    // "转化率" | "跟进效率" | "客单价"
  period: string;         // "2026-Q1" | "2026-03"
  department?: string;
  sales_person?: string;
  value: number;
  unit: string;           // "%" | "元" | "次"
};

// 客户案例
type CaseMeta = {
  industry: string;       // "教育" | "金融" | "互联网"
  customer_type: string;  // "企业" | "个人"
  outcome: string;        // "成交" | "流失" | "跟进中"
  deal_amount?: number;
};

// 培训材料
type TrainingMeta = {
  module: string;         // "基础话术" | "进阶技巧" | "异议处理"
  difficulty: string;     // "初级" | "中级" | "高级"
  duration_minutes?: number;
};
```

### 7.4 数据导入流程

```
Excel/CSV/JSON ──→ 解析脚本 ──→ 分类(category) ──→ 结构化存储
                                     │
                                     ▼
                              生成embedding ──→ 存入embedding字段
```

### 7.5 数据特征
- **来源**: Excel/CSV文件 或 后端接口JSON
- **更新频率**: 静态数据，导入后基本不变，偶尔手动更新
- **数据量**: 约1000~几千条

---

## 八、动态UI生成机制

### 8.1 整体流程

```
用户提问 → 数据查询/分析完成 → UI Builder Agent 判断是否需要生成界面
                                         │
                                   需要 → 输出 UI Schema (JSON)
                                         │
                                         ▼
                              前端 DynamicRenderer 组件
                              根据 UI Schema 动态渲染对应图表
```

### 8.2 图表库选型：ECharts

**选择理由**：
1. **原生 JSON option 配置** — ECharts 的 `option` 本身就是 JSON 对象，UI Builder Agent 输出的 UI Schema 可直接映射为 ECharts option
2. **图表类型最全** — 热力图、雷达图、漏斗图、桑基图等30+图表类型全部覆盖
3. **中文生态好** — 文档、社区、示例中文友好
4. **性能优秀** — Canvas 渲染，大数据量下表现好

**对比其他库的排除原因**：

| 库 | 排除原因 |
|---|---|
| Recharts | 图表类型有限(~10种)，无原生JSON配置 |
| Nivo | 配置式API好，但图表类型不如ECharts丰富 |
| Victory | 需额外封装，生态不如ECharts |
| D3 | 学习曲线陡，开发成本高，不适合快速迭代 |
| TanStack Charts | 太新，生态不成熟 |
| MUI X Charts | 依赖MUI生态，灵活性受限 |

### 8.3 UI Schema 定义

```typescript
interface UISchema {
  type: 'chart' | 'table' | 'timeline' | 'comparison' | 'dashboard';
  title: string;
  description?: string;
  config: ChartConfig | TableConfig | TimelineConfig | ComparisonConfig | DashboardConfig;
}

// 图表配置 — 直接映射 ECharts option
type ChartConfig = {
  chartType: 'line' | 'bar' | 'pie' | 'radar' | 'scatter' | 'heatmap' | 'funnel' | 'sankey';
  echartsOption: Record<string, unknown>;  // 标准 ECharts option JSON
};

// 数据表格
type TableConfig = {
  columns: { key: string; label: string; width?: number }[];
  rows: Record<string, unknown>[];
  highlights?: { row: number; col: string; reason: string }[];
};

// 时间线
type TimelineConfig = {
  events: { time: string; title: string; status: string; detail?: string }[];
};

// 对比面板
type ComparisonConfig = {
  items: { label: string; metrics: { name: string; value: number; unit: string }[] }[];
  radarConfig?: Record<string, unknown>;  // 可选雷达图
};

// 组合仪表盘
type DashboardConfig = {
  layouts: { schema: UISchema; span: number }[];
};
```

### 8.4 动态渲染流程

```
UI Builder Agent 输出 UI Schema JSON
      │
      ▼
前端 DynamicRenderer 组件接收
      │
      ├── type === 'chart'       → 提取 echartsOption → 直接传入 ECharts 实例
      ├── type === 'table'       → 渲染 <DynamicTable />
      ├── type === 'timeline'    → 渲染 <Timeline />
      ├── type === 'comparison'  → 渲染 <ComparisonPanel /> (+ 可选 ECharts 雷达图)
      └── type === 'dashboard'   → 递归渲染多个子组件
```

### 8.5 ECharts 集成关键点

```typescript
// 前端组件伪代码
function DynamicChart({ config }: { config: ChartConfig }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chart = echarts.init(chartRef.current);
    chart.setOption(config.echartsOption);  // 直接使用 Agent 生成的 option
    return () => chart.dispose();
  }, [config]);

  return <div ref={chartRef} style={{ width: '100%', height: 400 }} />;
}
```

### 8.6 UI Builder Agent 的职责

UI Builder Agent 接收分析结果 + 用户意图，输出标准 UI Schema：

```
输入: {
  analysisResult: { /* Analysis Agent 的输出 */ },
  userIntent: "对比新老销售的跟进效率",
  preferredChartType: null  // 用户未指定，由Agent智能推荐
}

输出: {
  type: "comparison",
  title: "新老销售跟进效率对比",
  config: {
    items: [...],
    radarConfig: { /* ECharts radar option */ }
  }
}
```

---

## 九、技术风险与应对策略（借鉴 Claude Code 设计）

> 本章节的设计思路来源于 Claude Code 源码分析（见 `总结文档/` 目录），将其中生产级 Agent 的设计模式应用到我们的 ChatBI 场景。

### 9.1 风险1：UI Builder Agent 生成不合法的 ECharts option

**Claude Code 参考**：Zod v4 Schema 验证 + Tool = Schema + Permission + Execution

**应对方案：多层校验 + 降级**

```
UI Builder Agent 输出
      │
      ▼
Zod Schema 校验 (uiSchemaSchema)
      │
      ├── 校验通过 → 渲染图表
      │
      ├── 校验失败（结构错误）
      │     ├── 重试1次（附带 Zod 错误信息给 Agent）
      │     └── 仍失败 → 降级为表格展示 + 提示用户
      │
      └── ECharts setOption 报错（运行时）
            ├── try-catch 捕获
            └── 降级为 <pre> 展示原始数据
```

```typescript
// 借鉴 Claude Code 的 Tool Schema 模式
import { z } from 'zod';

const uiSchemaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chart'),
    title: z.string(),
    config: z.object({
      chartType: z.enum(['line', 'bar', 'pie', 'radar', 'scatter', 'heatmap', 'funnel', 'sankey']),
      echartsOption: z.record(z.unknown()),
    }),
  }),
  z.object({
    type: z.literal('table'),
    title: z.string(),
    config: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.unknown())),
    }),
  }),
  // ... 其他类型
]);
```

### 9.2 风险2：Router Agent 意图识别不准

**Claude Code 参考**：权限决策链（规则匹配 → ML分类 → 用户确认）

**应对方案：分层决策链**

```
用户提问
      │
      ▼
规则引擎匹配（关键词 + 正则，零成本）
      │
      ├── 高置信度命中 → 直接调度对应Agent
      │     "找话术" → Query Agent
      │     "对比分析" → Query + Analysis Agent
      │
      └── 规则未命中 → LLM 意图分类（中等成本）
            │
            ├── 置信度 > 0.8 → 调度
            └── 置信度 ≤ 0.8 → 展示候选意图让用户确认
                  "您是想查询数据还是分析数据？"
```

```typescript
// 借鉴 Claude Code 的 Agent 定义即配置模式
type AgentDefinition = {
  name: string;
  systemPrompt: string;
  tools: string[];        // 允许调用的工具白名单
  model?: string;         // 模型偏好
  keywords: string[];     // 快速匹配关键词
  description: string;    // LLM 判断时参考的描述
};

const AGENTS: Record<string, AgentDefinition> = {
  query: {
    name: 'Query Agent',
    systemPrompt: '...',
    tools: ['sql_query', 'vector_search'],
    keywords: ['查找', '找到', '搜索', '有没有', '展示'],
    description: '从SOP数据中检索信息',
  },
  analysis: {
    name: 'Analysis Agent',
    systemPrompt: '...',
    tools: ['sql_query', 'statistics'],
    keywords: ['分析', '对比', '趋势', '原因', '差异'],
    description: '对数据进行统计分析和洞察提取',
  },
  // ...
};
```

### 9.3 风险3：语义检索准确率低

**Claude Code 参考**：多层降级策略（API Microcompact → Microcompact → Partial → Full）

**应对方案：混合检索 + 渐进降级**

```
用户查询
      │
      ▼
向量语义检索（主路径）
      │
      ├── top-K 结果相似度 > 0.7 → 直接返回
      │
      └── 相似度 ≤ 0.7 → 混合检索（向量 + 关键词BM25）
            │
            ├── 有结果 → 返回 + 标注置信度
            └── 无好结果 → 返回最相关3条 + 提示用户细化查询
```

### 9.4 其他借鉴设计

| Claude Code 模式 | 应用到 ChatBI |
|---|---|
| **AsyncGenerator 流式输出** | `async *processMessage()` → Chat文本流式推送 + 图表异步渲染 |
| **先持久化再执行** | 用户消息先写SQLite再触发Agent调度，保证不丢失 |
| **熔断器保护** | Agent调用连续失败3次暂停，降级为简单文本回复 |
| **上下文压缩** | 长对话token管理，达到阈值自动压缩历史 |
| **Agent定义即配置** | 新增Agent只需加配置，不改代码 |
| **Feature Flag** | 图表类型/高级功能通过配置开关，MVP只开核心功能 |

### 9.5 Zod 在项目中的统一应用

借鉴 Claude Code 全面使用 Zod 的做法：

```typescript
// 所有 Agent 输入输出都经过 Zod 校验
const routerOutputSchema = z.object({
  intent: z.enum(['query', 'analysis', 'generation', 'training']),
  confidence: z.number().min(0).max(1),
  agents: z.array(z.string()),
  params: z.record(z.unknown()),
});

const queryOutputSchema = z.object({
  records: z.array(z.record(z.unknown())),
  totalCount: z.number(),
  query: z.string(),
});

// Agent 基类统一校验
abstract class BaseAgent<TInput, TOutput> {
  abstract inputSchema: z.ZodSchema<TInput>;
  abstract outputSchema: z.ZodSchema<TOutput>;

  async execute(input: unknown): Promise<TOutput> {
    const validated = this.inputSchema.parse(input);  // 校验输入
    const result = await this.run(validated);
    return this.outputSchema.parse(result);            // 校验输出
  }

  protected abstract run(input: TInput): Promise<TOutput>;
}
```

---

## 十、开发计划

### Phase 1 - MVP（查询 + 基础对话）

```
Week 1-2: 基础架构搭建
├── Next.js 项目初始化
├── SQLite 数据库 + 数据导入脚本
├── Chat UI（对话输入 + 文本回复）
├── Router Agent（意图识别 + 分层决策链）
└── Query Agent（数据查询 + 语义检索）

交付物：用户可以对话查询SOP数据，获得文本回复
```

### Phase 2 - 核心体验（分析 + 动态图表）

```
Week 3-4: 可视化能力
├── Analysis Agent（统计分析逻辑）
├── UI Builder Agent（UI Schema 生成 + Zod校验）
├── DynamicRenderer + ECharts 集成
├── 对话历史记录
└── 双通道输出（Chat + 动态图表区）

交付物：用户可以获取数据分析和可视化图表
```

### Phase 3 - 增强（生成 + 培训 + 打磨）

```
Week 5-6: 完整体验
├── Generator Agent（内容生成）
├── 对比面板 / 时间线等高级UI组件
├── 数据导入工具（Excel/CSV/JSON）
├── UI 打磨和响应式适配
└── 浏览器通知能力

交付物：完整的多Agent ChatBI应用
```

---

## 附录：头脑风暴记录

### 已确认的决策
- [x] 产品定位：ChatBI，在线教育销售SOP数据
- [x] 目标用户：销售主管
- [x] 核心场景：查询信息 + 分析洞察（P0），生成创建 + 培训考核（P1）
- [x] 数据类型：结构化业务数据，约1000条
- [x] 技术方案：自研轻量Agent编排
- [x] 系统架构：Next.js全栈 + 4功能Agent + 双通道输出

### 待讨论
- [x] Agent具体设计（5个Agent：Router/Query/Analysis/Generator/UI Builder）
- [x] 数据模型（SQLite + 向量检索 + 4种metadata类型）
- [x] 动态UI生成（ECharts + UI Schema + DynamicRenderer）
- [x] 开发计划（3 Phase: MVP → 核心体验 → 增强）
- [x] 技术风险应对（借鉴 Claude Code：Zod校验 + 分层决策链 + 混合检索 + 熔断器）

---

*设计文档已定稿。下一步：编写实施计划（writing-plans）*