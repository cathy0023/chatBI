import { executeReActLoop } from './react-executor';
import { persistMessage, loadSessionMessages } from './session';
import type { RequestContext, ToolContext, ChatMessage } from './types';
import type { SSESender } from './sse-helper';

const GREETING_PATTERN = /^(你好|hi|hello|嗨|hey|哈喽|早上好|下午好|晚上好|您好)\s*[!.?？。！]?\s*$/i;

const GREETING_RESPONSE = '你好！我是 ChatBI 销售数据分析助手。你可以问我关于销售业绩的问题，比如：\n\n- **9月成交top5的销售**\n- **各部门成交汇总**\n- **每月成交趋势**\n\n试试看吧！';

export class ReActGateway {
  async execute(
    message: string,
    ctx: RequestContext,
    send: SSESender,
  ): Promise<void> {
    const trimmed = message.trim();

    // Fast path: greeting
    if (GREETING_PATTERN.test(trimmed)) {
      send('text', { text: GREETING_RESPONSE });
      persistMessage(ctx.sessionId, 'assistant', GREETING_RESPONSE);
      send('done', {});
      return;
    }

    // Load chat history
    const historyRows = loadSessionMessages(ctx.sessionId);
    const history: ChatMessage[] = historyRows
      .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
      .map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Build tool context
    const toolCtx: ToolContext = {
      tenant: ctx.tenant,
      sessionId: ctx.sessionId,
      send,
      data: [],
      columns: [],
      originalQuery: message,
    };

    // Execute ReAct loop
    const result = await executeReActLoop(message, history, toolCtx);

    // Persist conversation
    persistMessage(ctx.sessionId, 'assistant', result.text);

    send('done', {});
  }
}
