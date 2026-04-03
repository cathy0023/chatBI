'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function RenderArea() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-center text-lg">动态渲染区域</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="flex h-32 w-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25">
            <p className="text-muted-foreground text-sm">
              图表和分析结果将在这里展示
            </p>
          </div>
          <p className="text-muted-foreground text-xs text-center">
            在左侧对话面板中提出问题后，可视化结果将在此处渲染显示
          </p>
          {/* Placeholder skeletons to preview future layout */}
          <div className="grid w-full gap-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
