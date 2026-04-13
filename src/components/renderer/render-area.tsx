'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart, LineChart, RadarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

echarts.use([
  BarChart, PieChart, LineChart, RadarChart,
  GridComponent, TooltipComponent, TitleComponent, LegendComponent,
  CanvasRenderer,
]);

const SandpackRenderer = dynamic(
  () => import('./sandpack-renderer').then(m => ({ default: m.SandpackRenderer })),
  { ssr: false, loading: () => <SandpackLoadingSkeleton /> },
);

type VisualizationData = {
  title: string;
  description: string;
  code: string;
  dependencies?: Record<string, string>;
};

function SandpackLoadingSkeleton() {
  return (
    <div className="w-full h-[500px] rounded-lg border overflow-hidden flex items-center justify-center bg-muted/30">
      <div className="flex flex-col items-center gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <p className="text-sm text-muted-foreground">加载可视化沙箱...</p>
      </div>
    </div>
  );
}

type UISchema = {
  type: string;
  data: Record<string, unknown>;
  title: string;
  summary?: string;
  insights?: string[];
};

type RenderAreaProps = {
  schema: UISchema | null;
  isLoading?: boolean;
  visualization?: VisualizationData;
};

function buildEChartsOption(schema: UISchema): Record<string, unknown> | null {
  const { type, data, title } = schema;

  // Read labels from schema metadata (passed by backend), not hardcoded
  const chartData = data.chartData as Record<string, number> | undefined;
  const yLabel = (data.metricLabel as string) || (data.metric as string) || '数值';

  if (!chartData || typeof chartData !== 'object' || Array.isArray(chartData)) return null;

  const entries = Object.entries(chartData).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;

  if (type === 'pie') {
    const pieData = entries.slice(0, 15);
    return {
      title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, type: 'scroll' },
      series: [{
        type: 'pie',
        radius: ['35%', '65%'],
        data: pieData.map(([name, value]) => ({ name, value })),
        label: { formatter: '{b}: {c}' },
      }],
    };
  }

  if (type === 'bar' || type === 'line') {
    const chartEntries = entries.slice(0, 30);
    return {
      title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        trigger: 'axis',
        formatter: (params: Array<{ name: string; value: number }>) => {
          const p = params[0];
          return `${p.name}<br/>${yLabel}: ${p.value}`;
        },
      },
      xAxis: {
        type: 'category',
        data: chartEntries.map(([name]) => name),
        axisLabel: { rotate: 45, fontSize: 10, interval: 0 },
      },
      yAxis: { type: 'value', name: yLabel },
      series: [{
        type: type === 'line' ? 'line' : 'bar',
        data: chartEntries.map(([, value]) => value),
        itemStyle: type === 'line' ? undefined : {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#3b82f6' },
            { offset: 1, color: '#93c5fd' },
          ]),
        },
        smooth: type === 'line',
      }],
      grid: { bottom: 100, left: 60, right: 20 },
      dataZoom: entries.length > 15 ? [{
        type: 'slider',
        start: 0,
        end: Math.min(100, (15 / entries.length) * 100),
        bottom: 10,
      }] : undefined,
    };
  }

  return null;
}

function categoryLabel(key: string): string {
  const map: Record<string, string> = {
    script: '话术',
    kpi: 'KPI指标',
    case: '成功案例',
    training: '培训材料',
  };
  return map[key] || key;
}

type SalesRow = {
  name: string;
  department: string;
  month: string;
  wechat_added: number;
  interaction: number;
  demand: number;
  deal: number;
};

type SopRow = {
  title: string;
  category: string;
  tags: string;
};

const PAGE_SIZE = 20;

function PaginatedSalesTable({ rows }: { rows: SalesRow[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-3">姓名</th>
              <th className="pb-2 pr-3">部门</th>
              <th className="pb-2 pr-3">月份</th>
              <th className="pb-2 pr-3 text-right">加微</th>
              <th className="pb-2 pr-3 text-right">互动</th>
              <th className="pb-2 pr-3 text-right">需求</th>
              <th className="pb-2 text-right">成交</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5 pr-3 font-medium">{row.name}</td>
                <td className="py-1.5 pr-3">
                  <Badge variant="secondary" className="text-xs">{row.department}</Badge>
                </td>
                <td className="py-1.5 pr-3">{row.month}</td>
                <td className="py-1.5 pr-3 text-right">{row.wechat_added}</td>
                <td className="py-1.5 pr-3 text-right">{row.interaction}</td>
                <td className="py-1.5 pr-3 text-right">{row.demand}</td>
                <td className="py-1.5 text-right font-semibold text-blue-600">{row.deal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-2 mt-2">
          <span className="text-xs text-muted-foreground">
            共 {rows.length} 条，第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderTable(data: Record<string, unknown>) {
  // Try sales performance rows first
  const salesRows = data.rows as Array<SalesRow> | undefined;
  if (salesRows && salesRows.length > 0 && 'name' in salesRows[0]) {
    return <PaginatedSalesTable rows={salesRows} />;
  }

  // Fallback: SOP-style rows
  const sopRows = data.rows as Array<SopRow> | undefined;
  if (!sopRows || sopRows.length === 0) return null;

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4">标题</th>
            <th className="pb-2 pr-4">类型</th>
            <th className="pb-2">标签</th>
          </tr>
        </thead>
        <tbody>
          {sopRows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-2 pr-4 font-medium">{row.title}</td>
              <td className="py-2 pr-4">
                <Badge variant="secondary">{categoryLabel(row.category)}</Badge>
              </td>
              <td className="py-2 text-muted-foreground text-xs">{row.tags}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RenderArea({ schema, isLoading, visualization }: RenderAreaProps) {
  // Priority: Sandpack visualization > legacy UISchema
  if (visualization?.code) {
    return (
      <div className="flex h-full flex-col overflow-hidden p-4">
        <div className="mb-3">
          <h3 className="text-base font-semibold">{visualization.title}</h3>
          {visualization.description && (
            <p className="text-muted-foreground text-sm mt-1">{visualization.description}</p>
          )}
        </div>
        <SandpackRenderer code={visualization.code} dependencies={visualization.dependencies} />
      </div>
    );
  }

  if (!schema) {
    if (isLoading) {
      return (
        <div className="flex h-full flex-col items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col items-center gap-3 pt-6">
              <div className="flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/50">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  <p className="text-blue-600 text-sm">
                    AI 正在分析数据...
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground text-xs text-center">
                分析完成后，可视化结果将在此处显示
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-3 pt-6">
            <div className="flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25">
              <p className="text-muted-foreground text-sm">
                图表和分析结果将在这里展示
              </p>
            </div>
            <p className="text-muted-foreground text-xs text-center">
              在左侧对话面板中提出问题后，可视化结果将在此处渲染显示
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isTable = schema.type === 'table';
  const isChart = ['bar', 'pie', 'line', 'radar'].includes(schema.type);
  const chartOption = isChart ? buildEChartsOption(schema) ?? null : null;

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      {/* Title */}
      <div className="mb-3">
        <h3 className="text-base font-semibold">{schema.title}</h3>
        {schema.summary && (
          <p className="text-muted-foreground text-sm mt-1">{schema.summary}</p>
        )}
      </div>

      {/* Chart or Table */}
      {chartOption && !isTable && (
        <Card className="flex-1 min-h-[300px]">
          <CardContent className="h-full p-3">
            <ReactEChartsCore
              echarts={echarts}
              option={chartOption}
              style={{ height: '100%', width: '100%' }}
              notMerge
            />
          </CardContent>
        </Card>
      )}

      {isTable && schema.data && (
        <Card className="flex-1 min-h-[300px] overflow-auto">
          <CardContent className="p-4">
            {renderTable(schema.data)}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
