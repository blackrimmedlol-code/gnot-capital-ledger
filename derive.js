// 一条卖出只出现一次，按实际成交日分组；缺项保留 null。
// closedTrades 仅保留历史文字/成本来源，不作为另一套成交流水。
const ACCT_NAME = { main: '主账号', sat1: '1号小账号', sat2: '2号小账号', cn: 'A股账户' };
const number = v => typeof v === 'number' && Number.isFinite(v);
const positive = v => number(v) && v > 0;
const round = v => Math.round(v * 100000) / 100000;
const resultOf = v => !number(v) ? null : v > 0 ? 'win' : v < 0 ? 'loss' : 'flat';

function derive(ledger) {
  const legacyByEp = new Map();
  (ledger.closedTrades || []).forEach(d => (d.trades || []).forEach(t => {
    if (t.episodeId) legacyByEp.set(t.episodeId, t);
  }));
  const names = new Map();
  (ledger.accounts || []).forEach(a => (a.holdings || []).forEach(h => names.set(h.sym, h.name)));
  const byEpisode = new Map();
  (ledger.executions || []).forEach((e, index) => {
    if (e.includeInPerformance === false || e.analysisQty === 0) return;
    if (!byEpisode.has(e.episodeId)) byEpisode.set(e.episodeId, []);
    byEpisode.get(e.episodeId).push({ ...e, qty: e.analysisQty === undefined ? e.qty : e.analysisQty, index });
  });
  const trades = [];
  byEpisode.forEach((events, episodeId) => {
    // 同日无精确时间时保留原始录入顺序；后续买入不能改变此前卖出成本。
    events.sort((a, b) => a.date.localeCompare(b.date) ||
      (a.timestamp && b.timestamp ? a.timestamp.localeCompare(b.timestamp) : a.index - b.index));
    const sells = events.filter(e => e.side === 'sell');
    if (!sells.length) return;
    const ep = (ledger.episodes || []).find(e => e.episodeId === episodeId);
    const legacy = legacyByEp.get(episodeId) || {};
    const buys = events.filter(e => e.side === 'buy');
    const complete = buys.length > 0 && events.every(e => positive(e.qty) && positive(e.price));
    let balance = 0, avg = null, known = true;
    const legs = [];
    for (const e of events) {
      if (e.side === 'buy') {
        if (!positive(e.qty) || !positive(e.price)) { known = false; continue; }
        if (known) {
          avg = balance === 0 ? e.price : (balance * avg + e.qty * e.price) / (balance + e.qty);
          balance += e.qty;
        }
        continue;
      }
      if (e.side !== 'sell') continue;
      const fromFlow = known && positive(avg) && balance > 0 && (!positive(e.qty) || e.qty <= balance);
      const cost = fromFlow ? avg : positive(legacy.cost) ? legacy.cost : null;
      const basis = fromFlow ? 'actual' : (legacy.costBasisType || 'unknown');
      const ret = positive(cost) && positive(e.price) ? round((e.price - cost) / cost * 100) : null;
      legs.push({
        executionId: e.executionId, date: e.date, time: e.time || '时间待核实',
        price: number(e.price) ? e.price : null, qty: positive(e.qty) ? e.qty : null,
        cost: cost === null ? null : round(cost), costBasisType: basis,
        retPct: ret, note: e.note || '',
        costNote: fromFlow ? '移动加权均价，未计费用' : (legacy.costNote || '成本待核实')
      });
      if (known && fromFlow && positive(e.qty)) {
        balance -= e.qty;
        if (balance === 0) avg = null;
      } else known = false;
    }
    const lastDate = sells.map(e => e.date).sort().pop();
    const closed = !!ep && ep.status === 'closed';
    const cycleKnown = closed && complete && known && balance === 0 && legs.every(l => positive(l.cost) && l.costBasisType === 'actual');
    const cycleCapital = cycleKnown ? legs.reduce((s, l) => s + l.qty * l.cost, 0) : null;
    const cyclePnl = cycleKnown ? legs.reduce((s, l) => s + l.qty * (l.price - l.cost), 0) : null;
    const cycleResult = cycleKnown ? resultOf(cyclePnl) : null;
    const byDate = new Map();
    legs.forEach(l => { if (!byDate.has(l.date)) byDate.set(l.date, []); byDate.get(l.date).push(l); });
    byDate.forEach((dayLegs, date) => {
      const quantitiesKnown = dayLegs.every(l => positive(l.qty));
      const costsKnown = dayLegs.every(l => positive(l.cost) && positive(l.price) && l.costBasisType === 'actual');
      const capital = quantitiesKnown && costsKnown ? dayLegs.reduce((s, l) => s + l.qty * l.cost, 0) : null;
      const pnl = capital === null ? null : dayLegs.reduce((s, l) => s + l.qty * (l.price - l.cost), 0);
      const totalRet = positive(capital) ? round(pnl / capital * 100) : null;
      const sameCost = dayLegs.every(l => l.cost === dayLegs[0].cost);
      const closesEpisode = closed && date === lastDate;
      trades.push({
        tradeId: episodeId + ':' + date, episodeId, sym: sells[0].sym,
        name: legacy.name || names.get(sells[0].sym) || sells[0].sym,
        acct: ACCT_NAME[sells[0].account] || sells[0].account,
        cost: sameCost ? dayLegs[0].cost : null,
        costNote: sameCost ? dayLegs[0].costNote : '分批成本见成交备注',
        legs: dayLegs, soldDate: date, isPartial: !closesEpisode, closesEpisode,
        totalRetPct: totalRet, result: resultOf(pnl),
        totalRetNote: totalRet === null ? '加权收益待核实；相对摊薄成本的涨幅不代表真实盈亏' : '当日卖出成本收益率，未计费用，非账户收益',
        cycleRetPct: closesEpisode && positive(cycleCapital) ? round(cyclePnl / cycleCapital * 100) : null,
        cycleResult: closesEpisode ? cycleResult : null,
        performanceEligible: closesEpisode && cycleKnown,
        reason: legacy.reason || (closesEpisode ? ep.exitReason || '清仓登记' : '部分减仓兑现'),
        setup: legacy.setup || [], execStatus: legacy.execStatus || 'unknown', oneLiner: legacy.oneLiner || ''
      });
    });
  });
  const byDate = new Map();
  trades.forEach(t => { if (!byDate.has(t.soldDate)) byDate.set(t.soldDate, []); byDate.get(t.soldDate).push(t); });
  const groups = [...byDate].map(([date, ts]) => ({ date, dateLabel: date, trades: ts }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { groups, trades };
}
module.exports = { derive };
