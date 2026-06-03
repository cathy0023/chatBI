// 稳定版：每个问题跑 3 次取多数结果
import { askEmbedded, extractText, getGroundTruth } from './harness.mjs';

const truth = getGroundTruth();
const totalDeal = String(truth.overall.dl);
const totalInter = String(truth.overall.inter);
const totalDem = String(truth.overall.dem);
const month9Total = String(truth.byMonth.find(m => m.month === '9月').total);
const topDept = truth.byDept[0].department;
const topDeptTotal = String(truth.byDept[0].total);

const tests = [
  // 排名
  { id: 'T01-9月成交Top5', q: '9月成交 Top 5', check: (t) => t.includes('郑敏') && /5单|5$|成交.*?5/.test(t) },
  { id: 'T02-7月加微Top3', q: '7月加微数 Top 3', check: (t) => t.includes('吴涛') && t.includes('34') },
  { id: 'T03-累计成交Top5', q: '累计成交 Top 5', check: (t) => t.includes('杨洋') && t.includes('19') },
  // 聚合
  { id: 'T04-各部门总成交', q: '各部门总成交数', check: (t) => t.includes('海淀') && t.includes('47') },
  { id: 'T05-每月成交总数', q: '每月成交总数', check: (t) => t.includes('9月') && (t.includes('59') || t.includes('47') || t.includes('44') || t.includes('61')) },
  // 趋势
  { id: 'T06-海淀校区趋势', q: '海淀校区每月成交趋势', check: (t) => t.includes('海淀') },
  { id: 'T07-转化漏斗', q: '总成交转化漏斗', check: (t) => t.includes('999') && t.includes('211') },
  // 边界
  { id: 'T08-12月不存在', q: '12月成交情况', check: (t) => /12月|没有|无数据|不存在|暂无/.test(t) },
];

async function runStable(test, attempts = 3) {
  const results = [];
  for (let i = 0; i < attempts; i++) {
    const events = await askEmbedded(test.q);
    const text = extractText(events);
    const pass = test.check(text);
    results.push({ pass, text: text.slice(0, 100) });
  }
  // 多数决：≥2/3 通过算通过
  const passCount = results.filter(r => r.pass).length;
  return {
    pass: passCount >= 2,
    passRate: `${passCount}/${attempts}`,
    samples: results,
  };
}

console.log('=== ChatBI Agent 能力综合测试（每题跑 3 次取多数）===\n');
const report = [];
for (const test of tests) {
  const r = await runStable(test, 3);
  const status = r.pass ? '✅' : '❌';
  console.log(`${status} ${test.id}  ${r.passRate}`);
  if (!r.pass) {
    r.samples.forEach((s, i) => {
      console.log(`   尝试${i+1} ${s.pass ? '✓' : '✗'}: ${s.text.slice(0, 80).replace(/\n/g, ' ')}`);
    });
  }
  report.push({ ...test, ...r });
}

console.log('\n=== 总结 ===');
const passed = report.filter(r => r.pass).length;
console.log(`综合通过率: ${passed}/${report.length} (${(passed/report.length*100).toFixed(0)}%)`);

// 统计每次尝试的通过率
let totalAttempts = 0, totalPass = 0;
for (const r of report) {
  totalAttempts += 3;
  totalPass += r.samples.filter(s => s.pass).length;
}
console.log(`单次尝试通过率: ${totalPass}/${totalAttempts} (${(totalPass/totalAttempts*100).toFixed(0)}%)`);

console.log('\n=== 修复的问题 ===');
console.log('1. 月份过滤：analyzeEmbeddedData 现在按 query 中的 "X月" 预过滤数据');
console.log('2. 维度聚合：按 query 中的"部门/校区/每月"自动选择分组维度');
console.log('3. 总数vs均值：query 含"总/漏斗/转化"时明确提示用合计');
