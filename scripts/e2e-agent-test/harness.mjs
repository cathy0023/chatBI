// ChatBI Agent E2E 测试基座（JS 版）
// 用法：node scripts/e2e-agent-test/harness.mjs <category>
// 依赖：dev server 在 localhost:3000 运行

import http from 'http';
import Database from 'better-sqlite3';

const DB_PATH = 'chatbi.db';

// ===== Ground Truth =====
export function getGroundTruth() {
  const db = new Database(DB_PATH, { readonly: true });
  const truth = {
    byDept: db.prepare("SELECT department, SUM(deal) as total FROM sales_performance GROUP BY department ORDER BY total DESC").all(),
    byMonth: db.prepare("SELECT month, SUM(deal) as total FROM sales_performance GROUP BY month ORDER BY month").all(),
    overall: db.prepare("SELECT SUM(interaction) as inter, SUM(demand) as dem, SUM(deal) as dl FROM sales_performance").get(),
    topDealers: db.prepare("SELECT name, department, SUM(deal) as total FROM sales_performance GROUP BY name ORDER BY total DESC LIMIT 5").all(),
    top9Month: db.prepare("SELECT name, department, deal as d FROM sales_performance WHERE month = '9月' ORDER BY deal DESC LIMIT 5").all(),
    top7Wechat: db.prepare("SELECT name, department, wechat_added as w FROM sales_performance WHERE month='7月' ORDER BY wechat_added DESC LIMIT 3").all(),
    top10Deal: db.prepare("SELECT name, department, deal as d FROM sales_performance WHERE month = '10月' ORDER BY deal DESC LIMIT 5").all(),
    haiDiaoMonth: db.prepare("SELECT month, SUM(deal) as total FROM sales_performance WHERE department = '学习机-海淀校区' GROUP BY month ORDER BY month").all(),
    chaoYangMonth: db.prepare("SELECT month, SUM(deal) as total FROM sales_performance WHERE department = '学习机-朝阳校区' GROUP BY month ORDER BY month").all(),
    allRecords: db.prepare("SELECT * FROM sales_performance").all(),
  };
  db.close();
  return truth;
}

// ===== API 调用 =====
export async function askEmbedded(question, sessionId) {
  const db = new Database(DB_PATH, { readonly: true });
  const records = db.prepare("SELECT name, department, month, wechat_added, interaction, demand, deal FROM sales_performance").all();
  db.close();

  const body = JSON.stringify({
    message: question,
    sessionId: sessionId || `e2e-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    embedded: true,
    records,
    columns: ['name', 'department', 'month', 'wechat_added', 'interaction', 'demand', 'deal'],
    labels: ['姓名', '部门', '月份', '加微数', '互动数', '需求数', '成交数'],
  });

  return sendChatRequest(body);
}

export async function askRaw(question, sessionId) {
  const body = JSON.stringify({
    message: question,
    sessionId: sessionId || `raw-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
  });
  return sendChatRequest(body);
}

function sendChatRequest(body) {
  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const events = [];
        const lines = data.split('\n');
        let cur = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) cur = { event: line.slice(7) };
          else if (line.startsWith('data: ') && cur) {
            try { cur.data = JSON.parse(line.slice(6)); } catch { cur.data = line.slice(6); }
            events.push(cur);
            cur = null;
          }
        }
        resolve(events);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== 工具 =====
export function extractRecords(events) {
  const dataEv = events.find(e => e.event === 'data');
  return dataEv?.data?.records || [];
}

export function extractChart(events) {
  const chartEv = events.find(e => e.event === 'chart');
  return chartEv?.data || null;
}

export function extractText(events) {
  return events.filter(e => e.event === 'text').map(e => e.data?.text || '').join('\n');
}

export function extractSteps(events) {
  return events.filter(e => e.event === 'step').map(e => e.data);
}

// ===== 断言 =====
export function checkNumericInText(text, expected, label) {
  const found = expected.every(n => text.includes(String(n)));
  return { pass: found, label, expected, missing: expected.filter(n => !text.includes(String(n))) };
}

export function checkRecordsContain(records, field, expected) {
  // records 是 [{name, deal}, ...]
  const actual = records.slice(0, expected.length).map(r => r[field]);
  const match = JSON.stringify(actual) === JSON.stringify(expected.map(e => typeof e === 'object' ? e[field] : e));
  return { pass: match, actual, expected };
}
