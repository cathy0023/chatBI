// 综合测试：覆盖 5 个维度，每个问题检查数字准确性
import { askEmbedded, extractText, extractRecords, getGroundTruth } from './harness.mjs';

const truth = getGroundTruth();
const results = [];

async function testCase(category, question, checkFn) {
  const start = Date.now();
  try {
    const events = await askEmbedded(question);
    const text = extractText(events);
    const records = extractRecords(events);
    const result = checkFn(text, records);
    const elapsed = Date.now() - start;
    results.push({ category, question, ...result, elapsed });
    const status = result.pass ? '✅' : '❌';
    console.log(`${status} [${category}] (${elapsed}ms) ${question}`);
    if (!result.pass) {
      console.log('   期望:', JSON.stringify(result.expected));
      if (result.actual) console.log('   实际:', JSON.stringify(result.actual).slice(0, 200));
      if (result.textExcerpt) console.log('   文本:', result.textExcerpt.slice(0, 200));
    }
  } catch (e) {
    results.push({ category, question, pass: false, error: e.message });
    console.log(`❌ [${category}] ${question} - ERROR: ${e.message}`);
  }
}

const expected = {
  top9Deal: truth.top9Month.map(r => `${r.name}...${r.d}`).join('|'),
  top7Wechat: truth.top7Wechat.map(r => `${r.name}...${r.w}`).join('|'),
  topDealers: truth.topDealers.map(r => `${r.name}...${r.total}`).join('|'),
  totalDeal: String(truth.overall.dl),
  totalInter: String(truth.overall.inter),
  totalDem: String(truth.overall.dem),
  month7: String(truth.byMonth.find(m => m.month === '7月').total),
  month8: String(truth.byMonth.find(m => m.month === '8月').total),
  month9: String(truth.byMonth.find(m => m.month === '9月').total),
  month10: String(truth.byMonth.find(m => m.month === '10月').total),
  topDept: truth.byDept[0].department,
  topDeptTotal: String(truth.byDept[0].total),
};

console.log('Ground truth 摘要:', expected);
console.log('\n=== 1. 排名类 ===');
await testCase('排名', '9月成交 Top 5', (text, records) => ({
  pass: text.includes('郑敏') && text.includes('5') && /9月/.test(text),
  expected: '应出现 郑敏 5 (9月单月)',
  textExcerpt: text.slice(0, 300),
}));
await testCase('排名', '7月加微数 Top 3', (text, records) => ({
  pass: text.includes('吴涛') && text.includes('34'),
  expected: '吴涛 34 加微',
  textExcerpt: text.slice(0, 300),
}));
await testCase('排名', '累计成交 Top 5', (text, records) => ({
  pass: text.includes('杨洋') && text.includes('19'),
  expected: '杨洋 19 累计',
  textExcerpt: text.slice(0, 300),
}));

console.log('\n=== 2. 聚合类 ===');
await testCase('聚合', '各部门总成交数', (text, records) => ({
  pass: text.includes('海淀') && text.includes('47'),
  expected: '海淀 47',
  textExcerpt: text.slice(0, 300),
}));
await testCase('聚合', '每月成交总数', (text, records) => ({
  pass: text.includes('9月') && text.includes('59'),
  expected: '9月 59',
  textExcerpt: text.slice(0, 300),
}));

console.log('\n=== 3. 趋势/对比 ===');
await testCase('趋势', '海淀校区每月成交趋势', (text, records) => ({
  pass: text.includes('海淀'),
  expected: '应提到海淀',
  textExcerpt: text.slice(0, 300),
}));
await testCase('趋势', '总成交转化漏斗', (text, records) => ({
  pass: text.includes('999') && text.includes('211'),
  expected: '互动999 成交211',
  textExcerpt: text.slice(0, 300),
}));

console.log('\n=== 4. 边界/奇怪问题 ===');
await testCase('边界', '12月成交情况', (text, records) => ({
  pass: /12月|没有|无数据|不存在/.test(text),
  expected: '应说12月不存在',
  textExcerpt: text.slice(0, 300),
}));

console.log('\n=== 总览 ===');
const pass = results.filter(r => r.pass).length;
const total = results.length;
console.log(`通过: ${pass}/${total}`);
results.filter(r => !r.pass).forEach(r => {
  console.log(`❌ ${r.category}: ${r.question} - ${r.error || JSON.stringify(r.expected)}`);
});
