// Mock Python Pydantic AI agent — Node.js implementation
// Mimics SSE event format expected by frontend
// Listens on http://localhost:8000/agent/chat

import http from 'http';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'chatbi.db'), { readonly: true });

const PORT = 8000;

// ── NL2SQL heuristics (mirrors real Pydantic AI patterns) ──
function generateSQL(query) {
  const q = query.trim();
  if (!q) return { sql: "SELECT 'empty' as status", params: [] };

  // Pattern: 各部门X → GROUP BY department
  if (/各.*部门|部门.*(汇总|总计|合计|对比|排名)/i.test(q)) {
    const metric = /加微|加微数/.test(q) ? 'wechat_added' :
                   /成交/.test(q) ? 'deal' :
                   /互动/.test(q) ? 'interaction' :
                   /需求/.test(q) ? 'demand' : 'deal';
    return {
      sql: `SELECT department, SUM(${metric}) as total FROM sales_performance GROUP BY department ORDER BY total DESC`,
      params: [],
    };
  }
  // Time comparison: X月 vs Y月
  const monthMatch = q.match(/(\d+月)/g);
  if (monthMatch && monthMatch.length >= 2 && /对比|比较|比/.test(q)) {
    const months = monthMatch.slice(0, 2);
    const metric = /加微/.test(q) ? 'wechat_added' :
                   /成交/.test(q) ? 'deal' :
                   /互动/.test(q) ? 'interaction' :
                   /需求/.test(q) ? 'demand' : 'deal';
    return {
      sql: `SELECT month, SUM(${metric}) as total FROM sales_performance WHERE month IN (?, ?) GROUP BY month`,
      params: months,
    };
  }
  // Person lookup
  const personMatch = q.match(/([^\s，。？！,?!.]{2,3})(?:的|个人)/);
  if (personMatch && /业绩|数据|销售|成交/.test(q)) {
    return {
      sql: `SELECT * FROM sales_performance WHERE name = ? ORDER BY month`,
      params: [personMatch[1]],
    };
  }
  // Top N
  if (/top|最高|最多/.test(q) || /最高的?(\d+)/.test(q)) {
    const nMatch = q.match(/最高的?(\d+)/);
    const n = nMatch ? parseInt(nMatch[1]) : 3;
    const metric = /加微/.test(q) ? 'wechat_added' :
                   /成交/.test(q) ? 'deal' :
                   /互动/.test(q) ? 'interaction' :
                   /需求/.test(q) ? 'demand' : 'wechat_added';
    const monthFilter = monthMatch && monthMatch[0] ? `WHERE month = '${monthMatch[0]}'` : '';
    return {
      sql: `SELECT name, SUM(${metric}) as total FROM sales_performance ${monthFilter} GROUP BY name ORDER BY total DESC LIMIT ${n}`,
      params: [],
    };
  }
  // Trend: 各月
  if (/趋势|变化|月度/.test(q) || /各月/.test(q)) {
    const metric = /成交/.test(q) ? 'deal' :
                   /加微/.test(q) ? 'wechat_added' :
                   /互动/.test(q) ? 'interaction' :
                   /需求/.test(q) ? 'demand' : 'deal';
    return {
      sql: `SELECT month, SUM(${metric}) as total FROM sales_performance GROUP BY month ORDER BY month`,
      params: [],
    };
  }
  // Ranking/judgment
  if (/最好|最高|第一|领先|表现/.test(q) && /部门/.test(q)) {
    return {
      sql: `SELECT department, SUM(deal) as total FROM sales_performance GROUP BY department ORDER BY total DESC LIMIT 1`,
      params: [],
    };
  }
  // Comparison between two people
  const twoPeople = q.match(/([^\s，。？！,?!.]{2,3})和([^\s，。？！,?!.]{2,3})/);
  if (twoPeople) {
    return {
      sql: `SELECT name, month, wechat_added, interaction, demand, deal FROM sales_performance WHERE name IN (?, ?) ORDER BY name, month`,
      params: [twoPeople[1], twoPeople[2]],
    };
  }
  // Default: SELECT all
  return {
    sql: `SELECT * FROM sales_performance ORDER BY month, name LIMIT 50`,
    params: [],
  };
}

function buildResponseText(query, records, sql) {
  if (records.length === 0) return `未找到匹配"${query}"的数据。请尝试其他查询。`;
  if (/top|最高|最多|前三/.test(query)) {
    const top = records.slice(0, 3).map((r, i) => `${i+1}. ${r.name} (${r.total || r[r.month ? 'total' : 'deal']})`).join('、');
    return `Top 排名：${top}`;
  }
  if (/对比|比较/.test(query)) {
    return `对比结果已生成，包含 ${records.length} 条记录。详细数据见右侧。`;
  }
  if (/最好|最高|第一|领先/.test(query)) {
    const top = records[0];
    return `表现最好：${top.department || top.name}，总计 ${top.total}。`;
  }
  return `查询完成，返回 ${records.length} 条数据。详细数据见右侧。`;
}

// ── HTTP SSE handler ──
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/agent/chat') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { res.writeHead(400); res.end('Bad JSON'); return; }

    const { message = '', sessionId = '' } = payload;
    const trimmed = message.trim();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 1. Session
    send('session', { sessionId: sessionId || `mock-${Date.now()}` });

    // 2. Edge case: empty
    if (!trimmed) {
      send('text', { text: '请输入您的问题，比如「各部门成交数」「各月成交趋势」。' });
      send('done', {});
      res.end();
      return;
    }

    // 3. Edge case: SQL injection
    if (/OR\s*1=1|DROP\s*TABLE|UNION\s*SELECT|--\s/i.test(trimmed)) {
      send('text', { text: '⚠️ 检测到潜在 SQL 注入，已安全拦截。建议使用自然语言描述您的问题。' });
      send('done', {});
      res.end();
      return;
    }

    // 4. Step: generating_sql
    send('step', { type: 'tool_call', toolName: 'queryTool' });

    // 5. Generate SQL + execute
    const { sql, params } = generateSQL(trimmed);
    let records = [];
    try {
      const stmt = db.prepare(sql);
      records = params.length > 0 ? stmt.all(...params) : stmt.all();
    } catch (e) {
      send('text', { text: `查询出错: ${e.message}` });
      send('done', {});
      res.end();
      return;
    }

    // Simulate LLM thinking time
    await new Promise(r => setTimeout(r, 300 + Math.random() * 500));

    // 6. Step: analyzing
    send('step', { type: 'tool_call', toolName: 'analysisTool' });
    await new Promise(r => setTimeout(r, 200));

    // 7. Data
    send('data', { sql, records, columns: records.length > 0 ? Object.keys(records[0]) : [] });

    // 8. Step: chart (if appropriate)
    if (records.length > 1 && (sql.includes('GROUP BY') || /对比|趋势|Top|最高/.test(trimmed))) {
      send('step', { type: 'tool_call', toolName: 'chartTool' });
    }

    // 9. Text response
    const text = buildResponseText(trimmed, records, sql);
    send('text', { text });

    // 10. Done
    send('done', {});
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(`[Mock Python Agent] listening on http://localhost:${PORT}/agent/chat`);
});
