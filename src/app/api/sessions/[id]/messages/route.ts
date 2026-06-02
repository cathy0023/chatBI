import { NextRequest, NextResponse } from 'next/server';
import { getMessagesBySession } from '@/lib/db/queries';

// GET /api/sessions/[id]/messages - Load messages for a session
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const messages = getMessagesBySession(id);

    return NextResponse.json({
      messages: messages.map(m => {
        let chartData: { chartHtml?: string; chartOption?: Record<string, unknown>; records?: unknown[]; columns?: string[]; sql?: string } | null = null;
        if (m.ui_schema) {
          try {
            const parsed = JSON.parse(m.ui_schema);
            if (parsed.chartHtml || parsed.chartOption || parsed.records || parsed.sql) {
              chartData = parsed;
            }
          } catch { /* ignore malformed ui_schema */ }
        }
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          chartHtml: chartData?.chartHtml ?? null,
          chartOption: chartData?.chartOption ?? null,
          records: chartData?.records ?? null,
          columns: chartData?.columns ?? null,
          sql: chartData?.sql ?? null,
          createdAt: m.created_at,
        };
      }),
    });
  } catch (error) {
    console.error('Session messages GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
