# ChatBI 嵌入 MGV AI — iframe + postMessage 集成方案

## Status

Draft - 待确认后实施

## Problem

ChatBI 和 MGV AI 是两个独立项目：
- **ChatBI**: React 前端，Next.js，独立部署
- **MGV AI**: Vue 2.7 后台管理页面，有复杂的数据展示页面（team-analysis 等）

目标：让用户能在 MGV AI 的数据页面上，直接用 ChatBI 做 AI 分析，**无需切换应用**。

## Decision

**iframe 嵌入 + postMessage 数据通道**：
- MGV AI 在页面内嵌入 ChatBI 的 iframe
- MGV AI 通过 postMessage 把当前页面的数据传给 ChatBI iframe
- ChatBI 收到数据后，直接走现有 ReAct 管道做分析
- **不需要 MCP Server，不需要调 API，不需要数据拉取**

## Architecture

```
用户操作流程:

MGV AI (Vue 2.7)
  → 用户在页面上操作 → API 返回数据 → 存在 Vue 组件 data 里
  → 页面上展示表格/图表
  → 用户点「AI 分析」按钮
  → ChatBI iframe 收到数据 → 直接分析 → 展示结果
```

## Integration Pattern

### MGV AI 侧（Vue 组件）

```vue
<template>
  <div>
    <!-- 原有数据展示 -->
    <data-table :data="tableData" />

    <!-- 嵌入 ChatBI iframe -->
    <button @click="openAI">AI 分析</button>
    <iframe
      v-if="showAI"
      ref="chatbiFrame"
      src="https://chatbi.example.com/embed"
      @load="onChatBILoaded"
    />
  </div>
</template>

<script>
export default {
  data() {
    return {
      tableData: [],
      columns: [],
      showAI: false,
    }
  },
  watch: {
    tableData(newVal) {
      // 数据更新时，如果有 AI 面板打开，同步传给 ChatBI
      if (this.showAI && this.$refs.chatbiFrame?.contentWindow) {
        this.$refs.chatbiFrame.contentWindow.postMessage({
          type: 'MGV_TABLE_DATA',
          records: newVal,
          columns: this.columns,
          context: {
            page: 'team-analysis',
            kanbanId: this.kanbanId,
            configId: this.configId,
          },
        }, '*')
      }
    }
  },
  methods: {
    openAI() {
      this.showAI = true
    },
    onChatBILoaded() {
      // iframe 加载完成后，立即发送当前数据
      this.$refs.chatbiFrame.contentWindow.postMessage({
        type: 'MGV_TABLE_DATA',
        records: this.tableData,
        columns: this.columns,
        context: { page: 'team-analysis' },
      }, '*')
    },
  },
}
</script>
```

### ChatBI 侧（React）

#### 新增 API endpoint

```typescript
// src/app/api/mgv-data/route.ts
// ChatBI 提供一个 /embed 路径，接收 MGV 的 postMessage

export async function GET(request: NextRequest) {
  // 返回一个嵌入专用页面，包含 postMessage listener
  return new Response(renderEmbedPage(), { headers: { 'Content-Type': 'text/html' } })
}
```

#### postMessage listener（ChatBI 内部）

```typescript
// src/lib/mgv/message-handler.ts

type MGVMessage = {
  type: 'MGV_TABLE_DATA';
  records: Record<string, unknown>[];
  columns: string[];
  context?: {
    page: string;
    kanbanId?: number;
    configId?: number;
  };
};

export function setupMGVMessageHandler(
  onData: (records: Record<string, unknown>[], columns: string[]) => void
) {
  window.addEventListener('message', (e: MessageEvent<MGVMessage>) => {
    if (e.data?.type === 'MGV_TABLE_DATA') {
      onData(e.data.records, e.data.columns)
    }
  })
}
```

#### 嵌入页面（/embed）

```tsx
// src/app/embed/page.tsx
// 轻量级嵌入页面，没有顶部导航，全屏展示 ChatBI 功能

export default function EmbedPage() {
  const [records, setRecords] = useState<Record<string, unknown>[]>([])
  const [columns, setColumns] = useState<string[]>([])

  useEffect(() => {
    setupMGVMessageHandler((recs, cols) => {
      setRecords(recs)
      setColumns(cols)
    })
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden">
      <ChatInterface
        initialData={records}
        initialColumns={columns}
        mode="embedded"  // 嵌入模式：不显示某些 UI 元素
      />
    </div>
  )
}
```

## ChatBI 内部数据流变化

```
两种数据来源并行：

1. 独立模式（原有）：
   用户输入 → queryTool → NL2SQL → SQLite → ctx.data

2. 嵌入模式（新增）：
   MGV postMessage → ChatBI 收到数据 → ctx.data

后续流程完全相同：
   ctx.data → analysisTool → chartTool → SSE → 展示
```

### 改动点

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/app/embed/page.tsx` | 新增 | 嵌入专用页面，监听 postMessage |
| `src/lib/mgv/message-handler.ts` | 新增 | postMessage 处理逻辑 |
| `src/lib/chat/types.ts` | 修改 | `ToolContext` 增加 `dataSource` 字段 |
| `src/lib/chat/react-gateway.ts` | 修改 | 嵌入模式下跳过 greeting 和 history，直接处理 MGV 数据 |
| `src/components/chat/chat-interface.tsx` | 修改 | 增加 `initialData` prop 和 `mode="embedded"` |

## ReAct Pipeline（嵌入模式）

嵌入模式下，ReAct 管道大幅简化：

```
Step 1: MGV 数据已通过 postMessage 传入 ctx.data
Step 2: LLM 直接调用 analysisTool → 分析数据，生成洞察
Step 3: LLM 调用 chartTool → 生成可视化图表
Step 4: LLM 输出总结文字
```

**queryTool 完全跳过**——数据已经有了，不需要 NL2SQL。

## System Prompt（嵌入模式）

```typescript
// 嵌入模式下切换不同的 system prompt
const EMBEDDED_SYSTEM_PROMPT = `你是数据分析助手。
MGV AI 已为你提供了当前页面的数据（records + columns）。
你的任务是：
1. 分析这些数据，提供洞察和总结
2. 生成可视化图表
3. 回答用户关于这些数据的问题

规则：
- 引用的数字必须与数据完全一致
- 不要自行计算或推测
- 控制在 300 字以内
`
```

## Error Handling

1. **MGV 未发送数据**：ChatBI embed 页面显示"等待数据..."，有加载动画
2. **MGV 数据为空**：提示"当前页面没有数据"
3. **postMessage 失败**：iframe 和父页面之间有超时检测，5s 无响应则提示
4. **Cookie 共享**：同域名下 Cookie 自然共享，不需要额外认证处理

## Security

1. **X-Frame-Options**：ChatBI 的 /embed 路径允许被 MGV AI 域名嵌入
2. **postMessage 验证**：ChatBI 只接受来自已知父窗口的消息（通过 origin 白名单）
3. **数据不持久化**：嵌入模式下数据只存在内存，不写入 SQLite，除非用户明确保存

## Open Questions

1. **MGV 数据格式**：MGV 传给 ChatBI 的数据格式是否已经是扁平的？（参考之前的 column_data API，返回的是 header+table 嵌套结构）
2. **多 Tab 支持**：如果 MGV AI 同时打开多个 Tab，ChatBI 怎么区分数据来源？
3. **数据更新同步**：MGV 页面数据刷新后，ChatBI 是否需要同步更新？
4. **Session 管理**：嵌入模式下，ChatBI 的 session 是否需要和 MGV 的登录态绑定？

## Phased Implementation

### Phase 1: 基础嵌入（2-3天）

- 新增 `/embed` 路由，返回嵌入页面
- 实现 `message-handler.ts`
- MGV 侧：Vue 组件加 iframe + postMessage 发送
- 验证数据能正确传入 ChatBI

### Phase 2: 分析能力（1-2天）

- 修改 ReAct pipeline 支持嵌入模式
- analysisTool / chartTool 验证
- 数据扁平化处理（如需要）

### Phase 3: 体验优化（1周）

- 嵌入模式 UI 优化（无顶部导航等）
- 错误处理完善
- Session 和 MGV 登录态绑定
- 测试