import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { generateChartCode } from '@/lib/chart/code-generator';
import type { ToolContext } from '../types';

export function createChartTool(ctx: ToolContext) {
  return tool({
    description: '生成数据可视化图表（柱状图、折线图、饼图等）。需要先通过 queryTool 获取数据。',
    parameters: zodSchema(z.object({
      chartType: z.enum(['bar', 'line', 'pie', 'radar', 'scatter']).describe('图表类型'),
      dimension: z.string().describe('X轴维度字段，如"name"、"month"、"department"'),
      metric: z.string().describe('Y轴指标字段，如"deal"、"interaction"'),
    })),
    execute: async ({ chartType, dimension, metric }: {
      chartType: string;
      dimension: string;
      metric: string;
    }) => {
      if (ctx.data.length === 0) {
        return { generated: false, error: '暂无数据，请先使用 queryTool 查询数据。' };
      }

      try {
        const html = await generateChartCode(ctx.originalQuery, ctx.data, ctx.columns);

        if (html) {
          ctx.send('chart', { html });
          return { generated: true, chartType };
        }
        return { generated: false, error: '图表生成返回空结果' };
      } catch (err) {
        return {
          generated: false,
          error: err instanceof Error ? err.message : '图表生成失败',
        };
      }
    },
  });
}
