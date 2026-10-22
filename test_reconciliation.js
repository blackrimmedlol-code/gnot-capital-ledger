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
// Use an isolated open position for balance-error cases. These checks must
// still exercise missing evidence after the real CRWG position is closed.
function openBalanceFixture() {
  const sample = JSON.parse(JSON.stringify(ledger));
  const episodeId = 'EP-CRWG-2026Q3';
  sample.executions = sample.executions.filter(e => e.episodeId !== episodeId);
  sample.executions.push({ executionId: 'TEST-CRWG-BALANCE-BUY', episodeId,
    account: 'main', sym: 'CRWG', side: 'buy', qty: 200, price: 10,
    date: '2026-09-01', timezone: 'America/New_York' });
  const remainingIds = new Set(sample.executions.map(e => e.executionId));
  for (const review of sample.reviews) review.executionIds = (review.executionIds || []).filter(id => remainingIds.has(id));
  sample.openingPositions = (sample.openingPositions || []).filter(o => !(o.account === 'main' && o.sym === 'CRWG'));
  sample.costCheckpoints = (sample.costCheckpoints || []).filter(c => c.episodeId !== episodeId);
  sample.reconciliations = (sample.reconciliations || []).filter(r => !(r.account === 'main' && r.sym === 'CRWG'));
  const account = sample.accounts.find(a => a.id === 'main');
  account.holdings = account.holdings.filter(h => h.sym !== 'CRWG');
  account.holdings.push({ sym: 'CRWG', qty: 200, cost: 10, episodeId, options: [],
    actualCostBasis: { value: 10, status: '确认' },
    netInvestedCost: { value: 10, status: '确认', scope: 'episode', episodeId } });
  const ep = sample.episodes.find(e => e.episodeId === episodeId);
  Object.assign(ep, { status: 'open', currentQty: 200, entryDate: '2026-09-01', exitDate: null, exitReason: null });
  delete ep.closeDate; delete ep.closeReason;
  return sample;
}
try {
  fs.mkdirSync(path.join(temp, 'data'));
  for (const f of ['verify.js', 'derive.js', 'presentation.js', 'review_dates.js', 'template.html', 'RULES_日常更新.md']) fs.copyFileSync(path.join(__dirname, f), path.join(temp, f));
  const baseline = openBalanceFixture();
  const mismatchedEpisode = openBalanceFixture();
  const activeCrwg = mismatchedEpisode.episodes.find(e => e.episodeId === 'EP-CRWG-2026Q3');
  const crwgHolding = mismatchedEpisode.accounts.find(a => a.id === 'main').holdings.find(h => h.sym === 'CRWG');
  if (activeCrwg.status === 'open') {
    activeCrwg.currentQty = (crwgHolding.analysisQty ?? crwgHolding.qty) + 1;
    fs.writeFileSync(path.join(temp, 'data/ledger-full.json'), JSON.stringify(mismatchedEpisode));
    const mismatch = spawnSync(process.execPath, ['verify.js'], { cwd: temp, encoding: 'utf8' });
    assert.notStrictEqual(mismatch.status, 0, 'Stale episode balance passed');
    assert((mismatch.stdout + mismatch.stderr).includes('持仓与当前周期余额不一致'));
  }
  // RAM's confirmed observation share is real collateral, not a fictitious trade.
  const allocated = JSON.parse(JSON.stringify(ledger));
  const ram = allocated.accounts.find(a => a.id === 'main').holdings.find(h => h.sym === 'RAM');
  if (ram.analysisQty !== undefined) {
    fs.writeFileSync(path.join(temp, 'data/ledger-full.json'), JSON.stringify(allocated));
    let result = spawnSync(process.execPath, ['verify.js'], { cwd: temp, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    ram.qty += 1;
    fs.writeFileSync(path.join(temp, 'data/ledger-full.json'), JSON.stringify(allocated));
    result = spawnSync(process.execPath, ['verify.js'], { cwd: temp, encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0, 'Unexplained physical-share difference passed');
    assert((result.stdout + result.stderr).includes('持仓观察份额分配无效'));
    ram.observationQty += 1;
    fs.writeFileSync(path.join(temp, 'data/ledger-full.json'), JSON.stringify(allocated));
    result = spawnSync(process.execPath, ['verify.js'], { cwd: temp, encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0, 'Invented observation share passed');
    assert((result.stdout + result.stderr).includes('持仓实股对账失败'));
  }
  const baselineHolding = baseline.accounts.find(a => a.id === 'main').holdings.find(h => h.sym === 'CRWG');
  // Build an isolated evidence fixture from the current balance; future real fills
  // must not invalidate the historical unresolved-balance regression.
  const knownQuantity = baselineHolding.analysisQty ?? baselineHolding.qty;
  const reportedQuantity = knownQuantity + 1;
  const sourceId = 'test-current-crwg-balance';
  const statementAsOf = baseline.accounts.find(a => a.id === 'main').holdingsAsOf;
  baseline.sourceDocuments.push({ sourceId, note: 'Synthetic evidence used only by this regression' });
  baseline.statementPositions.push({ sourceId, asOf: statementAsOf, account: 'main', holdings: { CRWG: knownQuantity } });
  baselineHolding.qty += 1;
  if (baselineHolding.analysisQty !== undefined) baselineHolding.analysisQty += 1;
  baselineHolding.actualCostBasis = { value: null, status: '待核实' };
  baselineHolding.netInvestedCost.status = '待核实';
  baseline.reconciliations.push({ account: 'main', sym: 'CRWG', status: 'pending', knownQuantity,
    reportedQuantity, statementAsOf, sourceId, note: 'test: later balance not reconciled' });
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

