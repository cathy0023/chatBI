import { AGENT_REGISTRY } from '@/types/agent';

type RuleMatch = {
  agents: string[];
  confidence: number;
  matchedKeywords: string[];
  intent: string;
};

// Priority order: analysis > generator > ui-builder > query
// More specialized agents should win when they match
const AGENT_PRIORITY: Record<string, number> = {
  analysis: 4,
  generator: 3,
  'ui-builder': 2,
  query: 1,
};

// Intent mapping from agent key
const INTENT_MAP: Record<string, string> = {
  query: 'query',
  analysis: 'analysis',
  generator: 'generation',
  'ui-builder': 'query',
};

export function matchByKeywords(query: string): RuleMatch | null {
  const queryLower = query.toLowerCase();

  // Collect ALL matches, not just the best per-agent
  const allMatches: Array<{
    agentKey: string;
    matchedKeywords: string[];
    confidence: number;
    priority: number;
  }> = [];

  for (const [agentKey, definition] of Object.entries(AGENT_REGISTRY)) {
    const matchedKeywords = definition.keywords.filter(kw => queryLower.includes(kw));
    if (matchedKeywords.length > 0) {
      const confidence = Math.min(0.5 + matchedKeywords.length * 0.12, 0.95);
      const priority = AGENT_PRIORITY[agentKey] || 0;
      allMatches.push({ agentKey, matchedKeywords, confidence, priority });
    }
  }

  if (allMatches.length === 0) return null;

  // Sort by: confidence desc, then priority desc
  allMatches.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.priority - a.priority;
  });

  const best = allMatches[0];

  // Build agent chain based on intent
  let agents: string[] = [];
  if (best.agentKey === 'analysis') {
    agents = ['query', 'analysis', 'ui-builder'];
  } else if (best.agentKey === 'generator') {
    agents = ['query', 'generator'];
  } else if (best.agentKey === 'ui-builder') {
    agents = ['query', 'ui-builder'];
  } else {
    agents = ['query'];
  }

  return {
    agents,
    confidence: best.confidence,
    matchedKeywords: best.matchedKeywords,
    intent: INTENT_MAP[best.agentKey] || 'query',
  };
}
