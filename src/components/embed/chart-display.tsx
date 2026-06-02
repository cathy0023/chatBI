'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ReactECharts from 'echarts-for-react';
import type { ChatMessage } from '@/lib/chat/use-chat';

type ChartDisplayProps = {
  message: ChatMessage | null;
  isLoading: boolean;
};

function DataTable({ records, columns }: { records: Record<string, unknown>[]; columns: string[] }) {
  const COLUMN_LABELS: Record<string, string> = {
    name: '姓名',
    department: '部门',
    month: '月份',
    wechat_added: '加微',
    interaction: '互动',
    demand: '需求',
    deal: '成交',
  };

  const [page, setPage] = useState(1);
  const pageSize = 20;
  const totalPages = Math.ceil(records.length / pageSize);
  const paged = records.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b text-left text-muted-foreground">
              {columns.map(col => (
                <th key={col} className="pb-2 pr-3 text-xs font-medium">
                  {COLUMN_LABELS[col] || col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {columns.map(col => {
                  const val = row[col];
                  return (
                    <td key={col} className="py-1.5 pr-3">
                      {col === 'department' ? (
                        <Badge variant="secondary" className="text-xs">{String(val ?? '')}</Badge>
                      ) : col === 'deal' ? (
                        <span className="font-semibold text-blue-600">{String(val ?? 0)}</span>
                      ) : (
                        <span>{String(val ?? '')}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-2 mt-2">
          <span className="text-xs text-muted-foreground">
            共 {records.length} 条，第 {page}/{totalPages} 页
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

export function ChartDisplay({ message, isLoading }: ChartDisplayProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasData = message && (message.records?.length ?? 0) > 0;
  const hasChart = !!message?.chartOption || !!message?.chartHtml;
  const isActive = message?.phase === 'done' || hasData;

  if (!isActive && !isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        图表将在这里展示
      </div>
    );
  }

  if (isLoading && !hasData) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-blue-600">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm">AI 正在分析数据...</span>
        </div>
      </div>
    );
  }

  const showTabs = hasData && hasChart;

  return (
    <div
      className="grid h-full overflow-hidden"
      style={{ gridTemplateRows: showTabs ? 'auto 1fr' : '1fr' }}
    >
      {showTabs && (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Button
            variant={view === 'chart' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('chart')}
          >
            图表
          </Button>
          <Button
            variant={view === 'table' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('table')}
          >
            数据表
          </Button>
          {message?.sql && (
            <span className="ml-auto text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={message.sql}>
              SQL: {message.sql.slice(0, 50)}...
            </span>
          )}
        </div>
      )}

      {view === 'chart' && hasChart && message?.chartOption && (
        <div className="min-h-0 p-2">
          <ReactECharts
            option={message.chartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      )}

      {view === 'chart' && hasChart && message?.chartHtml && !message.chartOption && (
        <div className="relative min-h-0">
          <iframe
            sandbox="allow-scripts allow-same-origin"
            srcDoc={message.chartHtml}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
            title="Chart"
          />
        </div>
      )}

      {(view === 'table' || !hasChart) && hasData && message?.records && message?.columns && (
        <div className="min-h-0 overflow-auto p-3">
          <DataTable records={message.records} columns={message.columns} />
        </div>
      )}
    </div>
  );
}
