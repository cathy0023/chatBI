# ChatBI 嵌入抽屉改造设计

## 背景

当前 ChatBI 嵌入抽屉（ChatBIAnalysisDrawer.vue）存在两个问题：
1. **视觉不统一**：iframe 内的 embed-client.tsx 完全自己写了一套 UI，和主界面 ChatPanel/MessageList/ChatInput 组件完全不同
2. **抽屉体验差**：尺寸固定，不能最大化，用户体验受限

## 目标

1. embed 界面复用主界面组件，保持样式视觉一致
2. 抽屉默认小尺寸（400×560px），可自由拖拽调整大小，可最大化到全屏
3. 保留窗口关闭功能

---

## 一、ChatBI 侧改造

### 1.1 MessageItem 增加内嵌图表模式

**文件：** `src/components/chat/message-item.tsx`

MessageItem 当前只有文本消息内容。改造后支持图表内嵌展示：

```tsx
interface MessageItemProps {
  // ... 现有 props
  inlineChart?: boolean; // 新增：true 时图表内嵌在消息下方
}
```

- `inlineChart={false}`（默认）：主界面行为不变，图表走 RenderArea
- `inlineChart={true}`：embed 行为，图表内嵌在消息气泡下方，通过 iframe srcDoc 渲染

图表渲染使用和当前 embed-client 相同的模式：

```tsx
{message.chartHtml && inlineChart && (
  <div className="mt-2 border rounded overflow-hidden">
    <iframe
      srcDoc={message.chartHtml}
      className="w-full border-0"
      style={{ height: '280px' }}
      title="chart"
    />
  </div>
)}
```

### 1.2 MessageList 透传 inlineChart

**文件：** `src/components/chat/message-list.tsx`

`MessageList` 组件新增 `inlineChart` prop，透传给每个 `MessageItem`。

### 1.3 ChatPanel 新增 inlineChart prop

**文件：** `src/components/chat/chat-panel.tsx`

`ChatPanel` 新增 `inlineChart?: boolean` prop，透传给 `MessageList`。

### 1.4 抽取 useEmbedChat Hook

**文件：** `src/lib/chat/use-embed-chat.ts`（新建）

embed-client 的 SSE 解析逻辑抽取为独立 hook，供 embed-client 调用：

```tsx
export function useEmbedChat(records: Record<string, unknown>[], columns: string[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    // SSE 解析逻辑（从 embed-client.tsx 迁移）
  }, [records, columns]);

  return { messages, isLoading, error, sendMessage };
}
```

### 1.5 embed-client 重构

**文件：** `src/app/embed/page.tsx`（或 `src/app/embed/layout.tsx`）

删除 embed-client.tsx 的自定义消息渲染逻辑，替换为：

```tsx
import { ChatPanel } from '@/components/chat/chat-panel';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';
import { useEmbedChat } from '@/lib/chat/use-embed-chat';

export default function EmbedPage() {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    const cleanup = setupMGVMessageHandler((recs, cols) => {
      setRecords(recs);
      setColumns(cols);
    });
    window.parent.postMessage({ type: 'CHATBI_READY' }, '*');
    return cleanup;
  }, []);

  const chat = useEmbedChat(records, columns);

  if (records.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">等待数据...</div>
      </div>
    );
  }

  return (
    <ChatPanel
      messages={chat.messages}
      isLoading={chat.isLoading}
      error={chat.error}
      sendMessage={chat.sendMessage}
      clearMessages={() => {}}
      inlineChart={true}
    />
  );
}
```

---

## 二、Vue 侧改造（抽屉组件）

### 2.1 尺寸状态机

**状态定义：**

```js
data() {
  return {
    drawerMode: 'normal',       // 'normal' | 'maximized'
    savedDrawerX: 0,             // 最大化前的位置
    savedDrawerY: 0,
    savedDrawerW: 400,
    savedDrawerH: 560,
  }
}
```

### 2.2 normal 状态

- 初始尺寸：400×560px
- 初始位置：右下角（`drawerX = window.innerWidth - 440`）
- 使用 vue-drag-resize，可自由拖拽和调整大小
- 头部操作按钮：最大化 + 关闭

### 2.3 maximized 状态

- 尺寸：`100vw × 100vh`，覆盖整个视口
- 不使用 vue-drag-resize，直接固定全屏
- 遮罩层：`<div class="chatbi-drawer-overlay">` 在抽屉后方，`position: fixed; inset: 0; background: rgba(0,0,0,0.4)`
- 头部操作按钮：还原 + 关闭
- 点击遮罩 → 还原到 normal

### 2.4 模板结构

```vue
<template>
  <!-- normal 状态：遮罩隐藏 -->
  <div v-if="visible" class="chatbi-drawer-mask">
    <!-- 最大化遮罩层 -->
    <div v-if="drawerMode === 'maximized'" class="chatbi-drawer-overlay" @click="handleRestore" />

    <!-- maximized 状态：全屏 div -->
    <div v-if="drawerMode === 'maximized'" class="chatbi-drawer chatbi-drawer-maximized">
      <div class="chatbi-drawer-header">
        <span>AI 数据分析</span>
        <div class="chatbi-drawer-actions">
          <el-button @click="handleRestore" title="还原"><i class="el-icon-copy-document" /></el-button>
          <el-button @click="handleClose" title="关闭"><i class="el-icon-close" /></el-button>
        </div>
      </div>
      <div class="chatbi-drawer-body">
        <iframe :src="iframeSrc" frameborder="0" class="chatbi-iframe" />
      </div>
    </div>

    <!-- normal 状态：vue-drag-resize 可拖拽 -->
    <vue-drag-resize v-else :w="drawerW" :h="drawerH" :x="drawerX" :y="drawerY"
      :z="9999" :resizable="true" :draggable="true" :parent-limitation="false"
      class="chatbi-drawer"
      @resizing="onResize" @dragging="onDrag">
      <!-- 同现有头部 + iframe -->
    </vue-drag-resize>
  </div>
</template>
```

### 2.5 关键方法

```js
handleMaximize() {
  // 保存当前尺寸和位置
  this.savedDrawerW = this.drawerW;
  this.savedDrawerH = this.drawerH;
  this.savedDrawerX = this.drawerX;
  this.savedDrawerY = this.drawerY;
  this.drawerMode = 'maximized';
},

handleRestore() {
  this.drawerW = this.savedDrawerW;
  this.drawerH = this.savedDrawerH;
  this.drawerX = this.savedDrawerX;
  this.drawerY = this.savedDrawerY;
  this.drawerMode = 'normal';
},

handleClose() {
  this.drawerMode = 'normal'; // 重置状态
  this.$emit('update:visible', false);
}
```

---

## 三、实现顺序

1. **ChatBI 侧**：MessageItem → MessageList → ChatPanel → useEmbedChat → embed-client 重构
2. **Vue 侧**：ChatBIAnalysisDrawer 尺寸状态机 + 最大化 UI
3. **验证**：E2E 测试端到端流程

---

## 四、风险点

1. **MessageItem 图表内嵌样式**：需要和主界面 RenderArea 图表样式一致（高度 280px vs RenderArea 的自适应高度）
2. **iframe 全屏性能**：最大化时 iframe 切换路径（normal 用 `/chatbi/embed`，maximized 保持同一 URL）
3. **遮罩点击关闭 vs 还原**：点击遮罩还原到 normal 而不是关闭抽屉（用户需明确点击关闭按钮关闭）
