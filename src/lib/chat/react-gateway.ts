import { executeReActLoop } from './react-executor';
import { persistMessage, loadSessionMessages } from './session';
import { getSession, updateSessionTitle } from '@/lib/db/queries';
import type { RequestContext, ToolContext, ChatMessage, ReActResult } from './types';
import type { SSESender } from './sse-helper';

const GREETING_PATTERN = /^(你好|hi|hello|嗨|hey|哈喽|早上好|下午好|晚上好|您好)\s*[!.?？。！]?\s*$/i;

const GREETING_RESPONSE = '你好！我是 ChatBI 销售数据分析助手。你可以问我关于销售业绩的问题，比如：\n\n- **9月成交top5的销售**\n- **各部门成交汇总**\n- **每月成交趋势**\n\n试试看吧！';

/**
 * Extract query context from the most recent assistant message that has SQL data.
 * This provides the LLM with awareness of what was previously queried,
 * so it can correctly resolve follow-up intents (e.g., "右侧没展示出来" →
 * the user wants to see the previous person's chart, not aggregate data).
 */
function extractPreviousQueryContext(
  historyRows: Array<{ role: string; content: string; ui_schema?: string | null }>,
): { sql: string; query: string } | null {
  // Walk backwards to find the last assistant message with SQL data
  for (let i = historyRows.length - 1; i >= 0; i--) {
    const row = historyRows[i];
    if (row.role !== 'assistant' || !row.ui_schema) continue;

    try {
      const parsed = JSON.parse(row.ui_schema);
      if (parsed.sql && parsed.sql !== '-- fallback: no results') {
        // Find the user query that preceded this assistant message
        let query = '';
        for (let j = i - 1; j >= 0; j--) {
          if (historyRows[j].role === 'user') {
            query = historyRows[j].content;
            break;
          }
        }
        return { sql: parsed.sql, query };
      }
    } catch { /* ignore malformed ui_schema */ }
  }
  return null;
}

export class ReActGateway {
  async execute(
    message: string,
    ctx: RequestContext,
    send: SSESender,
    // 嵌入模式：MGV iframe postMessage 传来的数据
    embeddedData?: { records: Record<string, unknown>[]; columns: string[]; mgvContext?: ToolContext['mgvContext'] },
  ): Promise<void> {
    const trimmed = message.trim();
    const isEmbedded = !!embeddedData;

    // 嵌入模式下跳过 greeting 持久化（无 session 概念）
    if (GREETING_PATTERN.test(trimmed)) {
      send('text', { text: GREETING_RESPONSE });
      if (!isEmbedded) persistMessage(ctx.sessionId, 'assistant', GREETING_RESPONSE);
      send('done', {});
      return;
    }

    // 嵌入模式下跳过 session title 自动生成
    if (!isEmbedded && !GREETING_PATTERN.test(trimmed)) {
      try {
        const session = getSession(ctx.sessionId);
        if (!session?.title) {
          const title = message.length > 30 ? message.slice(0, 30) + '…' : message;
          updateSessionTitle(ctx.sessionId, title);
        }
      } catch { /* non-critical */ }
    }

    // Load chat history（嵌入模式下跳过）
    let history: ChatMessage[] = [];
    let previousQueryContext: { sql: string; query: string } | null = null;
    if (!isEmbedded) {
      const historyRows = loadSessionMessages(ctx.sessionId);
      history = historyRows
        .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
        .map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
      previousQueryContext = extractPreviousQueryContext(
        historyRows as Array<{ role: string; content: string; ui_schema?: string | null }>,
      );
    }

    // Build tool context（嵌入模式下预填充数据）
    const toolCtx: ToolContext = {
      tenant: ctx.tenant,
      sessionId: ctx.sessionId,
      send,
      data: embeddedData?.records ?? [],
      columns: embeddedData?.columns ?? [],
      originalQuery: message,
      dataSource: isEmbedded ? 'embedded' : 'local',
      mgvContext: embeddedData?.mgvContext,
    };

    // Execute ReAct loop
    let result: ReActResult;
    try {
      result = await executeReActLoop(message, history, toolCtx, previousQueryContext, embeddedData);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ReActGateway] executeReActLoop failed:', errorMsg);
      send('text', { text: `处理出错：${errorMsg}，请重试。` });
      send('done', {});
      return;
    }

    // Handle empty result (e.g., LLM timeout)
    if (!result.text && result.steps.length === 0) {
      send('text', { text: '请求超时，请重试。' });
      send('done', {});
      return;
    }

    // Handle case where LLM called tools but didn't generate final text
    if (!result.text && result.steps.length > 0) {
      send('text', { text: '已完成数据查询，请查看右侧数据结果。' });
    }

    // Send events in the correct order: text → data → chart → done.
    if (result.text) {
      send('text', { text: result.text });
    }

    // Send accumulated data from all queryTool calls
    if (toolCtx.data.length > 0) {
      send('data', {
        sql: toolCtx.sql,
        records: toolCtx.data,
        columns: toolCtx.columns,
      });
    }

    // Send chart after data
    if (toolCtx.chartHtml) {
      send('chart', { html: toolCtx.chartHtml });
    }

    // 嵌入模式下跳过 session 持久化
    if (!isEmbedded) {
      const chartData = toolCtx.chartHtml || toolCtx.sql
        ? JSON.stringify({
            chartHtml: toolCtx.chartHtml || null,
            records: toolCtx.data.length > 0 ? toolCtx.data : null,
            columns: toolCtx.columns.length > 0 ? toolCtx.columns : null,
            sql: toolCtx.sql || null,
          })
        : undefined;
      persistMessage(ctx.sessionId, 'assistant', result.text, chartData);
    }

    send('done', {});
  }
}
