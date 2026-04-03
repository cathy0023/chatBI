import { ChatPanel } from '@/components/chat/chat-panel';
import { RenderArea } from '@/components/renderer/render-area';
import { Separator } from '@/components/ui/separator';

export default function Home() {
  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <h1 className="text-xl font-bold tracking-tight">ChatBI</h1>
        <span className="text-muted-foreground text-sm">
          AI 驱动的商业智能分析
        </span>
      </header>
      <Separator />

      {/* Main content: two-column layout */}
      <main className="grid flex-1 overflow-hidden md:grid-cols-[3fr_2fr]">
        {/* Chat Panel - 60% */}
        <div className="flex h-full flex-col overflow-hidden border-r">
          <ChatPanel />
        </div>

        {/* Dynamic Rendering Area - 40% */}
        <div className="hidden md:flex h-full flex-col overflow-hidden">
          <RenderArea />
        </div>
      </main>
    </div>
  );
}
