// 执行实际构建页面的脚本；检查 DOM 结果，不能只检查源码里有没有标题。
// 无浏览器依赖，CI/日常更新均可运行：node test_render.js [HTML路径]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

function runPage(html) {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('var DATA ='));
  assert.ok(script, '缺页面 DATA 脚本');
  const nodes = {};
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    nodes[m[1]] = { innerHTML: '', style: {}, classList: { toggle() {} }, addEventListener() {} };
  }
  const errors = [];
  const document = {
    readyState: 'complete', getElementById: id => nodes[id] || null,
    querySelectorAll: () => [], addEventListener() {}
  };
  const context = vm.createContext({
    document, window: { addEventListener() {} },
    console: { log() {}, warn() {}, error(...args) { errors.push(args.map(String).join(' ')); } }
  });
  const instrumented = script.replace('function init() {',
    'globalThis.pageTest = { DATA, computeMetrics, renderClosed, renderReviews, init };\n  function init() {');
  vm.runInContext(instrumented, context, { timeout: 3000 });
  assert.deepEqual(errors, [], '页面出现渲染错误');
  assert.ok(context.pageTest, '页面初始化接口缺失');
  return { api: context.pageTest, nodes, errors };
}

function check(html, ledger) {
  const { api, nodes, errors } = runPage(html);
  for (const id of ['holdingsBox', 'closedDays', 'reviewsBox']) assert.ok(nodes[id], '缺页面容器 ' + id);
  const sales = ledger.executions.filter(e => e.side === 'sell');
  const renderedIds = [...nodes.closedDays.innerHTML.matchAll(/data-execution-id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(renderedIds.slice().sort(), sales.map(e => e.executionId).sort(), '卖出卡片缺失或重复');
  for (const d of api.DATA.closedTrades) for (const t of d.trades) for (const l of t.legs) {
    assert.equal(l.date, d.date, '卖出被迁移到错误日期');
  }
  const dates = api.DATA.closedTrades.map(d => d.date);
  assert.deepEqual(dates.slice(), dates.slice().sort().reverse(), '兑现日期未倒序');
  const reviewIds = [...nodes.reviewsBox.innerHTML.matchAll(/data-review-id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(reviewIds.slice().sort(), (ledger.reviews || []).map(r => r.reviewId).sort(), '结构化复盘未全部渲染');
  if (reviewIds.length) {
    const latest = ledger.reviews.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    assert.equal(reviewIds[0], latest.reviewId, '最新复盘未置顶');
    assert.ok(nodes.reviewsBox.innerHTML.startsWith('<article class="entry" data-review-id="' + latest.reviewId + '"><details open>'), '最新复盘未展开');
  }
  // 同时缺数量、价格、成本、收益；零收益不能显示成待核实或亏损。
  const fixture = { date: '2099-01-01', dateLabel: '2099-01-01', trades: [{
    sym: 'TEST', name: '空值验证', acct: '主账号', cost: null, totalRetPct: null,
    isPartial: true, result: null, legs: [{ executionId: 'TEST-NULL', date: '2099-01-01', time: null, qty: null, price: null, retPct: null }]
  }, { sym: 'ZERO', name: '持平验证', acct: '主账号', cost: 0, totalRetPct: 0,
    result: 'flat', legs: [{ executionId: 'TEST-ZERO', date: '2099-01-01', time: '盘中', price: 0, retPct: 0 }]
  }] };
  api.DATA.closedTrades = [fixture];
  api.init();
  assert.deepEqual(errors, [], '空值导致模块崩溃');
  assert.ok(nodes.closedDays.innerHTML.includes('待核实'), '缺项应显示待核实');
  assert.ok(nodes.closedDays.innerHTML.includes('0.0%'), '零收益被误判');
  assert.ok(!nodes.closedDays.innerHTML.includes('NaN'), '出现伪数值');
  const before = nodes.reviewsBox.innerHTML;
  assert.ok(!reviewIds.length || before.includes('data-review-id='), '缺项卡片阻止复盘显示');
  assert.equal(api.computeMetrics().clearedTrades, 0, '未知收益被计入周期胜率');
  return { sales: sales.length, reviews: reviewIds.length, days: dates.length };
}

if (require.main === module) {
  const htmlPath = process.argv[2] || path.join(__dirname, 'public', 'index.html');
  const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ledger-full.json'), 'utf8'));
  const result = check(fs.readFileSync(htmlPath, 'utf8'), ledger);
  console.log('✅ 实际渲染通过：' + result.sales + ' 条卖出 / ' + result.days + ' 个交易日 / ' + result.reviews + ' 条结构化复盘；空值与持平验证通过');
}
module.exports = { runPage, check };
