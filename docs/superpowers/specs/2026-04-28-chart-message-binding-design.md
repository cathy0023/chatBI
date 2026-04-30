# Chart-Message Binding Design

> **Date**: 2026-04-28
> **Status**: Draft
> **Branch**: feat/streaming-generative-ui

## Problem

When users review previous questions in the chat, the right panel does not show the corresponding chart. The chart only shows the latest assistant response. Clicking a historical user message does nothing.

Additionally, when loading historical sessions, chart data (`chartHtml`, `records`, `columns`, `sql`) is lost because only `id`, `role`, and `content` are persisted and loaded.

## Goal

- Clicking a **user message** in the chat should switch the right panel to show the chart from the corresponding assistant response.
- Historical sessions should also support chart review — chart data must be persisted and restored.

## Approach: Downward Lookup

When a user message is clicked, scan forward from that message's position to find the nearest assistant message with `chartHtml` or `records`. Display that message's chart in the right panel.

This is the simplest approach that fits ChatBI's sequential Q&A conversation pattern.

## Design

### Part 1: Persist Chart Data

**Current state**: `persistMessage()` saves only `role` and `content`. The `ui_schema` column exists but is unused for chart data.

**Changes**:

1. **`src/app/api/chat/route.ts`** — When persisting assistant messages that have chart data, serialize `chartHtml`, `records`, `columns`, and `sql` into `ui_schema`:
   ```
   persistMessage(sessionId, 'assistant', text, JSON.stringify({ chartHtml, records, columns, sql }))
   ```

2. **`src/app/api/sessions/[id]/messages/route.ts`** — When loading messages, deserialize `ui_schema` and include chart fields in the response:
   ```ts
   {
     id, role, content,
     chartHtml: uiSchema?.chartHtml ?? null,
     records: uiSchema?.records ?? null,
     columns: uiSchema?.columns ?? null,
     sql: uiSchema?.sql ?? null,
   }
   ```

3. **`src/lib/chat/use-chat.ts` `loadSessionMessages`** — Parse chart fields from API response when constructing `ChatMessage` objects.

### Part 2: User Message Click → Chart Binding

**Current state**: Only assistant messages with data are clickable (`hasData` check in `message-list.tsx`).

**Changes**:

1. **`src/components/chat/message-list.tsx`**:
   - Make **user messages** clickable with `onSelectMessage`.
   - Add visual indicator (small chart icon or left border) on user messages whose corresponding assistant has chart data.
   - Highlight selected user message with background color.

2. **`src/app/page.tsx` `handleSelectMessage`**:
   - When `msg.role === 'user'`: find the message's index, scan forward to find the nearest assistant message with `records` or `chartHtml`, set that as `selectedMessageId`.
   - When `msg.role === 'assistant'` (existing behavior): directly use that message.

3. **`src/components/chat/message-item.tsx`**:
   - Add a subtle visual hint (e.g., left blue border or small icon) for user messages that have a corresponding chart.

### Part 3: Auto-Follow Behavior

**No changes needed**. Existing logic:
- Sending a new message resets to auto-follow (shows latest chart).
- Clicking any message enters manual mode (stays on selected chart).
- Sending another new message resets back to auto-follow.

## Files to Modify

| File | Change |
|------|--------|
| `src/app/api/chat/route.ts` | Serialize chart data into `persistMessage` calls |
| `src/app/api/sessions/[id]/messages/route.ts` | Deserialize `ui_schema` → chart fields |
| `src/lib/chat/use-chat.ts` | Parse chart fields in `loadSessionMessages` |
| `src/components/chat/message-list.tsx` | Make user messages clickable, add selection UI |
| `src/components/chat/message-item.tsx` | Add visual hint for user messages with charts |
| `src/app/page.tsx` | Update `handleSelectMessage` for user → assistant lookup |

## Success Criteria

1. Click user message "郑威这个销售7-10月份成交情况走势图" → right panel shows bar chart of 郑威16's data.
2. Click user message "我希望的是走势图" → right panel switches to trend chart.
3. Load historical session → click old user messages → corresponding charts appear.
4. Send new message → auto-follows latest chart (existing behavior preserved).
