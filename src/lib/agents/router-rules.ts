import { AGENT_REGISTRY } from '@/types/agent';

type RuleMatch = {
  agents: string[];
  confidence: number;
  matchedKeywords: string[];
};

export function matchByKeywords(query: string): RuleMatch | null {
  const queryLower = query.toLowerCase();
  let bestMatch: RuleMatch | null = null;

  for (const [agentKey, definition] of Object.entries(AGENT_REGISTRY)) {
    const matchedKeywords = definition.keywords.filter(kw => queryLower.includes(kw));
    if (matchedKeywords.length > 0) {
      // More keywords matched = higher confidence
      const confidence = Math.min(0.5 + matchedKeywords.length * 0.15, 0.95);
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          agents: [agentKey],
          confidence,
          matchedKeywords,
        };
      }
    }
  }

  // Special case: analysis queries also need query + ui-builder agents
  if (bestMatch && bestMatch.agents.includes('analysis')) {
    bestMatch.agents = ['query', 'analysis', 'ui-builder'];
  }

  return bestMatch;
}
