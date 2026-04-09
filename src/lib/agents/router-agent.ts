import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { generateText } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';

// Input: raw user message
const routerInputSchema = z.object({
  message: z.string().min(1),
  context: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
});

type RouterInput = z.infer<typeof routerInputSchema>;
type RouterOutput = {
  intent: 'query' | 'analysis' | 'generation' | 'training';
  confidence: number;
  agents: string[];
  params: Record<string, unknown>;
};

// Parse JSON from generateText response
function parseRouterResult(text: string): RouterOutput {
  const jsonStr = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
  const raw = JSON.parse(jsonStr);
  return {
    intent: raw.intent || 'query',
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.7,
    agents: Array.isArray(raw.agents) ? raw.agents : ['query'],
    params: raw.params || {},
  };
}

const ROUTER_PROMPT = `你是一个销售业绩 BI 系统的意图分类器。

数据域: 在线教育销售团队，包含姓名、部门、月份（7-10月）、加微/互动/需求/成交四个指标。

将用户消息分类为:
- "query": 查找/搜索/展示具体数据
- "analysis": 分析/对比/趋势/排行/统计/谁最好/谁最多
- "generation": 生成/创建内容
- "training": 培训/练习/考核

agent 列表规则:
- query → ["query"]
- analysis → ["query", "analysis"]
- generation → ["query", "generator"]
- training → ["query", "generator"]

示例:
- "武莹的销售数据" → {"intent":"query","confidence":0.9,"agents":["query"],"params":{}}
- "分析各部门10月成交情况" → {"intent":"analysis","confidence":0.9,"agents":["query","analysis"],"params":{}}
- "谁的表现最好" → {"intent":"analysis","confidence":0.9,"agents":["query","analysis"],"params":{}}
- "帮我写一份跟进话术" → {"intent":"generation","confidence":0.9,"agents":["query","generator"],"params":{}}

用户消息: "{message}"

只输出JSON，不要其他内容。`;

export class RouterAgent extends BaseAgent<RouterInput, RouterOutput> {
  readonly name = 'Router Agent';
  readonly inputSchema = routerInputSchema;
  readonly outputSchema = z.object({
    intent: z.enum(['query', 'analysis', 'generation', 'training']),
    confidence: z.number().min(0).max(1),
    agents: z.array(z.string()),
    params: z.record(z.string(), z.unknown()),
  });

  protected async run(input: RouterInput): Promise<RouterOutput> {
    const result = await generateText({
      model: getDefaultModel(),
      prompt: ROUTER_PROMPT.replace('{message}', input.message),
    });

    return parseRouterResult(result.text);
  }
}
