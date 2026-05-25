# ChatBI 嵌入 MGV AI — iframe + postMessage 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能在 MGV AI（Vue 2.7）的数据页面上直接使用 ChatBI 做 AI 分析，无需切换应用。MGV 通过 postMessage 把页面数据传给 ChatBI iframe，ChatBI 直接分析，跳过 NL2SQL 查询。

**Architecture:** iframe 嵌入模式 — MGV AI 在页面内嵌入 ChatBI 的 `/embed` 路由，通过 `window.postMessage` 传递 `records` + `columns`。ChatBI 收到数据后直接走 ReAct 管道，queryTool 被跳过，数据直接进入 analysisTool/chartTool。

**Tech Stack:** Next.js (App Router)、React、TypeScript、Vercel AI SDK

---

## Task 1: 创建 MGV postMessage 处理器

**Files:**
- Create: `src/lib/mgv/message-handler.ts`
- Create: `src/lib/mgv/types.ts`
- Test: `tests/unit/mgv/message-handler.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/unit/mgv/message-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';

const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
  });
  mockAddEventListener.mockClear();
  mockRemoveEventListener.mockClear();
});

it('注册 window.addEventListener 并在收到 MGV_TABLE_DATA 时调用回调', () => {
  const records = [{ name: '张三', deal: 100 }];
  const columns = ['name', 'deal'];
  const callback = vi.fn();

  const cleanup = setupMGVMessageHandler(callback);
  expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));

  // 模拟 postMessage 事件
  const handler = mockAddEventListener.mock.calls[0][1];
  const event = new MessageEvent('message', {
    data: { type: 'MGV_TABLE_DATA', records, columns },
  });
  handler(event);

  expect(callback).toHaveBeenCalledWith(records, columns);
  cleanup();
  expect(mockRemoveEventListener).toHaveBeenCalledWith('message', expect.any(Function));
});

it('忽略非 MGV_TABLE_DATA 消息', () => {
  const callback = vi.fn();
  const cleanup = setupMGVMessageHandler(callback);

  const handler = mockAddEventListener.mock.calls[0][1];
  const event = new MessageEvent('message', { data: { type: 'OTHER' } });
  handler(event);

  expect(callback).not.toHaveBeenCalled();
  cleanup();
});

it('忽略无 type 字段的消息', () => {
  const callback = vi.fn();
  const cleanup = setupMGVMessageHandler(callback);

  const handler = mockAddEventListener.mock.calls[0][1];
  const event = new MessageEvent('message', { data: {} });
  handler(event);

  expect(callback).not.toHaveBeenCalled();
  cleanup();
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/mgv/message-handler.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: 创建类型文件**

```typescript
// src/lib/mgv/types.ts
export interface MGVMessage {
  type: 'MGV_TABLE_DATA';
  records: Record<string, unknown>[];
  columns: string[];
  context?: {
    page?: string;
    kanbanId?: number;
    configId?: number;
  };
}

export interface MGVTableData {
  records: Record<string, unknown>[];
  columns: string[];
  context?: MGVMessage['context'];
}
```

- [ ] **Step 4: 创建 message-handler.ts**

```typescript
// src/lib/mgv/message-handler.ts
import type { MGVMessage } from './types';

/**
 * 设置 window.addEventListener('message', ...) 监听 MGV iframe 发来的数据。
 * 返回 cleanup 函数，调用后移除监听器。
 */
export function setupMGVMessageHandler(
  onData: (records: Record<string, unknown>[], columns: string[], context?: MGVMessage['context']) => void,
): () => void {
  function handler(e: MessageEvent) {
    const data = e.data as MGVMessage;
    if (data?.type === 'MGV_TABLE_DATA') {
      onData(data.records ?? [], data.columns ?? [], data.context);
    }
  }

  window.addEventListener('message', handler);

  return () => {
    window.removeEventListener('message', handler);
  };
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run tests/unit/mgv/message-handler.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/mgv/message-handler.ts src/lib/mgv/types.ts tests/unit/mgv/message-handler.test.ts
git commit -m "feat(embed): add MGV postMessage handler"
```

---

## Task 2: 修改 ToolContext 支持嵌入模式

**Files:**
- Modify: `src/lib/chat/types.ts:37-51`

- [ ] **Step 1: 读 types.ts 确认当前结构**

types.ts:37-51 — `ToolContext` 接口，当前无 `dataSource` 字段。

- [ ] **Step 2: 修改 ToolContext**

在 `ToolContext` 中新增三个字段：

```typescript
// src/lib/chat/types.ts — 在 ToolContext 接口末尾添加

  /** 数据来源模式：'local' = 通过 NL2SQL 查询（默认），'embedded' = MGV iframe postMessage */
  dataSource?: 'local' | 'embedded';
  /** 嵌入模式下 MGV 传入的页面上下文 */
  mgvContext?: {
    page?: string;
    kanbanId?: number;
    configId?: number;
  };
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/lib/chat/types.ts
git commit -m "feat(embed): add dataSource and mgvContext to ToolContext"
```

---

## Task 3: 修改 ReAct 执行器 — 嵌入模式下跳过 queryTool

**Files:**
- Modify: `src/lib/chat/react-executor.ts`

- [ ] **Step 1: 读 react-executor.ts 确认当前结构**

react-executor.ts:22-26 — 当前工具列表：

```typescript
const tools = {
  queryTool: createQueryTool(ctx),
  analysisTool: createAnalysisTool(ctx),
  chartTool: createChartTool(ctx),
};
```

- [ ] **Step 2: 修改 react-executor.ts — 条件注册工具**

在 `executeReActLoop` 函数签名中新增可选参数 `embeddedData?: { records: Record<string, unknown>[]; columns: string[] }`。

```typescript
// src/lib/chat/react-executor.ts

export async function executeReActLoop(
  message: string,
  history: ChatMessage[],
  ctx: ToolContext,
  previousQueryContext?: { sql: string; query: string } | null,
  // 新增：嵌入模式预填充数据
  embeddedData?: { records: Record<string, unknown>[]; columns: string[] },
): Promise<ReActResult> {
  // 如果是嵌入模式，预填充 ctx.data 和 ctx.columns
  if (embeddedData) {
    ctx.data = embeddedData.records;
    ctx.columns = embeddedData.columns;
  }

  // 嵌入模式下不注册 queryTool（数据已预填充）
  const tools: Record<string, ReturnType<typeof createQueryTool | typeof createAnalysisTool | typeof createChartTool>> = {};
  if (!embeddedData) {
    tools.queryTool = createQueryTool(ctx);
  }
  tools.analysisTool = createAnalysisTool(ctx);
  tools.chartTool = createChartTool(ctx);
  // ...
}
```

- [ ] **Step 3: 修改 chartTool description（条件化）**

嵌入模式下 chartTool 的 description 不需要提示"需要先通过 queryTool 获取数据"。在 `createChartTool` 中根据 `ctx.dataSource` 调整。

实际上 `createChartTool` 的 description 是硬编码的，无需修改——因为在嵌入模式下，LLM 看到 ctx.data 已经有数据，调用 chartTool 自然成功。

- [ ] **Step 4: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: 提交**

```bash
git add src/lib/chat/react-executor.ts
git commit -m "feat(embed): skip queryTool in embedded mode"
```

---

## Task 4: 创建嵌入模式 system prompt

**Files:**
- Create: `src/lib/chat/prompts/embedded-prompt.ts`
- Test: `tests/unit/chat/prompts/embedded-prompt.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/unit/chat/prompts/embedded-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildEmbeddedSystemPrompt } from '@/lib/chat/prompts/embedded-prompt';

describe('buildEmbeddedSystemPrompt', () => {
  it('包含嵌入模式说明和禁止 NL2SQL 的规则', () => {
    const prompt = buildEmbeddedSystemPrompt();
    expect(prompt).toContain('MGV');
    expect(prompt).toContain('无需调用 queryTool');
    expect(prompt).toContain('数据已直接提供');
  });

  it('不包含 queryTool 的描述', () => {
    const prompt = buildEmbeddedSystemPrompt();
    expect(prompt).not.toContain('queryTool');
    expect(prompt).not.toContain('NL2SQL');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/chat/prompts/embedded-prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: 创建 embedded-prompt.ts**

```typescript
// src/lib/chat/prompts/embedded-prompt.ts
/**
 * 嵌入模式 system prompt（MGV iframe 场景）。
 * 与 buildSystemPrompt 的区别：数据已通过 postMessage 直接提供，无需调用 queryTool。
 */
export function buildEmbeddedSystemPrompt(): string {
  return `你是数据分析助手。

MGV AI 已通过 iframe 传递了当前页面的数据（records + columns），数据已直接加载到上下文中。

你可以使用以下工具：

1. **analysisTool**: 分析已提供的数据，生成洞察和总结。
   - 用于：趋势分析、排名对比、异常发现

2. **chartTool**: 生成可视化图表（柱状图、折线图、饼图等）。

工作流程：
1. 直接调用 analysisTool 生成文字洞察
2. 根据需要调用 chartTool 生成图表
3. 综合给出完整回答

规则：
- 引用的数字必须与已提供的数据完全一致
- 不要自行计算或推测
- 控制在 300 字以内
- 直接回答用户问题
- **禁止调用 queryTool**（数据已直接提供，无需 NL2SQL 查询）
- **必须生成最终文字回答**
`;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/unit/chat/prompts/embedded-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/chat/prompts/embedded-prompt.ts tests/unit/chat/prompts/embedded-prompt.test.ts
git commit -m "feat(embed): add embedded system prompt variant"
```

---

## Task 5: 修改 react-gateway 支持嵌入模式

**Files:**
- Modify: `src/lib/chat/react-gateway.ts`

- [ ] **Step 1: 读 react-gateway.ts 确认当前结构**

react-gateway.ts:44-98 — `execute()` 方法中构建 `toolCtx` 和调用 `executeReActLoop` 的位置。

- [ ] **Step 2: 在 ReActGateway.execute 签名中新增 `embeddedData` 参数**

在 `execute` 方法签名中加入可选参数：

```typescript
async execute(
  message: string,
  ctx: RequestContext,
  send: SSESender,
  // 新增：嵌入模式预填充数据（来自 MGV postMessage）
  embeddedData?: { records: Record<string, unknown>[]; columns: string[]; mgvContext?: ToolContext['mgvContext'] },
): Promise<void> {
```

- [ ] **Step 3: 修改 toolCtx 构建逻辑**

在 `execute` 方法中找到构建 `toolCtx` 的代码：

```typescript
// react-gateway.ts:86-93 附近 — 替换现有 toolCtx 构建
const toolCtx: ToolContext = {
  tenant: ctx.tenant,
  sessionId: ctx.sessionId,
  send,
  data: embeddedData?.records ?? [],
  columns: embeddedData?.columns ?? [],
  originalQuery: message,
  dataSource: embeddedData ? 'embedded' : 'local',
  mgvContext: embeddedData?.mgvContext,
};
```

- [ ] **Step 4: 修改 executeReActLoop 调用，传递 embeddedData**

```typescript
// react-gateway.ts:98 附近 — 替换 executeReActLoop 调用
result = await executeReActLoop(
  message,
  embeddedData ? [] : history,  // 嵌入模式：跳过 history
  toolCtx,
  null,                          // 嵌入模式：无 previousQueryContext
  embeddedData,                  // 传递嵌入数据
);
```

- [ ] **Step 5: 修改 greeting 逻辑 — 嵌入模式下仍需 greeting 响应**

嵌入模式下用户仍需打招呼，但不需要检查历史 session。greeting 检测逻辑不需要改，但需要传入空 history。

实际上 greeting 检测不需要 history — 它用正则判断即可，所以 `embeddedData ? [] : history` 是正确的。

- [ ] **Step 6: 去掉 greeting 检测后创建 session title 的逻辑（嵌入模式下跳过）**

```typescript
// 在 execute 方法开头
const isEmbedded = !!embeddedData;

if (GREETING_PATTERN.test(trimmed)) {
  send('text', { text: GREETING_RESPONSE });
  if (!isEmbedded) persistMessage(ctx.sessionId, 'assistant', GREETING_RESPONSE);
  send('done', {});
  return;
}

// 嵌入模式下跳过 session title 自动生成（无历史记录）
if (!isEmbedded && !GREETING_PATTERN.test(trimmed)) {
  // ...
}
```

- [ ] **Step 7: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: 提交**

```bash
git add src/lib/chat/react-gateway.ts
git commit -m "feat(embed): support embedded mode in ReActGateway"
```

---

## Task 6: 创建 /embed 路由和嵌入页面组件

**Files:**
- Create: `src/app/embed/page.tsx` — Next.js App Router 页面
- Create: `src/components/embed/embed-client.tsx` — 客户端嵌入组件
- Test: `tests/unit/embed/embed-client.test.tsx`（使用 @testing-library/react）

- [ ] **Step 1: 写测试（embed-client）**

```tsx
// tests/unit/embed/embed-client.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmbedClient } from '@/components/embed/embed-client';
import * as messageHandler from '@/lib/mgv/message-handler';

vi.mock('@/lib/mgv/message-handler');

describe('EmbedClient', () => {
  it('初始状态显示"等待数据..."', () => {
    render(<EmbedClient />);
    expect(screen.getByText('等待数据...')).toBeInTheDocument();
  });

  it('收到 MGV_TABLE_DATA 后显示聊天界面', async () => {
    const mockRecords = [{ name: '张三', deal: 100 }];
    const mockColumns = ['name', 'deal'];

    // 模拟 setupMGVMessageHandler 返回 cleanup 函数
    vi.mocked(messageHandler.setupMGVMessageHandler).mockImplementation((callback) => {
      // 立即触发回调，模拟数据已收到
      setTimeout(() => callback(mockRecords, mockColumns), 0);
      return vi.fn();
    });

    render(<EmbedClient />);

    // 等待数据加载完成
    await waitFor(() => {
      expect(screen.queryByText('等待数据...')).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/embed/embed-client.test.tsx`
Expected: FAIL — file not found

- [ ] **Step 3: 创建 embed-client.tsx**

```tsx
// src/components/embed/embed-client.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';
import type { MGVMessage } from '@/lib/mgv/types';

interface EmbedClientProps {
  /** 传递给 useChat 的初始数据 */
  onDataReady?: (records: Record<string, unknown>[], columns: string[], context?: MGVMessage['context']) => void;
}

export function EmbedClient({ onDataReady }: EmbedClientProps) {
  const [status, setStatus] = useState<'loading' | 'waiting' | 'ready' | 'error'>('waiting');
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    const cleanup = setupMGVMessageHandler((recs, cols, ctx) => {
      setRecords(recs);
      setColumns(cols);
      setStatus(recs.length === 0 ? 'waiting' : 'ready');
      onDataReady?.(recs, cols, ctx);
    });

    return cleanup;
  }, [onDataReady]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background gap-4">
        <div className="text-4xl" aria-hidden>📊</div>
        <div className="text-muted-foreground">等待数据...</div>
        <div className="text-xs text-muted-foreground">请在 MGV AI 页面打开 AI 分析</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-destructive">数据接收失败</div>
      </div>
    );
  }

  // 数据就绪后，渲染 ChatInterface（复用现有组件）
  // 渲染方式：全屏展示 ChatPanel + RenderArea，类似 Home 布局
  return (
    <EmbedChatView records={records} columns={columns} />
  );
}

// 嵌入模式下的简化聊天视图（无侧边栏、无 session 列表）
function EmbedChatView({
  records,
  columns,
}: {
  records: Record<string, unknown>[];
  columns: string[];
}) {
  // 使用现有的 useChat hook，注入初始数据
  // 注意：当前 useChat 不支持 initialData，需要修改
  // 方案：直接调用 /api/chat endpoint，不走 useChat 的流式逻辑
  // 这里用 fetch 直接实现
  const [messages, setMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; content: string; records?: Record<string, unknown>[]; columns?: string[]; chartHtml?: string }>>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    setIsLoading(true);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        embedded: true,
        records,
        columns,
      }),
    });

    if (!res.ok) {
      setIsLoading(false);
      return;
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 解析
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('event: ') && !line.startsWith('data: ')) continue;
          const [, raw] = line.split(': ');
          try {
            const event = JSON.parse(raw);
            // 更新 messages 状态
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (event.type === 'step') return prev;
              if (event.type === 'text') {
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: last.content + event.text }];
                }
                return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: event.text }];
              }
              if (event.type === 'data') {
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, records: event.records, columns: event.columns }];
                }
                return prev;
              }
              return prev;
            });
          } catch { /* ignore parse errors */ }
        }
      }
    }

    setIsLoading(false);
  }, [isLoading, records, columns]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block rounded px-3 py-2 ${m.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {isLoading && <div className="text-muted-foreground">分析中...</div>}
      </div>
      <div className="border-t p-4">
        <input
          className="w-full border rounded px-3 py-2"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { sendMessage(input); setInput(''); } }}
          placeholder="问我关于这些数据的问题..."
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
```

**重要说明：** EmbedChatView 中的 fetch 调用 `/api/chat`（POST，body 包含 `message` + `embedded: true` + `records` + `columns`），需要 Task 7 中 `route.ts` 支持嵌入模式的 POST 请求。

- [ ] **Step 4: 创建 embed/page.tsx**

```tsx
// src/app/embed/page.tsx
import { EmbedClient } from '@/components/embed/embed-client';

export default function EmbedPage() {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <EmbedClient />
    </div>
  );
}
```

- [ ] **Step 5: 运行测试验证**

Run: `npx vitest run tests/unit/embed/embed-client.test.tsx`
Expected: FAIL（因为 route.ts 还没支持 embedded 模式）

先跳过 Task 6 测试，执行 Task 7 后再回测。

- [ ] **Step 6: 提交**

```bash
git add src/app/embed/page.tsx src/components/embed/embed-client.tsx
git commit -m "feat(embed): add /embed route and embed page component"
```

---

## Task 7: 修改 API route 支持嵌入模式

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: 读 route.ts**

route.ts 当前极简（只有 `GET` 和 `POST` 两个方法，调用 `ReActGateway.execute()`）。

- [ ] **Step 2: 修改 POST handler 支持嵌入模式（复用 createSSEStream）**

当前 `route.ts` 只有 POST handler。嵌入模式下，复用 POST 但在 body 中携带 `embedded: true` + `records` + `columns`：

```typescript
// src/app/api/chat/route.ts

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId, embedded, records, columns } = body as {
      message: string;
      sessionId?: string;
      // 嵌入模式字段
      embedded?: boolean;
      records?: Record<string, unknown>[];
      columns?: string[];
    };

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    // 嵌入模式：跳过 session 创建，直接用临时 sessionId
    const sid = embedded ? ('embed-' + crypto.randomUUID()) : ensureSession(sessionId);
    if (!embedded) persistMessage(sid, 'user', message);

    return createSSEStream(async (send) => {
      if (!embedded) send('session', { sessionId: sid });

      await new ReActGateway().execute(
        message,
        { sessionId: sid, tenant: DEFAULT_TENANT, message },
        send,
        embedded ? { records: records ?? [], columns: columns ?? [] } : undefined,
      );
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

注意：`embedded` 为 true 时，跳过 `ensureSession` 和 `persistMessage`（无需持久化），同时跳过 SSE `session` 事件（无 session 概念）。

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(embed): support embedded mode in chat API route"
```

---

## Task 8: 端到端验证

**Files:**
- Create: `tests/e2e/embed-flow.spec.ts`

- [ ] **Step 1: 写 E2E 测试**

使用 Playwright，模拟 MGV postMessage 场景：

```typescript
// tests/e2e/embed-flow.spec.ts
import { test, expect } from '@playwright/test';

test('嵌入模式下收到 MGV 数据后可以正常对话', async ({ page }) => {
  // 模拟 MGV 发送数据
  await page.goto('/embed');

  // 验证初始等待状态
  await expect(page.getByText('等待数据...')).toBeVisible();

  // 注入 MGV 数据
  await page.evaluate(() => {
    window.postMessage({
      type: 'MGV_TABLE_DATA',
      records: [
        { name: '张三', department: '销售一部', deal: 50000, month: '9月' },
        { name: '李四', department: '销售一部', deal: 42000, month: '9月' },
      ],
      columns: ['name', 'department', 'deal', 'month'],
      context: { page: 'team-analysis' },
    }, '*');
  });

  // 等待数据加载完成（等待状态消失）
  await expect(page.getByText('等待数据...')).not.toBeVisible({ timeout: 5000 });

  // 输入问题
  await page.getByPlaceholder('问我关于这些数据的问题...').fill('谁的成交最高？');

  // 验证 AI 回复
  await expect(page.getByText(/张三|李四/).first()).toBeVisible({ timeout: 30000 });
});
```

- [ ] **Step 2: 启动开发服务器并运行测试**

Terminal 1:
```bash
cd /c/Users/chenyan/cy-test/chatBI && npm run dev
```

Terminal 2:
```bash
npx playwright test tests/e2e/embed-flow.spec.ts
```

Expected: PASS — 测试通过说明嵌入流程工作正常

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/embed-flow.spec.ts
git commit -m "test(embed): add E2E test for embed flow"
```

---

## 实施顺序

1. **Task 1** — MGV postMessage 处理器（独立，无依赖）
2. **Task 2** — ToolContext 新增字段（无依赖）
3. **Task 3** — react-executor 条件注册工具（依赖 Task 2）
4. **Task 4** — embedded system prompt（无依赖）
5. **Task 5** — react-gateway 嵌入模式（依赖 Task 2, 3, 4）
6. **Task 6** — /embed 路由和页面（依赖 Task 1, 5）
7. **Task 7** — API route 嵌入支持（依赖 Task 5）
8. **Task 8** — E2E 验证（依赖 Task 1-7）

## 验证命令

```bash
# 单元测试
npx vitest run

# 类型检查
npx tsc --noEmit

# E2E 测试（需要开发服务器运行）
npx playwright test tests/e2e/embed-flow.spec.ts

# 手动验证
# 1. 启动: npm run dev
# 2. 访问: http://localhost:3000/embed
# 3. 在浏览器控制台执行:
#    window.postMessage({ type: 'MGV_TABLE_DATA', records: [{name:'张三',deal:5000}], columns:['name','deal'] }, '*')
# 4. 在输入框输入问题验证 AI 回复
```
