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
    nodes[m[1]] = { innerHTML: '', style: {}, attributes: {}, events: {}, hidden: false,
      classList: { toggle() {} }, setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(k, fn) { this.events[k] = fn; }, focus() { this.focused = true; } };
  }
  const errors = [];
  const document = {
    readyState: 'complete', getElementById: id => nodes[id] || null,
    querySelectorAll: () => [], addEventListener() {}
  };
  const pageWindow = { scrollY: 0, location: { hash: '' }, addEventListener() {},
    scrollTo({ top }) { this.scrollY = top; }, history: { pushState(_a, _b, hash) { pageWindow.location.hash = hash; } } };
  const context = vm.createContext({
    document, window: pageWindow,
    console: { log() {}, warn() {}, error(...args) { errors.push(args.map(String).join(' ')); } }
  });
  const instrumented = script.replace('function init() {',
    'globalThis.pageTest = { DATA, computeMetrics, renderClosed, renderReviews, activateView, init };\n  function init() {');
  vm.runInContext(instrumented, context, { timeout: 3000 });
  assert.deepEqual(errors, [], '页面出现渲染错误');
  assert.ok(context.pageTest, '页面初始化接口缺失');
  return { api: context.pageTest, nodes, errors, window: pageWindow };
}

function check(html, ledger) {
  const { api, nodes, errors, window } = runPage(html);
  assert.equal(nodes['panel-overview'].hidden, false, '默认未打开持仓总览');
  assert.equal(nodes['panel-records'].hidden, true);
  assert.equal(nodes['panel-rules'].hidden, true);
  window.scrollY = 250;
  nodes['tab-records'].events.click();
  assert.equal(nodes['panel-records'].hidden, false);
  assert.equal(nodes['tab-records'].attributes['aria-selected'], 'true');
  window.scrollY = 620;
  nodes['tab-overview'].events.click();
  assert.equal(window.scrollY, 250, '返回持仓丢失滚动位置');
  nodes['tab-records'].events.click();
  assert.equal(window.scrollY, 620, '返回复盘丢失滚动位置');
  nodes['tab-records'].events.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(nodes['panel-rules'].hidden, false, '键盘不能切换Tab');
  const expected = require('./derive').presentChinaDates(require('./derive').derive(ledger), ledger);
  const latestRecordDate = ledger.executions.map(e => require('./derive').chinaExecutionTime(e).dateEnd).sort().pop();
  assert.ok(html.includes('记录更新至 ' + latestRecordDate + ' · 中国时间'), '页头记录日期未随台账更新');
  assert.equal(JSON.stringify(api.DATA.closedTrades.map(d => [d.date, d.dateLabel])),
    JSON.stringify(expected.groups.map(d => [d.date, d.dateLabel])), '成交日期没有按中国时区转换');
  assert.ok(!nodes.holdingsBox.innerHTML.includes('策略备注'), '持仓仍显示策略备注');
  assert.ok(api.DATA.accounts.every(a => a.holdings.every(h => !h.strategyNote)), '策略备注仍进入页面数据');
  assert.ok(api.DATA.accounts.every(a => a.holdings.every(h => h.wtPct === undefined)), '精确正股权重仍进入页面数据');
  assert.ok(nodes.metricsBox.innerHTML.includes('主仓集中度') && !nodes.metricsBox.innerHTML.includes('CC 覆盖标的'), '顶部指标未更新');
  assert.ok(!/净资产待补|主仓74%|综合仓位/.test(nodes.metricsBox.innerHTML), '顶部仍使用旧仓位或内部待办');
  assert.equal(api.computeMetrics().uniqueHoldings, new Set(ledger.accounts.flatMap(a => a.holdings.filter(h => h.analysisQty !== 0 && h.qty !== h.observationQty).map(h => a.market + ':' + h.sym))).size, '跨账户同标的重复计数');
  const expectedRules = ledger.discipline.rules.map(r => r.id).sort();
  const renderedRules = [...nodes.rulesBox.innerHTML.matchAll(/data-rule-id="([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(renderedRules, expectedRules, '当前纪律未从唯一来源渲染');
  assert.ok(!/disciplineHistory|inactiveRules|rulesHtml|最近交易状态|多次验证/.test(html), '内部历史纪律或错误统计口径进入页面');
  for (const id of ['holdingsBox', 'closedDays', 'reviewsBox']) assert.ok(nodes[id], '缺页面容器 ' + id);
  const sales = ledger.executions.filter(e => e.side === 'sell' && e.includeInPerformance !== false && e.analysisQty !== 0);
  const renderedIds = [...nodes.closedDays.innerHTML.matchAll(/data-execution-id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(renderedIds.slice().sort(), sales.map(e => e.executionId).sort(), '卖出卡片缺失或重复');
  for (const d of api.DATA.closedTrades) for (const t of d.trades) for (const l of t.legs) {
    assert.equal(l.date, d.date, '卖出被迁移到错误日期');
  }
  const dates = api.DATA.closedTrades.map(d => d.date);
  assert.equal(JSON.stringify(dates), JSON.stringify(expected.groups.map(d => d.date)), '兑现日期未倒序');
  const reviewIds = [...nodes.reviewsBox.innerHTML.matchAll(/data-review-id="([^"]+)"/g)].map(m => m[1]);
  const publicReviews = (ledger.reviews || []).filter(r => r.visibility !== 'internal');
  assert.deepEqual(reviewIds.slice().sort(), publicReviews.map(r => r.reviewId).sort(), '公开复盘缺失或内部核对泄漏');
  assert.ok(!nodes.reviewsBox.innerHTML.includes('待补观察'), '内部观察出现在复盘');
  const reviewSection = html.slice(html.indexOf('<section id="review"'), html.indexOf('</section>', html.indexOf('<section id="review"')));
  assert.ok(!/待补观察|待验证的观察|历史结单核对|历史补录|结单核对/.test(reviewSection + nodes.reviewsBox.innerHTML), '旧复盘内部内容仍在页面');
  assert.ok(!/internalLegacyReviewNotes|internalObservation|internalExecution|RV-RECONCILE/.test(html), '内部记录嵌入网站产物');
  assert.ok(!nodes.closedDays.innerHTML.includes('未计费用') && !nodes.closedDays.innerHTML.includes('未扣费用'), '兑现卡片仍重复显示费用表述');
  assert.ok(!/数量待核实|时刻未记录|待复盘|后续处理待核实/.test(nodes.closedDays.innerHTML + nodes.reviewsBox.innerHTML), '旧状态或内部核对提示仍出现');
  assert.ok(!/券商结单补录|结单仍有观察仓|后者仍待核实/.test(nodes.closedDays.innerHTML + nodes.reviewsBox.innerHTML), '内部来源核对提示仍出现');
  assert.ok(!nodes.closedSummary.innerHTML.includes('待核实'), '摘要仍重复显示内部缺项任务');
  for (const r of api.DATA.reviews) assert.ok(!r.observation && !r.internalObservation && !r.internalExecution, '内部字段进入页面数据');
  if (reviewIds.length) {
    const latest = publicReviews.slice().sort((a, b) => (b.reviewDate || b.date).localeCompare(a.reviewDate || a.date))[0];
    assert.equal(reviewIds[0], latest.reviewId, '最新复盘未置顶');
    assert.ok(new RegExp('^<article class="entry" data-review-id="' + latest.reviewId + '"[^>]*><details open>').test(nodes.reviewsBox.innerHTML), '最新复盘未展开');
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
  assert.ok(nodes.closedDays.innerHTML.includes('—'), '不可核算值应保留空缺符号');
  assert.ok(!/待核实|时刻未记录|null|undefined/.test(nodes.closedDays.innerHTML), '缺项变成重复提示或文本null');
  assert.ok(!nodes.closedDays.innerHTML.includes('<th scope="col">中国时间'), '全日缺时刻仍显示空时间列');
  assert.ok(nodes.closedDays.innerHTML.includes('0.0%'), '零收益被误判');
  assert.ok(!nodes.closedDays.innerHTML.includes('NaN'), '出现伪数值');
  const before = nodes.reviewsBox.innerHTML;
  assert.ok(!reviewIds.length || before.includes('data-review-id='), '缺项卡片阻止复盘显示');
  assert.equal(api.computeMetrics().clearedTrades, 0, '未知收益被计入周期胜率');
  // 同日再买入后继续卖出：逐笔成本可算，组成本不同不应显示“成本待核实”。
  api.DATA.closedTrades = [{ date: '2099-01-02', dateLabel: '2099-01-02', trades: [{
    sym: 'MIX', name: '分批不同成本', acct: '主账号', cost: null, totalRetPct: 5, reason: '部分减仓兑现',
    legs: [{ executionId: 'MIX-1', cost: 10, price: 11, retPct: 10, time: '09:01:00' },
      { executionId: 'MIX-2', cost: 20, price: 21, retPct: 5, time: null }]
  }] }];
  api.init();
  assert.ok(nodes.closedDays.innerHTML.includes('$10.00') && nodes.closedDays.innerHTML.includes('$20.00'), '不同成本未逐腿显示');
  assert.ok(nodes.closedDays.innerHTML.includes('09:01:00') && nodes.closedDays.innerHTML.includes('<th scope="col">中国时间'), '精确时刻被清理掉');
  assert.ok(!/待核实|时刻未记录|null|undefined/.test(nodes.closedDays.innerHTML));
  assert.deepEqual(errors, [], '分批不同成本导致渲染失败');
  return { sales: sales.length, reviews: reviewIds.length, days: dates.length };
}

if (require.main === module) {
  const htmlPath = process.argv[2] || path.join(__dirname, 'public', 'index.html');
  const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ledger-full.json'), 'utf8'));
  const result = check(fs.readFileSync(htmlPath, 'utf8'), ledger);
  console.log('✅ 实际渲染通过：' + result.sales + ' 条卖出 / ' + result.days + ' 个交易日 / ' + result.reviews + ' 条结构化复盘；空值与持平验证通过');
}
module.exports = { runPage, check };
