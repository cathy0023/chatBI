import { RouterAgent } from '@/lib/agents/router-agent';
import { QueryAgent } from '@/lib/agents/query-agent';
import type { RouterOutput } from '@/types/agent';

const routerAgent = new RouterAgent();
const queryAgent = new QueryAgent();

export type HandlerResult = {
  text: string;
  uiSchema?: unknown;
  agentTrace?: unknown;
};

export async function handleMessage(userMessage: string, sessionId: string): Promise<HandlerResult> {
  // Step 1: Route the message
  const route: RouterOutput = await routerAgent.execute({
    message: userMessage,
  });

  const trace = { route, steps: [] as string[] };

  try {
    // Step 2: Execute based on routing
    if (route.agents.includes('query') && !route.agents.includes('analysis')) {
      // Simple query path
      const queryResult = await queryAgent.execute({
        query: userMessage,
        searchType: 'hybrid',
      });
      trace.steps.push('query');

      // Format response
      const records = queryResult.records;
      if (records.length === 0) {
        return {
          text: '抱歉，没有找到相关的SOP数据。请尝试换个关键词或描述您的需求。',
          agentTrace: trace,
        };
      }

      const text = formatQueryResults(records, userMessage);
      return { text, agentTrace: trace };
    }

    if (route.agents.includes('analysis')) {
      // Analysis path (Phase 2 will add AnalysisAgent, for now return query results)
      const queryResult = await queryAgent.execute({
        query: userMessage,
        searchType: 'hybrid',
      });
      trace.steps.push('query');

      const text = formatAnalysisResults(queryResult.records, userMessage);
      return { text, agentTrace: trace };
    }

    if (route.agents.includes('generator')) {
      // Generation path (Phase 3)
      return {
        text: '内容生成功能正在开发中，敬请期待。',
        agentTrace: trace,
      };
    }

    // Fallback
    return {
      text: '我还不太理解您的问题，可以换个方式描述吗？比如：\n- "查找价格异议处理话术"\n- "分析最近一个月的转化率趋势"\n- "展示所有客户案例"',
      agentTrace: trace,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      text: `处理您的问题时遇到错误：${errorMsg}。请稍后重试。`,
      agentTrace: { ...trace, error: errorMsg },
    };
  }
}

function formatQueryResults(records: Record<string, unknown>[], query: string): string {
  const items = records.slice(0, 5).map((r, i) => {
    const title = String(r.title || '');
    const category = String(r.category || '');
    const content = String(r.content || '').slice(0, 200);
    const tags = String(r.tags || '');
    return `**${i + 1}. ${title}** [${category}]\n${content}${content.length >= 200 ? '...' : ''}\n标签: ${tags}`;
  });

  const header = `为您找到 ${records.length} 条相关结果：\n\n`;
  const footer = records.length > 5 ? `\n\n*还有 ${records.length - 5} 条结果，可以进一步筛选*` : '';
  return header + items.join('\n\n---\n\n') + footer;
}

function formatAnalysisResults(records: Record<string, unknown>[], query: string): string {
  if (records.length === 0) {
    return '没有找到相关数据进行分析。请尝试更具体的关键词。';
  }
  const items = records.slice(0, 5).map((r, i) => {
    const title = String(r.title || '');
    const category = String(r.category || '');
    const content = String(r.content || '').slice(0, 150);
    return `${i + 1}. **${title}** [${category}]\n${content}...`;
  });
  return `基于 ${records.length} 条数据，以下是初步分析结果：\n\n${items.join('\n\n')}\n\n*图表可视化功能将在后续版本中支持*`;
}
