const assert = require('node:assert/strict');
const { derive } = require('./derive');
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
assert.deepEqual(derive(withoutFutureBuy).trades.filter(t => t.sym === 'RAM'), ram,
  '后续夜盘加仓倒改了RAM历史收益');
console.log('✅ 兑现派生通过：实际日期、移动均价、历史成本来源、清仓去重、缺项、持平、幂等');
