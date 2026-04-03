import { z } from 'zod';

// Chart config
export const chartConfigSchema = z.object({
  chartType: z.enum(['line', 'bar', 'pie', 'radar', 'scatter', 'heatmap', 'funnel', 'sankey']),
  echartsOption: z.record(z.string(), z.unknown()),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

// Table config
export const tableConfigSchema = z.object({
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    width: z.number().optional(),
  })),
  rows: z.array(z.record(z.string(), z.unknown())),
  highlights: z.array(z.object({
    row: z.number(),
    col: z.string(),
    reason: z.string(),
  })).optional(),
});
export type TableConfig = z.infer<typeof tableConfigSchema>;

// Timeline config
export const timelineConfigSchema = z.object({
  events: z.array(z.object({
    time: z.string(),
    title: z.string(),
    status: z.string(),
    detail: z.string().optional(),
  })),
});
export type TimelineConfig = z.infer<typeof timelineConfigSchema>;

// Comparison config
export const comparisonConfigSchema = z.object({
  items: z.array(z.object({
    label: z.string(),
    metrics: z.array(z.object({
      name: z.string(),
      value: z.number(),
      unit: z.string(),
    })),
  })),
  radarConfig: z.record(z.string(), z.unknown()).optional(),
});
export type ComparisonConfig = z.infer<typeof comparisonConfigSchema>;

// Dashboard config
export const dashboardConfigSchema: z.ZodType<DashboardConfig> = z.object({
  layouts: z.array(z.object({
    schema: z.lazy(() => uiSchemaSchema),
    span: z.number(),
  })),
});
export type DashboardConfig = {
  layouts: { schema: UISchema; span: number }[];
};

// UI Schema (discriminated union)
export const uiSchemaSchema: z.ZodType<UISchema> = z.object({
  type: z.enum(['chart', 'table', 'timeline', 'comparison', 'dashboard']),
  title: z.string(),
  description: z.string().optional(),
  config: z.union([
    chartConfigSchema,
    tableConfigSchema,
    timelineConfigSchema,
    comparisonConfigSchema,
    dashboardConfigSchema,
  ]),
});
export type UISchema = {
  type: 'chart' | 'table' | 'timeline' | 'comparison' | 'dashboard';
  title: string;
  description?: string;
  config: ChartConfig | TableConfig | TimelineConfig | ComparisonConfig | DashboardConfig;
};