'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ChatMessage } from '@/lib/chat/use-chat';
import { getPhaseLabel } from '@/lib/chat/use-chat';

type RenderAreaProps = {
  message: ChatMessage | null;
  isLoading: boolean;
};

function LoadingIndicator({ phase }: { phase?: string }) {
  const label = getPhaseLabel(phase as ChatMessage['phase']) || 'AI 正在分析数据...';
  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 pt-6">
          <div className="flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/50">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <p className="text-blue-600 text-sm">{label}</p>
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

function EmptyState() {
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

function SandboxRenderer({ html }: { html: string }) {
  return (
    <iframe
      sandbox="allow-scripts allow-same-origin"
      srcDoc={html}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
      title="Chart Visualization"
    />
  );
}

export function RenderArea({ message, isLoading }: RenderAreaProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasData = message && (message.records?.length ?? 0) > 0;
  const hasChart = !!message?.chartHtml;
  const isActive = message?.phase === 'done' || hasData;

  // Show loading if global loading and no active message, or if message is still loading
  if ((isLoading && !hasData) || (message?.phase && message.phase !== 'done' && message.phase !== 'error' && !hasData)) {
    return <LoadingIndicator phase={message?.phase} />;
  }

  if (!isActive) {
    if (isLoading) return <LoadingIndicator phase={message?.phase} />;
    return <EmptyState />;
  }

  const showTabs = hasData && hasChart;

  return (
    <div
      className="grid h-full overflow-hidden"
      style={{ gridTemplateRows: showTabs ? 'auto 1fr' : '1fr' }}
    >
      {/* Tab bar — auto row, only when both chart and data exist */}
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
          {message.sql && (
            <span className="ml-auto text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={message.sql}>
              SQL: {message.sql.slice(0, 50)}...
            </span>
          )}
        </div>
      )}

      {/* Chart — 1fr grid track = definite height, iframe absolute fills it */}
      {view === 'chart' && hasChart && (
        <div className="relative min-h-0">
          <SandboxRenderer html={message.chartHtml!} />
        </div>
      )}

      {/* Table */}
      {(view === 'table' || !hasChart) && hasData && message.records && message.columns && (
        <div className="min-h-0 overflow-auto p-3">
          <DataTable records={message.records} columns={message.columns} />
        </div>
      )}

      {/* Loading chart while data is available */}
      {isLoading && hasData && !hasChart && message?.phase === 'generating_chart' && (
        <div className="flex items-center gap-2 py-4 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm">正在生成图表...</span>
        </div>
      )}
    </div>
  );
}
