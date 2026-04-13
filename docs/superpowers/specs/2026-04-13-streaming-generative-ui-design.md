# ChatBI 流式生成式 UI 升级设计

> 创建日期: 2026-04-13
> 状态: Draft (待用户确认)
> 选型: **方案 C — Sandpack 代码沙箱 + AI 生成代码**
> 关联: [多Agent设计](./2026-04-03-chatbi-multi-agent-design.md)

---

## 一、背景与目标

### 1.1 现状

当前 ChatBI 的渲染管线：

```
用户提问 → Router Agent → Query Agent → UnifiedAnalysisResponse
  → buildUISchema() → SSE stream → useChat() 解析 → RenderArea 渲染
```

**瓶颈**：
- 图表类型硬编码 (bar/pie/line/radar/table)，AI 无法自由组合
- UI Schema 是后端结构化 JSON，布局和样式完全固定
- 无法生成灵光那种「AI 直接产出任意页面」的效果

### 1.2 目标

参考灵光（Lingguang）的流式全模态生成思路：

1. **AI 直接生成可视化代码** — 不再走固定 UISchema，AI 写 ECharts/HTML 代码
2. **Sandpack 沙箱实时渲染** — 浏览器端编译运行，安全隔离
3. **无限扩展** — 图表、地图、动画、仪表盘，AI 想生成什么就生成什么

### 1.3 约束

- 新增 1 个依赖：`@codesandbox/sandpack-react`
- 保留现有 RenderArea 作为 fallback（无数据或 Sandpack 加载失败时）
- 复用现有 Query Agent 数据查询能力

---

## 二、技术方案

### 2.1 架构总览

```
用户提问
  → POST /api/chat
  → QueryAgent.execute() 查询数据
  → streamText({
      model,
      system: dataAnalystPrompt + 数据,
      tools: { generateVisualization },  // AI 调用此 tool 生成代码
      maxSteps: 2,
    })
  → AI 流式输出分析文字 + 调用 generateVisualization tool
  → tool 返回 { code: "..." } 代码字符串
  → 客户端收到 tool_result 后，传给 Sandpack 渲染
```

### 2.2 数据流时序

```
Client                          Server
  │                               │
  │── POST /api/chat ───────────→│
  │                               │── QueryAgent.execute() 查询数据
  │                               │── streamText({ system + 数据, tools })
  │                               │
  │←─ text: "我来分析..." ───────│  (流式文字)
  │←─ text: "各部门成交..." ─────│
  │←─ tool_call: generateVis ────│  (AI 决定生成可视化)
  │←─ tool_result: { code } ─────│  (ECharts React 代码)
  │←─ text: "如上图所示..." ─────│  (继续解释)
  │←─ [DONE] ────────────────────│
  │                               │
  │── Sandpack 渲染 code ────────│  (客户端沙箱编译运行)
```

### 2.3 与灵光方案的对应关系

| 灵光概念 | 本方案对应 |
|---------|----------|
| AI 生成 HTML + CSS + JS | AI 生成 React + ECharts 代码 |
| srcdoc iframe 渲染 | Sandpack iframe 渲染 |
| ComponentRegistry 组件注册 | Sandpack template + dependencies |
| componentMonitor 监听渲染 | Sandpack 的 `listen` + `sandpack-client` API |
| base.js SDK 运行时 | Sandpack 运行时 |
| CandyJar 跨 iframe 通信 | Sandpack `sendMessage` / `listen` |

---

## 三、详细设计

### 3.1 服务端 — generateVisualization Tool

```typescript
// src/lib/chat/tools/generate-visualization.ts
import { z } from 'zod';

export const generateVisualization = {
  description:
    '生成数据可视化页面。根据数据特征生成 React + ECharts 代码，在沙箱中渲染。' +
    '支持任意图表类型、多图组合、自定义布局。优先使用 ECharts 实现可视化。',

  parameters: z.object({
    title: z.string().describe('可视化页面标题'),
    description: z.string().describe('简要描述这个可视化展示了什么'),
    code: z.string().describe(
      '完整的 React 组件代码。要求：\n' +
      '1. export default function App() { ... } 格式\n' +
      '2. 使用 echarts 和 echarts-for-react 库\n' +
      '3. import ReactECharts from "echarts-for-react"\n' +
      '4. import * as echarts from "echarts/core" + 按需 import charts\n' +
      '5. 数据直接内嵌在代码中\n' +
      '6. 组件必须自包含，不依赖外部变量'
    ),
  }),

  execute: async (params) => {
    const code = params.code.trim();
    if (code.length < 20) {
      return { error: '生成的代码过短，请重新生成' };
    }
    if (code.length > 50000) {
      return { error: '代码超过 50KB 限制' };
    }
    // 校验额外依赖数量（防止 AI 声明过多依赖拖慢加载）
    const extraDeps = params.dependencies ?? {};
    if (Object.keys(extraDeps).length > 5) {
      return { error: '额外依赖不能超过 5 个，请优先使用已预装的库' };
    }
    return {
      type: 'visualization' as const,
      title: params.title,
      description: params.description,
      code,
      dependencies: extraDeps,
    };
  },
};
```

### 3.2 服务端 — Route Handler 改造

```typescript
// src/app/api/chat/route.ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { generateVisualization } from '@/lib/chat/tools/generate-visualization';
import { buildDataAnalystPrompt } from '@/lib/chat/prompts/data-analyst';
import { queryAgent } from '@/lib/agents/query-agent';

export async function POST(request: NextRequest) {
  const { message, sessionId } = await request.json();
  const sid = ensureSession(sessionId);
  persistMessage(sid, 'user', message);

  // 1. 查询数据（复用现有 Query Agent）
  const queryResult = await queryAgent.execute({ query: message, searchType: 'sales' });

  // 2. 无数据时走旧路径
  if (queryResult.records.length === 0) {
    return handleNoData(message, sid);
  }

  // 3. 构造带数据的 system prompt
  const systemPrompt = buildDataAnalystPrompt(message, queryResult.records);

  // 4. 流式调用 AI
  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
    tools: { generateVisualization },
    maxSteps: 2,
    onFinish: ({ text, toolResults }) => {
      persistMessage(sid, 'assistant', text, JSON.stringify(toolResults));
    },
  });

  return result.toDataStreamResponse();
}
```

### 3.3 服务端 — System Prompt

```typescript
// src/lib/chat/prompts/data-analyst.ts

export function buildDataAnalystPrompt(query: string, records: Record<string, unknown>[]): string {
  const dataSnippet = JSON.stringify(records.slice(0, 30), null, 2);

  return `你是 ChatBI 销售数据分析助手，同时也是一个前端可视化工程师。

用户问题：${query}

数据（JSON，最多 30 条）：
${dataSnippet}

## 工作方式

1. 先用文字分析数据，回答用户问题
2. 然后调用 generateVisualization tool 生成可视化代码

## 代码要求

生成 React 组件代码，使用 ECharts 绘图：
- 必须是 \`export default function App() { ... }\` 格式
- 使用以下模板：

\`\`\`jsx
import React from "react";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { BarChart, PieChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, PieChart, LineChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, CanvasRenderer]);

export default function App() {
  const option = {
    // ECharts option 配置
  };
  return (
    <div style={{ width: "100%", height: "100%", padding: "16px" }}>
      <ReactECharts echarts={echarts} option={option} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
\`\`\`

## 图表选择指南
- 比较类别数值 → bar chart
- 占比分析 → pie chart
- 趋势变化 → line chart
- 多指标对比 → 多 series bar/line chart
- 排行榜 → 横向 bar chart
- 可以在一个 option 中组合多个 series

数据直接写在代码里，确保组件完全自包含。`;
}
```

### 3.4 依赖管理策略

Sandpack 的依赖解析机制是**声明式**的 — 所有 npm 包必须预先声明在 `customSetup.dependencies` 中，由 CodeSandbox CDN (`sandpack-cdn.codesandbox.io`) 在浏览器端解析和打包。不支持运行时自动 `npm install`。

采用**两层混合策略**：

**第一层：基础依赖（固定）** — React、ECharts 等高频库始终预装在 SandpackProvider 配置中，避免每次请求重复解析。

**第二层：扩展依赖（AI 指定）** — `generateVisualization` tool 增加 `dependencies` 参数，AI 生成代码时如果需要额外库（如 dayjs、lodash），在 tool 调用中一并声明。

```typescript
// generateVisualization tool 的 dependencies 参数
dependencies: z.record(z.string()).optional().describe(
  '代码需要的额外 npm 依赖，格式 { "package-name": "version" }。' +
  '注意：react, react-dom, echarts, echarts-for-react 已预装，无需重复声明。'
),
```

SandpackRenderer 合并两层依赖：

```typescript
// 基础依赖（始终可用）
const BASE_DEPS = {
  'react': 'latest',
  'react-dom': 'latest',
  'echarts': '6.0.0',
  'echarts-for-react': '3.0.2',
};

// SandpackRenderer props 增加 dependencies
type SandpackRendererProps = {
  code: string;
  dependencies?: Record<string, string>;
};

// 合并：基础依赖 + AI 指定的扩展依赖
const allDeps = { ...BASE_DEPS, ...dependencies };
```

**依赖解析流程**：

```
AI 生成代码 + 声明依赖
  → tool 返回 { code, dependencies: { "dayjs": "^1.11.0" } }
  → SandpackRenderer 合并 BASE_DEPS + extraDeps
  → SandpackProvider customSetup.dependencies = allDeps
  → CDN 解析 + 浏览器端打包
  → iframe 中运行
```

**限制与应对**：
- 所有依赖必须存在于 npm registry（Sandpack CDN 会解析）
- 如果 AI 声明了不存在的包，Sandpack 会报错显示在 Preview 中
- System prompt 中引导 AI 优先使用已预装的基础依赖，减少额外依赖数量

### 3.5 客户端 — Sandpack 渲染组件

```typescript
// src/components/renderer/sandpack-renderer.tsx
'use client';

import {
  SandpackProvider,
  SandpackPreview,
} from '@codesandbox/sandpack-react';

const BASE_DEPS = {
  'react': 'latest',
  'react-dom': 'latest',
  'echarts': '6.0.0',
  'echarts-for-react': '3.0.2',
};

const ENTRY_FILE = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
const root = createRoot(document.getElementById("root"));
root.render(<App />);`;

type SandpackRendererProps = {
  code: string;
  dependencies?: Record<string, string>;
};

export function SandpackRenderer({ code, dependencies }: SandpackRendererProps) {
  const allDeps = { ...BASE_DEPS, ...dependencies };

  return (
    <div className="w-full h-[500px] rounded-lg border overflow-hidden">
      <SandpackProvider
        template="react"
        files={{
          '/App.js': code,
          '/index.js': ENTRY_FILE,
        }}
        customSetup={{ dependencies: allDeps }}
        options={{
          recompileMode: 'delayed',
          recompileDelay: 500,
        }}
      >
        <SandpackPreview
          showNavigator={false}
          showRefreshButton={false}
          style={{ height: '100%', border: 'none' }}
        />
      </SandpackProvider>
    </div>
  );
}
```

### 3.6 客户端 — 集成到消息流

改造 `RenderArea`，收到 visualization tool result 时用 Sandpack 渲染：

```typescript
// src/components/renderer/render-area.tsx — 关键改动

import { SandpackRenderer } from './sandpack-renderer';

type VisualizationResult = {
  type: 'visualization';
  title: string;
  description: string;
  code: string;
  dependencies?: Record<string, string>;
};

export function RenderArea({ toolResults, schema, isLoading }: RenderAreaProps) {
  // 优先渲染 Sandpack 可视化
  if (toolResults?.length) {
    return (
      <div className="flex flex-col gap-4 p-4 h-full overflow-auto">
        {toolResults.map((result, i) => {
          if (result.type === 'visualization' && result.code) {
            return (
              <div key={i}>
                <h3 className="text-base font-semibold mb-2">{result.title}</h3>
                {result.description && (
                  <p className="text-sm text-muted-foreground mb-3">{result.description}</p>
                )}
                <SandpackRenderer code={result.code} dependencies={result.dependencies} />
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  // Fallback: 旧 UISchema 渲染（不动）
  return <LegacyRenderArea schema={schema} isLoading={isLoading} />;
}
```

### 3.7 客户端 — useChat 改造

用 AI SDK 的 `useChat` 替换手动 SSE：

```typescript
// src/lib/chat/use-chat-stream.ts
import { useChat as useAIChat } from 'ai/react';

export type ChatMessageWithVis = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  visualization?: { title: string; description: string; code: string; dependencies?: Record<string, string> };
};

export function useChatStream() {
  const { messages, isLoading, append, setMessages, error } = useAIChat({
    api: '/api/chat',
  });

  const chatMessages: ChatMessageWithVis[] = messages.map(m => {
    // 从 tool results 中提取 visualization
    const visPart = m.parts?.find(
      p => p.type === 'tool-result'
        && p.result?.type === 'visualization'
    );
    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      visualization: visPart?.result,
    };
  });

  return { messages: chatMessages, isLoading, sendMessage: append, error };
}
```

---

## 四、文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| **新增** | `src/lib/chat/tools/generate-visualization.ts` | generateVisualization tool |
| **新增** | `src/lib/chat/prompts/data-analyst.ts` | 带数据 + 代码模板的 system prompt |
| **新增** | `src/lib/chat/use-chat-stream.ts` | 基于 AI SDK useChat 的客户端 hook |
| **新增** | `src/components/renderer/sandpack-renderer.tsx` | Sandpack 沙箱渲染组件 |
| **改造** | `src/app/api/chat/route.ts` | SSE → streamText + tool |
| **改造** | `src/components/chat/chat-panel.tsx` | 接入 useChatStream |
| **改造** | `src/components/renderer/render-area.tsx` | 支持 visualization + 旧 schema fallback |
| **新增依赖** | `@codesandbox/sandpack-react` | Sandpack 运行时 |
| **保留** | `src/lib/chat/message-handler.ts` | 无数据场景 fallback |
| **保留** | `src/lib/agents/*` | Query Agent 继续复用 |

---

## 五、迁移步骤

### Step 1: 安装 Sandpack + 创建 Tool

```bash
cd chatBI && npm install @codesandbox/sandpack-react
```

创建 `generateVisualization` tool 和 `buildDataAnalystPrompt`。

### Step 2: 改造 route.ts

从手动 SSE → `streamText` + `generateVisualization` tool。

### Step 3: 客户端改造

创建 `SandpackRenderer` 组件 + `useChatStream` hook。

### Step 4: 集成到 RenderArea

优先渲染 Sandpack 可视化，旧 UISchema 作为 fallback。

### Step 5: 验证

测试用例：
- "各部门成交情况" → AI 生成柱状图
- "成交排行榜" → AI 生成横向柱状图
- "分析趋势" → AI 生成折线图
- "各部门占比" → AI 生成饼图
- 无数据查询 → fallback 到旧路径

---

## 六、风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| AI 生成代码有语法错误 | 中 | Sandpack 显示报错信息 + system prompt 提供模板 |
| Sandpack 编译慢 (2-5s) | 中 | 显示加载骨架屏 + 代码预览作为即时反馈 |
| 代码安全风险 | 低 | Sandpack iframe sandbox 隔离 + 无网络请求 |
| ECharts 依赖加载慢 | 中 | Sandpack 缓存 + 固定版本号 |
| 生成代码超过 prompt token 限制 | 低 | Zod 校验 code 长度 + system prompt 要求简洁 |
| 与灵光的差距 | 预期 | 灵光有自研 SDK + 组件注册表 + 跨 iframe 通信，我们用 Sandpack 替代，核心能力一致 |

---

## 七、与灵光方案的差距说明

| 能力 | 灵光 | 本方案 | 差距 |
|------|------|--------|------|
| AI 生成代码 | ✅ | ✅ | 无 |
| 沙箱渲染 | 自研 iframe | Sandpack iframe | 功能等价 |
| 流式代码生成 | ✅ 逐字符 | ⚠️ 一次性 tool result | **有差距**，后续可优化 |
| 组件注册表 | ComponentRegistry | Sandpack template | 功能等价 |
| 3D/音频/视频 | ✅ | ✅（理论上） | 取决于 prompt |
| 跨 iframe 通信 | CandyJar | Sandpack messaging | 功能等价 |
| 自然语言查数据 | lingguang.data.fetch | Query Agent 预查 | 架构不同，能力等价 |
