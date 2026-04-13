# Streaming Generative UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed UISchema rendering pipeline with AI-generated React+ECharts code rendered in Sandpack, while keeping the old path as fallback.

**Architecture:** Server-side `streamText` + `generateVisualization` tool produces code that the client renders in a Sandpack iframe sandbox. Query Agent fetches data first; when data exists, AI generates code; when no data, legacy handler remains as fallback.

**Tech Stack:** Next.js 16, Vercel AI SDK 6 (`streamText`, `useChat`), `@codesandbox/sandpack-react`, ECharts 6, Zod 4

**Design doc:** `docs/superpowers/specs/2026-04-13-streaming-generative-ui-design.md`

---

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `src/lib/chat/tools/generate-visualization.ts` | generateVisualization tool definition (Zod params + execute) | **NEW** |
| `src/lib/chat/prompts/data-analyst.ts` | System prompt builder with data + ECharts template | **NEW** |
| `src/components/renderer/sandpack-renderer.tsx` | SandpackProvider wrapper, merges base+extra deps | **NEW** |
| `src/lib/chat/use-chat-stream.ts` | useChat wrapper extracting visualization from tool results | **NEW** |
| `src/app/api/chat/route.ts` | SSE → streamText + tool; keeps legacy fallback | **MODIFY** |
| `src/components/renderer/render-area.tsx` | Adds Sandpack path, keeps legacy UISchema as fallback | **MODIFY** |
| `src/components/chat/chat-panel.tsx` | Switch import to useChatStream | **MODIFY** |
| `src/app/page.tsx` | Switch to useChatStream, handle visualization data | **MODIFY** |

**Unchanged:** `message-handler.ts`, `query-agent.ts`, `unified-analysis-response.ts`, `session.ts` — all preserved as fallback.

---

### Task 1: Install Sandpack dependency

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install @codesandbox/sandpack-react**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npm install @codesandbox/sandpack-react
```

- [ ] **Step 2: Verify installation**

```bash
cd C:/Users/chenyan/cy-test/chatBI && node -e "require('@codesandbox/sandpack-react'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add package.json package-lock.json && git commit -m "chore: add @codesandbox/sandpack-react dependency"
```

---

### Task 2: Create generateVisualization tool

**Files:**
- Create: `src/lib/chat/tools/generate-visualization.ts`

- [ ] **Step 1: Create tools directory and file**

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
    dependencies: z.record(z.string()).optional().describe(
      '代码需要的额外 npm 依赖，格式 { "package-name": "version" }。' +
      '注意：react, react-dom, echarts, echarts-for-react 已预装，无需重复声明。'
    ),
  }),

  execute: async (params: {
    title: string;
    description: string;
    code: string;
    dependencies?: Record<string, string>;
  }) => {
    const code = params.code.trim();
    if (code.length < 20) {
      return { error: '生成的代码过短，请重新生成' };
    }
    if (code.length > 50000) {
      return { error: '代码超过 50KB 限制' };
    }
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx tsc --noEmit src/lib/chat/tools/generate-visualization.ts 2>&1 | head -5
```

Expected: no errors (or only path alias errors which are fine — `@/` resolves at build time)

- [ ] **Step 3: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/lib/chat/tools/generate-visualization.ts && git commit -m "feat: add generateVisualization tool definition"
```

---

### Task 3: Create data-analyst system prompt builder

**Files:**
- Create: `src/lib/chat/prompts/data-analyst.ts`

- [ ] **Step 1: Create prompts directory and file**

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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx tsc --noEmit src/lib/chat/prompts/data-analyst.ts 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/lib/chat/prompts/data-analyst.ts && git commit -m "feat: add data analyst system prompt builder"
```

---

### Task 4: Create SandpackRenderer component

**Files:**
- Create: `src/components/renderer/sandpack-renderer.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/renderer/sandpack-renderer.tsx
'use client';

import {
  SandpackProvider,
  SandpackPreview,
} from '@codesandbox/sandpack-react';

const BASE_DEPS: Record<string, string> = {
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
          recompileMode: 'delayed' as const,
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx tsc --noEmit src/components/renderer/sandpack-renderer.tsx 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/components/renderer/sandpack-renderer.tsx && git commit -m "feat: add SandpackRenderer component"
```

---

### Task 5: Create useChatStream hook

**Files:**
- Create: `src/lib/chat/use-chat-stream.ts`

This hook wraps AI SDK's `useChat` and extracts visualization data from tool results. It must produce a shape compatible with the existing `ChatMessage` type so the UI change is minimal.

- [ ] **Step 1: Create the hook**

```typescript
// src/lib/chat/use-chat-stream.ts
'use client';

import { useChat as useAIChat } from 'ai/react';
import type { UIMessage } from 'ai';

export type VisualizationData = {
  title: string;
  description: string;
  code: string;
  dependencies?: Record<string, string>;
};

export type ChatMessageVis = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  uiSchema?: unknown;
  visualization?: VisualizationData;
};

export function useChatStream() {
  const { messages, isLoading, append, setMessages, error, status } = useAIChat({
    api: '/api/chat',
  });

  const chatMessages: ChatMessageVis[] = (messages as UIMessage[]).map(m => {
    // Extract visualization from tool invocation parts
    const toolParts = m.parts?.filter(
      (p): p is Extract<typeof p, { type: 'tool-invocation' }> =>
        p.type === 'tool-invocation'
    ) ?? [];

    let visualization: VisualizationData | undefined;
    for (const part of toolParts) {
      const inv = part.toolInvocation;
      if (
        inv.state === 'result' &&
        inv.result &&
        typeof inv.result === 'object' &&
        'type' in inv.result &&
        (inv.result as Record<string, unknown>).type === 'visualization'
      ) {
        const r = inv.result as Record<string, unknown>;
        visualization = {
          title: String(r.title ?? ''),
          description: String(r.description ?? ''),
          code: String(r.code ?? ''),
          dependencies: r.dependencies as Record<string, string> | undefined,
        };
      }
    }

    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      visualization,
    };
  });

  const sendMessage = (content: string) => {
    append({ role: 'user', content });
  };

  const clearMessages = () => {
    setMessages([]);
  };

  return {
    messages: chatMessages,
    isLoading: isLoading || status === 'streaming',
    error: error?.message ?? null,
    sendMessage,
    clearMessages,
    sessionId: undefined as string | undefined,
    loadSessionMessages: async (_sessionId: string) => {
      // TODO: implement session loading for new stream format if needed
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx tsc --noEmit src/lib/chat/use-chat-stream.ts 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/lib/chat/use-chat-stream.ts && git commit -m "feat: add useChatStream hook wrapping AI SDK useChat"
```

---

### Task 6: Rewrite route.ts — streamText + generateVisualization

**Files:**
- Modify: `src/app/api/chat/route.ts`

This is the core server-side change. The route will:
1. Query data via QueryAgent (unchanged)
2. When data exists → `streamText` with `generateVisualization` tool
3. When no data → fall back to legacy `handleMessage`

The key insight: we keep `handleMessage` for the no-data and greeting paths, and only branch to `streamText` when we have query results.

- [ ] **Step 1: Replace route.ts content**

The full file (preserving existing imports and session logic):

```typescript
// src/app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import { ensureSession, persistMessage } from '@/lib/chat/session';
import { handleMessage } from '@/lib/chat/message-handler';
import { generateVisualization } from '@/lib/chat/tools/generate-visualization';
import { buildDataAnalystPrompt } from '@/lib/chat/prompts/data-analyst';
import { QueryAgent } from '@/lib/agents/query-agent';
import { getDefaultModel } from '@/lib/llm/provider';

const queryAgent = new QueryAgent();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId } = body as { message: string; sessionId?: string };

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const sid = ensureSession(sessionId);
    persistMessage(sid, 'user', message);

    // Try to get data first for the new streaming path
    let queryResult: Awaited<ReturnType<typeof queryAgent.execute>> | null = null;
    try {
      queryResult = await queryAgent.execute({ query: message, searchType: 'sales' });
    } catch {
      // If query fails, fall through to legacy handler
    }

    // New path: data found → streamText with generateVisualization tool
    if (queryResult && queryResult.records.length > 0) {
      const systemPrompt = buildDataAnalystPrompt(message, queryResult.records);

      const result = streamText({
        model: getDefaultModel(),
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

    // Legacy fallback: no data or query error → old SSE handler
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        send('session', { sessionId: sid });

        try {
          const legacyResult = await handleMessage(message, sid);
          send('text', { text: legacyResult.text });
          if (legacyResult.uiSchema) {
            send('uiSchema', { uiSchema: legacyResult.uiSchema });
          }
          persistMessage(
            sid,
            'assistant',
            legacyResult.text,
            legacyResult.uiSchema ? JSON.stringify(legacyResult.uiSchema) : undefined,
            legacyResult.agentTrace ? JSON.stringify(legacyResult.agentTrace) : undefined,
          );
          send('done', {});
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          send('error', { error: errorMsg });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx tsc --noEmit src/app/api/chat/route.ts 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/app/api/chat/route.ts && git commit -m "feat: rewrite chat route with streamText + generateVisualization tool"
```

---

### Task 7: Modify RenderArea — add Sandpack rendering path

**Files:**
- Modify: `src/components/renderer/render-area.tsx`

Add a `visualization` prop. When present, render via SandpackRenderer. When absent, render via legacy UISchema path (all existing code stays).

- [ ] **Step 1: Add imports and types at top of file**

Add after the existing imports (line 16):

```typescript
import dynamic from 'next/dynamic';

const SandpackRenderer = dynamic(
  () => import('./sandpack-renderer').then(m => ({ default: m.SandpackRenderer })),
  { ssr: false, loading: () => <SandpackLoadingSkeleton /> },
);

type VisualizationData = {
  title: string;
  description: string;
  code: string;
  dependencies?: Record<string, string>;
};

function SandpackLoadingSkeleton() {
  return (
    <div className="w-full h-[500px] rounded-lg border overflow-hidden flex items-center justify-center bg-muted/30">
      <div className="flex flex-col items-center gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <p className="text-sm text-muted-foreground">加载可视化沙箱...</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update RenderAreaProps and component signature**

Change lines 32-35:

```typescript
type RenderAreaProps = {
  schema: UISchema | null;
  isLoading?: boolean;
  visualization?: VisualizationData;
};
```

Change line 238:

```typescript
export function RenderArea({ schema, isLoading, visualization }: RenderAreaProps) {
```

- [ ] **Step 3: Add Sandpack rendering at top of RenderArea body**

Insert immediately after the component opening (before `if (!schema)`):

```typescript
  // Priority: Sandpack visualization > legacy UISchema
  if (visualization?.code) {
    return (
      <div className="flex h-full flex-col overflow-hidden p-4">
        <div className="mb-3">
          <h3 className="text-base font-semibold">{visualization.title}</h3>
          {visualization.description && (
            <p className="text-muted-foreground text-sm mt-1">{visualization.description}</p>
          )}
        </div>
        <SandpackRenderer code={visualization.code} dependencies={visualization.dependencies} />
      </div>
    );
  }
```

- [ ] **Step 4: Verify build**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx next build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/components/renderer/render-area.tsx && git commit -m "feat: add Sandpack rendering path to RenderArea"
```

---

### Task 8: Update page.tsx — switch to useChatStream

**Files:**
- Modify: `src/app/page.tsx`

Switch from `useChat` to `useChatStream`. Pass `visualization` to RenderArea.

- [ ] **Step 1: Replace useChat import and usage**

Change line 9:

```typescript
// OLD: import { useChat, type ChatMessage } from '@/lib/chat/use-chat';
// NEW:
import { useChatStream, type ChatMessageVis } from '@/lib/chat/use-chat-stream';
```

Change line 12:

```typescript
// OLD: const chat = useChat();
// NEW:
const chat = useChatStream();
```

- [ ] **Step 2: Update activeSchema to also check for visualization**

Replace lines 17-27 (the `activeSchema` IIFE):

```typescript
  // Get the selected message's data, or fall back to latest assistant data
  const { activeSchema, activeVisualization } = (() => {
    const findMessageData = (msgId: string | null) => {
      if (msgId) {
        const selected = chat.messages.find(m => m.id === msgId);
        if (selected) {
          return {
            schema: selected.uiSchema ?? null,
            vis: (selected as ChatMessageVis).visualization,
          };
        }
      }
      // Default: show latest assistant message's data
      const last = [...chat.messages].reverse().find(
        m => m.role === 'assistant' && (m.uiSchema || (m as ChatMessageVis).visualization)
      );
      if (last) {
        return {
          schema: last.uiSchema ?? null,
          vis: (last as ChatMessageVis).visualization,
        };
      }
      return { schema: null, vis: undefined };
    };
    return {
      activeSchema: findMessageData(selectedMessageId).schema,
      activeVisualization: findMessageData(selectedMessageId).vis,
    };
  })();
```

- [ ] **Step 3: Update useEffect for auto-selection**

Replace lines 30-39 (the `useEffect` for `selectedMessageId`):

```typescript
  useEffect(() => {
    if (!selectedMessageId) {
      const lastAssistantWithData = [...chat.messages].reverse().find(
        m => m.role === 'assistant' && (m.uiSchema || (m as ChatMessageVis).visualization)
      );
      if (lastAssistantWithData) {
        setSelectedMessageId(lastAssistantWithData.id);
      }
    }
  }, [chat.messages, selectedMessageId]);
```

- [ ] **Step 4: Update handleSelectMessage**

Replace lines 42-46:

```typescript
  const handleSelectMessage = useCallback((msg: ChatMessageVis) => {
    if (msg.uiSchema || msg.visualization) {
      setSelectedMessageId(prev => prev === msg.id ? null : msg.id);
    }
  }, []);
```

- [ ] **Step 5: Update RenderArea props on line 116**

```typescript
// OLD: <RenderArea schema={activeSchema as Parameters<typeof RenderArea>[0]['schema']} isLoading={chat.isLoading} />
// NEW:
            <RenderArea
              schema={activeSchema as Parameters<typeof RenderArea>[0]['schema']}
              isLoading={chat.isLoading}
              visualization={activeVisualization}
            />
```

- [ ] **Step 6: Verify build**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx next build 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/app/page.tsx && git commit -m "feat: switch to useChatStream for Sandpack visualization support"
```

---

### Task 9: Update chat-panel.tsx — accept new message type

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`

- [ ] **Step 1: Update import**

Change line 9:

```typescript
// OLD: import type { ChatMessage } from '@/lib/chat/use-chat';
// NEW:
import type { ChatMessageVis } from '@/lib/chat/use-chat-stream';
```

- [ ] **Step 2: Update props type**

Change lines 12-17:

```typescript
type ChatPanelProps = {
  messages: ChatMessageVis[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  clearMessages: () => void;
};
```

- [ ] **Step 3: Update message selection check in onSelectMessage**

Change line 58:

```typescript
// OLD: if (msg.uiSchema) {
// NEW:
          if (msg.uiSchema || msg.visualization) {
```

- [ ] **Step 4: Verify build**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx next build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/components/chat/chat-panel.tsx && git commit -m "feat: update chat-panel to use ChatMessageVis type"
```

---

### Task 10: Update message-item.tsx — show visualization indicator

**Files:**
- Modify: `src/components/chat/message-item.tsx`

- [ ] **Step 1: Update import**

Change line 7:

```typescript
// OLD: import type { ChatMessage } from '@/lib/chat/use-chat';
// NEW:
import type { ChatMessageVis } from '@/lib/chat/use-chat-stream';
```

- [ ] **Step 2: Update props**

Change line 10:

```typescript
type MessageItemProps = {
  message: ChatMessageVis;
  isSelected?: boolean;
  onClick?: (message: ChatMessageVis) => void;
};
```

- [ ] **Step 3: Update clickable check**

Change lines 22-28 (the `className` and `onClick`):

The `className` on line 22 — change the uiSchema check:
```
// OLD: ${!isUser && message.uiSchema ? 'cursor-pointer hover:bg-muted/50 rounded-lg p-1 -mx-1' : ''}
// NEW:
${!isUser && (message.uiSchema || message.visualization) ? 'cursor-pointer hover:bg-muted/50 rounded-lg p-1 -mx-1' : ''}
```

Line 23-26 — change the onClick condition:
```typescript
// OLD: if (!isUser && message.uiSchema && onClick) {
// NEW:
        if (!isUser && (message.uiSchema || message.visualization) && onClick) {
```

- [ ] **Step 4: Verify build**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx next build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/components/chat/message-item.tsx && git commit -m "feat: update message-item to detect visualization messages"
```

---

### Task 11: Update message-list.tsx — propagate new types

**Files:**
- Modify: `src/components/chat/message-list.tsx`

- [ ] **Step 1: Read the file to understand its structure**

```bash
cat src/components/chat/message-list.tsx
```

Then update the import from `ChatMessage` to `ChatMessageVis` and propagate through the component props. The changes follow the same pattern as chat-panel and message-item.

- [ ] **Step 2: Verify build**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx next build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add src/components/chat/message-list.tsx && git commit -m "feat: update message-list to use ChatMessageVis type"
```

---

### Task 12: Full build verification + smoke test

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npx next build 2>&1
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run lint**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npm run lint 2>&1
```

- [ ] **Step 3: Start dev server and test manually**

```bash
cd C:/Users/chenyan/cy-test/chatBI && npm run dev
```

Test cases to verify:
1. "各部门成交情况" → AI should generate a bar chart via Sandpack
2. "成交排行榜" → AI should generate a horizontal bar chart
3. "你好" → Should fall back to legacy greeting response (no Sandpack)
4. "分析趋势" → AI should generate a line chart
5. "各部门占比" → AI should generate a pie chart

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
cd C:/Users/chenyan/cy-test/chatBI && git add -A && git commit -m "fix: address build issues from integration"
```

---

## Self-Review

### Spec Coverage
- 3.1 generateVisualization tool → Task 2
- 3.2 Route handler → Task 6
- 3.3 System prompt → Task 3
- 3.4 Dependency management strategy → Task 2 (dependencies param) + Task 4 (BASE_DEPS merge)
- 3.5 SandpackRenderer → Task 4
- 3.6 RenderArea integration → Task 7
- 3.7 useChatStream → Task 5
- File change list: all 4 new + 3 modified files covered
- Migration steps: Sandpack install (Task 1), tool+prompt (Task 2-3), client (Task 4-5), integration (Task 6-9)
- Fallback preserved: Legacy SSE handler kept in route.ts when no data

### Placeholder Scan
- No TBD/TODO (except one intentional `loadSessionMessages` stub marked with TODO in useChatStream — this is acceptable as session loading is out of scope for this feature)
- All code blocks contain complete implementation

### Type Consistency
- `VisualizationData` type defined in both `use-chat-stream.ts` (exported) and `render-area.tsx` (local) — intentionally duplicated to avoid coupling between hook and component; shape is identical
- `ChatMessageVis` exported from `use-chat-stream.ts`, imported in `chat-panel.tsx`, `message-item.tsx`, `message-list.tsx`, and `page.tsx`
- Tool execute returns `{ type, title, description, code, dependencies }` matching `VisualizationData` shape
