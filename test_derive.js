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
console.log('✅ 兑现派生通过：实际日期、移动均价、清仓去重、缺项、持平、幂等');
