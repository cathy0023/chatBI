import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { generateTextCompat } from '@/lib/llm/provider';

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

// System prompt — separated from user input to prevent prompt injection
const ROUTER_SYSTEM_PROMPT = `你是一个销售业绩 BI 系统的意图分类器。

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

只输出JSON，不要其他内容。`;

/**
 * Parse JSON from LLM response — robust against various output formats.
 * Handles: markdown code blocks, surrounding text, empty responses.
 */
function parseRouterResult(text: string): RouterOutput {
  const fallback: RouterOutput = {
    intent: 'query',
    confidence: 0.5,
    agents: ['query'],
    params: {},
  };

  try {
    // Try direct parse first
    let jsonStr = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();

    // If direct parse fails, try to extract JSON object from text
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(jsonStr);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;
      raw = JSON.parse(jsonMatch[0]);
    }

    return {
      intent: (['query', 'analysis', 'generation', 'training'].includes(raw.intent as string)
        ? raw.intent : 'query') as RouterOutput['intent'],
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
      agents: Array.isArray(raw.agents) ? raw.agents : ['query'],
      params: (raw.params && typeof raw.params === 'object') ? raw.params as Record<string, unknown> : {},
    };
  } catch {
    return fallback;
  }
}

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
    // Use messages array to prevent prompt injection (user input in separate role)
    const result = await generateTextCompat({
      system: ROUTER_SYSTEM_PROMPT,
      prompt: input.message,
    });

    return parseRouterResult(result.text);
  }
}
