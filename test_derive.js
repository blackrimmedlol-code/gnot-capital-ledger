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
