import { EmbedClient } from '@/components/embed/embed-client';

export default function EmbedPage() {
  return (
    <>
      {/* Inline script: 在 HTML 解析阶段同步执行，捕获任何时机到达的 postMessage */}
      <script dangerouslySetInnerHTML={{
        __html: `
          window.__CHATBI_BUFFER__ = [];
          window.__CHATBI_BUFFERING__ = true;
          window.addEventListener('message', function(e) {
            if (!window.__CHATBI_BUFFERING__) return;
            var d = e.data;
            if (d && (d.type === 'MGV_TABLE_DATA' || d.type === 'DRAWER_MODE_CHANGE')) {
              window.__CHATBI_BUFFER__.push(e);
            }
          });
        `,
      }} />
      <EmbedClient />
    </>
  );
}
