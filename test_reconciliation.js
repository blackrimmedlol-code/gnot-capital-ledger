// Regression for broker evidence, real dates, residual shares, and explicit unresolved balances.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { derive } = require('./derive');
const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/ledger-full.json'), 'utf8'));
const sells = ledger.executions.filter(e => e.episodeId === 'EP-MSTU-CLOSED-20261001' && e.side === 'sell');
const buys = ledger.executions.filter(e => e.episodeId === 'EP-MSTU-CLOSED-20261001' && e.side === 'buy');
assert.deepStrictEqual(buys.map(e => e.qty), [51, 35, 60, 25]);
assert.deepStrictEqual(sells.map(e => e.qty), [100, 35, 35, 1]);
assert.strictEqual(buys.reduce((s, e) => s + e.qty, 0), sells.reduce((s, e) => s + e.qty, 0));
const last = sells.find(e => e.executionId === 'EX-USER-20261002-MSTU-SELL-LAST');
assert.strictEqual(last.date, '2026-10-02');
assert.strictEqual(last.price, 46.3);
assert(last.fee === null || last.fee >= 0);
assert.strictEqual(last.analysisQty, 0);
assert.strictEqual(last.includeInPerformance, false);
const mt = derive(ledger).trades.find(t => t.episodeId === last.episodeId && t.soldDate === '2026-10-01');
assert(mt && mt.performanceEligible && mt.closesEpisode);
assert(!derive(ledger).trades.some(t => t.legs.some(l => l.executionId === last.executionId)));
const tradingBuys = buys.reduce((s, e) => s + (e.analysisQty === undefined ? e.qty : e.analysisQty), 0);
const tradingSells = sells.reduce((s, e) => s + (e.analysisQty === undefined ? e.qty : e.analysisQty), 0);
assert.strictEqual(tradingBuys, 170); assert.strictEqual(tradingBuys, tradingSells);
const corrected = ledger.executions.find(e => e.sym === 'IRE' && e.side === 'sell' && e.date === '2026-09-24');
assert.strictEqual(corrected.price, 12.2);
assert.strictEqual(corrected.qty, 100);
const brokerEvents = ledger.executions.filter(e => e.source && e.source.type === 'broker_statement');
const keys = new Set();
for (const e of brokerEvents) {
  assert.strictEqual(e.brokerFills.reduce((s, f) => s + f.qty, 0), e.qty);
  assert.strictEqual(e.date, e.timestamp.slice(0, 10));
  assert.strictEqual(new Date(e.timestamp).getTime(), new Date(e.source.statementTimestamp).getTime());
  assert.strictEqual(e.source.statementTimezone, 'Asia/Hong_Kong');
  assert(e.fee >= 0 && e.currency === 'USD');
  const key = [e.source.sourceId, e.sym, e.side, e.timestamp, e.price, e.qty].join('|');
  assert(!keys.has(key), 'Broker order imported twice'); keys.add(key);
}
// An explicit pending item must have broker snapshot evidence. It never excuses an unexplained mismatch.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-reconcile-'));
try {
  fs.mkdirSync(path.join(temp, 'data'));
  for (const f of ['verify.js', 'derive.js', 'template.html', 'RULES_日常更新.md']) fs.copyFileSync(path.join(__dirname, f), path.join(temp, f));
  const baseline = JSON.parse(JSON.stringify(ledger));
  const baselineHolding = baseline.accounts.find(a => a.id === 'main').holdings.find(h => h.sym === 'CRWG');
  baselineHolding.qty = 101;
  baselineHolding.actualCostBasis = { value: null, status: '待核实' };
  baselineHolding.netInvestedCost.status = '待核实';
  baseline.reconciliations.push({ account: 'main', sym: 'CRWG', status: 'pending', knownQuantity: 100,
    reportedQuantity: 101, statementAsOf: '2026-09-30', sourceId: 'futu-main-20260930', note: 'test: later balance not reconciled' });
  fs.writeFileSync(path.join(temp, 'data/ledger-full.json'), JSON.stringify(baseline));
  let r = spawnSync(process.execPath, ['verify.js'], { cwd: temp, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const broken = JSON.parse(JSON.stringify(baseline)); broken.sourceDocuments = [];
  fs.writeFileSync(path.join(temp, 'data/ledger-full.json'), JSON.stringify(broken));
  r = spawnSync(process.execPath, ['verify.js'], { cwd: temp, encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0); assert((r.stdout + r.stderr).includes('CRWG(main) 持仓对账失败'));
  const falseCost = JSON.parse(JSON.stringify(baseline));
  falseCost.accounts.find(a => a.id === 'main').holdings.find(h => h.sym === 'CRWG').actualCostBasis.status = '确认';
  fs.writeFileSync(path.join(temp, 'data/ledger-full.json'), JSON.stringify(falseCost));
  r = spawnSync(process.execPath, ['verify.js'], { cwd: temp, encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0); assert((r.stdout + r.stderr).includes('余额差异未解决'));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('✅ 结单证据、香港/美东时间、观察仓清仓、未知值和未解决差异回归通过');
