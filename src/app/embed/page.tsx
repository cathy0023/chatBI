import { EmbedClient } from '@/components/embed/embed-client';

export default function EmbedPage() {
  return (
    <>
      {/* Inline script: 在 HTML 解析阶段同步执行，捕获任何时机到达的 postMessage */}
      <script dangerouslySetInnerHTML={{
        __html: `
          window.__CHATBI_BUFFER__ = [];
          window.__CHATBI_BUFFERING__ = true;
          window.__CHATBI_LOG__ = [];
          function __chatbiLog(msg) {
            window.__CHATBI_LOG__.push('[' + new Date().toISOString().slice(11,23) + '] ' + msg);
            console.log('[ChatBI Buffer] ' + msg);
          }
          __chatbiLog('inline script executed');
          window.addEventListener('message', function(e) {
            var d = e.data;
            if (!d || !d.type) return;
            __chatbiLog('received: type=' + d.type + ' buffering=' + window.__CHATBI_BUFFERING__);
            if (!window.__CHATBI_BUFFERING__) return;
            if (d.type === 'MGV_TABLE_DATA' || d.type === 'DRAWER_MODE_CHANGE') {
              window.__CHATBI_BUFFER__.push(e);
              __chatbiLog('buffered, count=' + window.__CHATBI_BUFFER__.length);
            }
          });
        `,
      }} />
      <EmbedClient />
    </>
  );
}
