import { z } from 'zod';

// Agent definition (configuration-driven, inspired by Claude Code)
export type AgentDefinition = {
  name: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
  keywords: string[];
  description: string;
};

// Agent message (structured communication between agents)
export type AgentMessage = {
  type: 'query_result' | 'analysis_result' | 'ui_schema' | 'generated_content' | 'router_decision';
  data: unknown;
  metadata: {
    sourceAgent: string;
    targetAgent: string;
    timestamp: number;
  };
};

// Router output schema
export const routerOutputSchema = z.object({
  intent: z.enum(['query', 'analysis', 'generation', 'training']),
  confidence: z.number().min(0).max(1),
  agents: z.array(z.string()),
  params: z.record(z.string(), z.unknown()),
});

export type RouterOutput = z.infer<typeof routerOutputSchema>;

// Query output schema
export const queryOutputSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
  totalCount: z.number(),
  query: z.string(),
});

export type QueryOutput = z.infer<typeof queryOutputSchema>;

// Analysis output schema
export const analysisOutputSchema = z.object({
  summary: z.string(),
  insights: z.array(z.string()),
  dataSummary: z.record(z.string(), z.unknown()),
  suggestedChartType: z.enum(['line', 'bar', 'pie', 'radar', 'scatter', 'heatmap', 'funnel', 'sankey', 'table', 'comparison']).optional(),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

// Agent registry
export const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  query: {
    name: 'Query Agent',
    systemPrompt: 'You are a data query specialist. Your job is to retrieve relevant SOP data based on user queries. Return structured results.',
    tools: ['sql_query', 'vector_search'],
    keywords: ['查找', '找到', '搜索', '有没有', '展示', '列出', '查询', '哪些', '什么'],
    description: '从SOP数据中检索信息',
  },
  analysis: {
    name: 'Analysis Agent',
    systemPrompt: 'You are a data analyst. Your job is to analyze SOP data, find trends, patterns, and provide actionable insights.',
    tools: ['sql_query', 'statistics'],
    keywords: ['分析', '对比', '趋势', '原因', '差异', '变化', '为什么', '统计', '排名'],
    description: '对数据进行统计分析和洞察提取',
  },
  generator: {
    name: 'Generator Agent',
    systemPrompt: 'You are a content generation specialist. Your job is to create new SOP content, sales scripts, and training materials based on existing data.',
    tools: ['template'],
    keywords: ['生成', '创建', '写', '帮我写', '制作', '新的'],
    description: '生成话术、方案、培训材料',
  },
  'ui-builder': {
    name: 'UI Builder Agent',
    systemPrompt: 'You are a visualization specialist. Your job is to design appropriate chart/table/comparison layouts for data display.',
    tools: ['echarts_template'],
    keywords: ['图表', '可视化', '展示', '画'],
    description: '根据数据生成可视化界面配置',
  },
};