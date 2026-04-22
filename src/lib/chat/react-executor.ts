import { generateText } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';
import { buildSystemPrompt } from './prompts/system-prompt';
import { createQueryTool } from './tools/query-tool';
import { createAnalysisTool } from './tools/analysis-tool';
import { createChartTool } from './tools/chart-tool';
import type { ToolContext, ReActResult, ChatMessage } from './types';

export async function executeReActLoop(
  message: string,
  history: ChatMessage[],
  ctx: ToolContext,
): Promise<ReActResult> {
  const systemPrompt = buildSystemPrompt(ctx.tenant);

  const messages = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  const tools = {
    queryTool: createQueryTool(ctx),
    analysisTool: createAnalysisTool(ctx),
    chartTool: createChartTool(ctx),
  };

  const result = await generateText({
    model: getDefaultModel(),
    system: systemPrompt,
    messages,
    tools,
    maxSteps: 5,
    onStepFinish: async (step) => {
      ctx.send('step', {
        type: step.toolCalls && step.toolCalls.length > 0 ? 'tool_call' : 'text',
        toolName: step.toolCalls?.[0]?.toolName,
        content: step.text,
      });
    },
  });

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
}
