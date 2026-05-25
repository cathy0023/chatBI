import { generateText, stepCountIs } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';
import { buildSystemPrompt } from './prompts/system-prompt';
import { buildEmbeddedSystemPrompt } from './prompts/embedded-prompt';
import { createQueryTool } from './tools/query-tool';
import { createAnalysisTool } from './tools/analysis-tool';
import { createChartTool } from './tools/chart-tool';
import type { ToolContext, ReActResult, ChatMessage } from './types';

export async function executeReActLoop(
  message: string,
  history: ChatMessage[],
  ctx: ToolContext,
  previousQueryContext?: { sql: string; query: string } | null,
  // 嵌入模式下预填充数据，数据已通过 postMessage 直接提供，跳过 queryTool
  embeddedData?: { records: Record<string, unknown>[]; columns: string[] },
): Promise<ReActResult> {
  // 嵌入模式：预填充 ctx.data 和 ctx.columns
  if (embeddedData) {
    ctx.data = embeddedData.records;
    ctx.columns = embeddedData.columns;
    ctx.dataSource = 'embedded';
  }

  const systemPrompt = embeddedData
    ? buildEmbeddedSystemPrompt()
    : buildSystemPrompt(ctx.tenant, previousQueryContext);

  const messages = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {
    analysisTool: createAnalysisTool(ctx),
    chartTool: createChartTool(ctx),
  };
  // 非嵌入模式才注册 queryTool
  if (!embeddedData) {
    tools.queryTool = createQueryTool(ctx);
  }

  // Timeout: 60s per generateText call to prevent SSE stream from hanging forever
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  // Propagate abort signal to tools so they can cancel internal LLM calls
  ctx.abortSignal = controller.signal;

  try {
    const result = await generateText({
      model: getDefaultModel(),
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(5),
      abortSignal: controller.signal,
      onStepFinish: async (step) => {
        ctx.send('step', {
          type: step.toolCalls && step.toolCalls.length > 0 ? 'tool_call' : 'text',
          toolName: step.toolCalls?.[0]?.toolName,
          content: step.text,
        });
      },
    });
    clearTimeout(timeout);

    const steps: ReActResult['steps'] = result.steps.map(step => ({
      type: step.toolCalls && step.toolCalls.length > 0 ? 'tool_call' : 'text',
      toolName: step.toolCalls?.[0]?.toolName,
      content: step.text,
    }));

    return {
      text: result.text,
      steps,
      toolResults: result.toolResults,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[ReActExecutor] generateText timeout after 60s');
    } else {
      console.error('[ReActExecutor] generateText error:', err instanceof Error ? err.message : String(err));
    }
    // Return empty result so gateway can send error event
    return { text: '', steps: [], toolResults: [] };
  }
}
