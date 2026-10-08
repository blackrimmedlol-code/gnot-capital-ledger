const assert = require('node:assert/strict');
const { derive, chinaExecutionTime, presentChinaDates } = require('./derive');
const event = (id, date, side, qty, price) => ({ executionId: id, episodeId: 'EP', sym: 'TEST', account: 'main', date, side, qty, price });
const fixture = { accounts: [], closedTrades: [], episodes: [{ episodeId: 'EP', status: 'closed' }], executions: [
  event('B1', '2026-10-01', 'buy', 100, 10), event('S1', '2026-10-02', 'sell', 50, 12),
  event('B2', '2026-10-03', 'buy', 50, 20), event('S2', '2026-10-04', 'sell', 100, 15)
] };
const first = derive(fixture);
assert.equal(first.groups.length, 2, '跨日卖出卡片不能合并到最后一天');
const s1 = first.trades.flatMap(t => t.legs).find(l => l.executionId === 'S1');
const s2 = first.trades.flatMap(t => t.legs).find(l => l.executionId === 'S2');
assert.equal(s1.cost, 10, '后续买入改变了历史卖出成本');
assert.equal(s1.retPct, 20);
assert.equal(s2.cost, 15);
assert.equal(s2.retPct, 0, '持平不能算盈利');
assert.equal(first.trades.filter(t => t.closesEpisode).length, 1, '跨日清仓重复计周期');
assert.equal(first.trades.find(t => t.closesEpisode).cycleResult, 'win');
assert.deepEqual(derive(fixture), first, '重复派生不幂等');
const unknown = structuredClone(fixture);
unknown.executions[0].qty = null;
assert.ok(derive(unknown).trades.every(t => !t.performanceEligible), '缺项参与周期绩效');
unknown.executions[1].price = null;
assert.equal(derive(unknown).trades.flatMap(t => t.legs).find(l => l.executionId === 'S1').retPct, null);
const legacy = structuredClone(unknown);
legacy.closedTrades = [{ trades: [{ episodeId: 'EP', cost: 0, result: 'win', costBasisType: 'netInvested' }] }];
assert.ok(derive(legacy).trades.every(t => t.totalRetPct === null), '零成本或旧盈利标签生成伪收益');
const inherited = {
  accounts: [], closedTrades: [], episodes: [{ episodeId: 'EP', status: 'closed' }],
  costCheckpoints: [{ episodeId: 'EP', beforeExecutionId: 'S1', quantityBefore: 100,
    averageCost: 10, source: { originalCostBasisType: 'actual' } }],
  executions: [event('S1', '2026-10-02', 'sell', 50, 12),
    event('B2', '2026-10-03', 'buy', 50, 20), event('S2', '2026-10-04', 'sell', 100, 15)]
};
const snapshot = derive(inherited);
assert.equal(snapshot.trades[0].legs[0].cost, 10);
assert.equal(snapshot.trades[0].totalRetPct, 20);
assert.equal(snapshot.trades[1].legs[0].cost, 15);
assert.ok(snapshot.trades.every(t => !t.performanceEligible), '历史均价快照被伪装成完整周期');
const ledger = require('./data/ledger-full.json');
const ram = derive(ledger).trades.filter(t => t.sym === 'RAM');
assert.ok(ram.length && ram.every(t => Number.isFinite(t.totalRetPct)), 'RAM已有依据仍显示成本待核实');
const core = ram.filter(t => t.episodeId === 'EP-RAM-2026Q3');
assert.equal(core.find(t => t.soldDate === '2026-09-21').totalRetPct, 7.26924);
assert.equal(core.find(t => t.soldDate === '2026-10-02').totalRetPct, 5.51317);
const withoutFutureBuy = structuredClone(ledger);
withoutFutureBuy.executions = withoutFutureBuy.executions.filter(e => e.date < '2026-10-06');
// 历史卖出收益必须稳定：其后任何加仓/卖出不得回溯改变 <10/6 的已结算成本与收益。
// 10/6 之后的新成交只允许作为当日新增条目（partial/close 卖出），不参与历史一致性比较。
const histOnly = t => t.soldDate < '2026-10-06';
assert.equal(
  JSON.stringify(derive(withoutFutureBuy).trades.filter(t => t.sym === 'RAM').filter(histOnly)),
  JSON.stringify(ram.filter(histOnly)),
  '后续夜盘加仓倒改了RAM历史收益');
console.log('✅ 兑现派生通过：实际日期、移动均价、历史成本来源、清仓去重、缺项、持平、幂等');
assert.equal(chinaExecutionTime({ timestamp: '2026-10-01T13:00:00-04:00' }).date, '2026-10-02');
assert.equal(chinaExecutionTime({ timestamp: '2026-10-01T08:00:00-04:00' }).date, '2026-10-01');
assert.equal(chinaExecutionTime({ timestamp: '2026-12-01T12:00:00-05:00' }).time, '01:00:00');
const undated = chinaExecutionTime({ date: '2026-10-01', timezone: 'America/New_York', time: '盘中' });
assert.equal(undated.date, '2026-10-01'); assert.equal(undated.dateEnd, '2026-10-02');
assert.equal(undated.time, null, '未知时刻不能伪造为0点或重复占位文本');
const cnFixture = structuredClone(fixture);
cnFixture.executions[1].timestamp = '2026-10-02T13:00:00-04:00';
cnFixture.executions[3].timestamp = '2026-10-04T08:00:00-04:00';
const china = presentChinaDates(derive(cnFixture), cnFixture);
assert.equal(china.trades.find(t => t.legs.some(l => l.executionId === 'S1')).soldDate, '2026-10-03');
assert.equal(china.trades.filter(t => t.performanceEligible).length, first.trades.filter(t => t.performanceEligible).length);
assert.equal(china.trades.find(t => t.performanceEligible).cycleRetPct, first.trades.find(t => t.performanceEligible).cycleRetPct);
const split = { accounts: [], closedTrades: [], episodes: [{ episodeId: 'EP', status: 'closed' }],
  executions: [event('B1', '2026-10-01', 'buy', 100, 10),
    { ...event('S1', '2026-10-02', 'sell', 50, 11), timestamp: '2026-10-02T08:00:00-04:00' },
    { ...event('S2', '2026-10-02', 'sell', 50, 12), timestamp: '2026-10-02T13:00:00-04:00' }] };
const splitChina = presentChinaDates(derive(split), split);
assert.equal(splitChina.groups.length, 2, '同一美东日跨两个中国日期未拆分');
assert.equal(splitChina.trades.filter(t => t.closesEpisode).length, 1, '转换日期重复计清仓');
assert.equal(splitChina.trades.find(t => t.closesEpisode).soldDate, '2026-10-03');
assert.equal(splitChina.trades.find(t => t.closesEpisode).cycleRetPct, 15);
const cn = presentChinaDates(derive(ledger), ledger);
assert.equal(cn.trades.flatMap(t => t.legs).length, derive(ledger).trades.flatMap(t => t.legs).length);
assert.equal(cn.trades.filter(t => t.performanceEligible).length, derive(ledger).trades.filter(t => t.performanceEligible).length);
console.log('✅ 中国日期通过：跨日、冬夏时区偏移、缺时刻区间、清仓与收益不变');
const { summarizeHoldings, cleanExecutionNote } = require('./presentation');
const weights = { holdings: [{ sym: 'A', qty: 101, observationQty: 1, lastPrice: 2 }, { sym: 'B', qty: 100, lastPrice: 1 }] };
assert.equal(summarizeHoldings(weights).topSym, 'A');
assert.equal(summarizeHoldings(weights).level, '高');
const missingPrice = structuredClone(weights); missingPrice.holdings[1].lastPrice = null;
assert.equal(summarizeHoldings(missingPrice).available, false, '忽略未知持仓而生成伪集中度');
const onlyObservation = { holdings: [{ sym: 'OBS', qty: 200, analysisQty: 1, lastPrice: 1 }, { sym: 'CORE', qty: 100, lastPrice: 1 }] };
assert.equal(summarizeHoldings(onlyObservation).topSym, 'CORE', '观察份额被计入交易仓集中度');
const pureObservation = { holdings: [{ sym: 'OBS', qty: 1, analysisQty: 0, lastPrice: null }, { sym: 'CORE', qty: 100, lastPrice: 1 }] };
assert.equal(summarizeHoldings(pureObservation).topSym, 'CORE', '纯观察仓缺行情阻断交易仓集中度');
assert.equal(summarizeHoldings(pureObservation).holdings[0].excluded, true);
const unknownQty = structuredClone(weights); unknownQty.holdings[0].qty = null;
assert.equal(summarizeHoldings(unknownQty).available, false);
assert.equal(cleanExecutionNote({ qty: 100, note: '止盈（数量待核实）' }), '止盈');
assert.equal(cleanExecutionNote({ qty: null, note: '止盈（数量待核实）' }), '止盈（数量待核实）', '内部真实缺项被无依据清空');
console.log('✅ 集中度未知值、观察份额、过期数量提示回归通过');
const { validateEpisodeStates } = require('./derive');
const snxxSale = ledger.executions.find(e => e.executionId === 'EX-USER-20261007-SNXX-SELL-057');
const snxx = presentChinaDates(derive(ledger), ledger).trades.find(t => t.episodeId === snxxSale.episodeId);
assert.ok(snxx.closesEpisode && !snxx.isPartial && snxx.performanceEligible, 'SNXX已全清仍显示部分减仓');
assert.equal(snxx.totalRetPct, 2.58044);
assert.deepEqual(validateEpisodeStates(ledger), []);
const stale = structuredClone(ledger);
stale.episodes.find(e => e.episodeId === snxxSale.episodeId).status = 'open';
assert.ok(validateEpisodeStates(stale).some(p => p.includes(snxxSale.episodeId)), 'open与已归零/清仓字段矛盾未拦截');
const falseClose = structuredClone(fixture);
falseClose.episodes[0].exitDate = '2026-10-04';
falseClose.executions.pop();
assert.ok(validateEpisodeStates(falseClose).some(p => p.includes('完整交易仓流水不一致')), '部分卖出被假报完整清仓');
const zeroButOpen = structuredClone(fixture);
zeroButOpen.episodes[0].status = 'open';
assert.ok(validateEpisodeStates(zeroButOpen).some(p => p.includes('完整交易仓流水已归零')), '未写清仓字段时，完整归零周期仍漏检');
assert.equal(ledger.episodes.find(e => e.episodeId === 'EP-SNXX-2026Q3').status, 'open',
  '1号账户全清错误关闭2号账户同标的周期');
const unknownOpen = { episodes: [{ episodeId: 'EP', status: 'open', currentQty: null }],
  executions: [event('B1', '2026-10-01', 'buy', null, 10), event('S1', '2026-10-02', 'sell', 100, 12)] };
assert.deepEqual(validateEpisodeStates(unknownOpen), [], '未知数量被当零或自动清仓');
const { publicExecutionNote, shareCountPatterns } = require('./presentation');
const cleanSnxx = publicExecutionNote(snxxSale);
assert.ok(!cleanSnxx.includes('143'), 'SNXX公开备注仍泄漏股票数量');
assert.ok(cleanSnxx.includes('15.695') && cleanSnxx.includes('+2.6%'), '脱敏误删每股价格/收益率');
assert.equal(publicExecutionNote({ sym: 'STXL', qty: 75, note: '建仓75@27.29' }), '建仓按27.29');
assert.equal(publicExecutionNote({ sym: 'RAM', qty: 100, note: '按13.7减仓，保留2张call' }), '按13.7减仓，保留2张call');
assert.ok(shareCountPatterns(snxxSale).some(p => p.test(snxxSale.note)), '裸写股数检测未覆盖实际遗漏');
console.log('✅ 完整清仓/部分减仓状态与裸写股票数量脱敏回归通过');
const confirmedDays = new Map([
  ['EX-20261005-AVGX-SELL-052', '2026-10-05'], ['EX-20261005-LABU-SELL-054', '2026-10-05'],
  ['EX-20261005-GDXU-SELL-055', '2026-10-05'], ['EX-20261002-RAM-SELL-008', '2026-10-02'],
  ['EX-20261002-IRE-SELL-015', '2026-10-02'], ['EX-20261002-IRE-SELL-016', '2026-10-02']
]);
for (const [id, day] of confirmedDays) {
  const leg = cn.trades.flatMap(t => t.legs).find(l => l.executionId === id);
  assert.equal(leg.date, day, '已确认成交日期仍被跨日显示: ' + id);
  assert.equal(leg.datePrecision, 'day');
  assert.equal(leg.time, null, '确认日期却伪造成交时刻');
  assert.equal(cn.trades.flatMap(t => t.legs).filter(l => l.executionId === id).length, 1);
}
assert.ok(!cn.groups.some(g => ['2026-10-05/2026-10-06', '2026-10-02/2026-10-03'].includes(g.date)),
  '已经确认的旧日期区间仍被发布');
const originalDates = structuredClone(ledger);
for (const e of originalDates.executions) if (confirmedDays.has(e.executionId)) { delete e.chinaDate; delete e.chinaDateSource; }
assert.deepEqual(derive(originalDates), derive(ledger), '日期展示纠正改变了成本、收益或周期核算');
assert.equal(cn.trades.filter(t => t.closesEpisode).length, derive(originalDates).trades.filter(t => t.closesEpisode).length,
  '按中国日期合并卡片重复或漏计清仓');
console.log('✅ 用户确认日期按单日合并、未知时刻保留、流水/成本/清仓计数不变');
