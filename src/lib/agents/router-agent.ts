import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { matchByKeywords } from './router-rules';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';

// Input: raw user message
const routerInputSchema = z.object({
  message: z.string().min(1),
  context: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
});

// Output: routing decision
const routerOutputSchema = z.object({
  intent: z.enum(['query', 'analysis', 'generation', 'training']),
  confidence: z.number().min(0).max(1),
  agents: z.array(z.string()),
  params: z.record(z.string(), z.unknown()),
});

type RouterInput = z.infer<typeof routerInputSchema>;
type RouterOutput = z.infer<typeof routerOutputSchema>;

export class RouterAgent extends BaseAgent<RouterInput, RouterOutput> {
  readonly name = 'Router Agent';
  readonly inputSchema = routerInputSchema;
  readonly outputSchema = routerOutputSchema;

  protected async run(input: RouterInput): Promise<RouterOutput> {
    // Layer 1: Keyword matching (zero cost)
    const keywordMatch = matchByKeywords(input.message);
    if (keywordMatch && keywordMatch.confidence > 0.6) {
      const intentMap: Record<string, RouterOutput['intent']> = {
        query: 'query',
        analysis: 'analysis',
        generator: 'generation',
        'ui-builder': 'query',
      };
      const primaryAgent = keywordMatch.agents[0];
      return {
        intent: intentMap[primaryAgent] || 'query',
        confidence: keywordMatch.confidence,
        agents: keywordMatch.agents,
        params: { message: input.message, matchedKeywords: keywordMatch.matchedKeywords },
      };
    }

    // Layer 2: LLM classification
    const result = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: routerOutputSchema,
      prompt: `You are a intent classifier for a ChatBI system about online education sales SOP data.

Classify the user's message into one of these intents:
- "query": User wants to find/search/retrieve data (查找/搜索/展示)
- "analysis": User wants analysis/comparison/trends (分析/对比/趋势)
- "generation": User wants to generate/create content (生成/创建/写)
- "training": User wants training materials (培训/练习/考核)

Available agents: query, analysis, generator, ui-builder

For "query" intent: agents = ["query"]
For "analysis" intent: agents = ["query", "analysis", "ui-builder"]
For "generation" intent: agents = ["query", "generator"]
For "training" intent: agents = ["query", "generator"]

User message: "${input.message}"

Return the intent, confidence (0-1), agents list, and any params.`,
    });

    return result.object;
  }
}
