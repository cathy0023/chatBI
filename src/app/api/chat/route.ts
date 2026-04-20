import { NextRequest } from 'next/server';
import { ensureSession, persistMessage } from '@/lib/chat/session';
import { createSSEStream } from '@/lib/chat/sse-helper';
import { NL2SQLEngine } from '@/lib/semantic/nl2sql';
import { getDb } from '@/lib/db/connection';
import { generateTextCompat } from '@/lib/llm/provider';
import { generateChartCode } from '@/lib/chart/code-generator';
import { getSession, updateSessionTitle } from '@/lib/db/queries';

const GREETING_PATTERN = /^(你好|hi|hello|嗨|hey|哈喽|早上好|下午好|晚上好|您好)\s*[!.?？。！]?\s*$/i;

const GREETING_RESPONSE = '你好！我是 ChatBI 销售数据分析助手。你可以问我关于销售业绩的问题，比如：\n\n- **9月成交top5的销售**\n- **各部门成交汇总**\n- **每月成交趋势**\n\n试试看吧！';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId } = body as { message: string; sessionId?: string };

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const sid = ensureSession(sessionId);
    persistMessage(sid, 'user', message);

    return createSSEStream(async (send) => {
      send('session', { sessionId: sid });

      // Auto-generate session title from first user message
      if (!GREETING_PATTERN.test(message.trim())) {
        try {
          const session = getSession(sid);
          if (!session?.title) {
            const title = message.length > 30 ? message.slice(0, 30) + '…' : message;
            updateSessionTitle(sid, title);
          }
        } catch { /* non-critical */ }
      }

      // Greeting fast-path
      if (GREETING_PATTERN.test(message.trim())) {
        send('text', { text: GREETING_RESPONSE });
        persistMessage(sid, 'assistant', GREETING_RESPONSE);
        send('done', {});
        return;
      }

      // === Single Pipeline ===

      // Phase 1: Generate SQL
      send('status', { phase: 'generating_sql' });
      const db = getDb();
      const engine = new NL2SQLEngine(db);
      const result = await engine.query(message);

      // No results
      if (result.records.length === 0) {
        send('text', { text: '抱歉，没有找到相关的销售数据。请尝试换个关键词，例如部门名称、人员姓名或月份。' });
        persistMessage(sid, 'assistant', '抱歉，没有找到相关的销售数据。');
        send('done', {});
        return;
      }

      // Phase 2: Send data
      send('status', { phase: 'executing' });
      send('data', {
        sql: result.sql,
        records: result.records,
        columns: result.columns,
      });

      // Phase 3: Generate analysis text
      send('status', { phase: 'analyzing' });
      let analysisText = '';
      try {
        const analysisResult = await generateTextCompat({
          prompt: `你是销售数据分析助手。根据数据回答用户问题，简洁清晰，不超过200字。

用户问题: ${message}
数据（最多30条）: ${JSON.stringify(result.records.slice(0, 30))}

直接回答问题，提取关键指标和趋势。`,
        });
        analysisText = analysisResult.text;
      } catch {
        analysisText = '';
      }
      // Ensure non-empty analysis text
      if (!analysisText || analysisText.trim().length === 0) {
        analysisText = `查询到 ${result.records.length} 条数据。`;
      }
      send('text', { text: analysisText });

      // Phase 4: Generate chart
      send('status', { phase: 'generating_chart' });
      try {
        const chartHtml = await generateChartCode(message, result.records, result.columns);
        if (chartHtml) {
          send('chart', { html: chartHtml });
        }
      } catch (err) {
        console.error('[Chat] Chart generation failed:', err);
      }

      // Done
      persistMessage(sid, 'assistant', analysisText);
      send('done', {});
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
