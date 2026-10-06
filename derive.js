// 一条卖出只出现一次，按实际成交日分组；缺项保留 null。
// closedTrades 仅保留历史文字/成本来源，不作为另一套成交流水。
const ACCT_NAME = { main: '主账号', sat1: '1号小账号', sat2: '2号小账号', cn: 'A股账户' };
const number = v => typeof v === 'number' && Number.isFinite(v);
const positive = v => number(v) && v > 0;
const round = v => Math.round(v * 100000) / 100000;
const resultOf = v => !number(v) ? null : v > 0 ? 'win' : v < 0 ? 'loss' : 'flat';
const { cleanExecutionNote } = require('./presentation');

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
    const checkpoints = (ledger.costCheckpoints || []).filter(c => c.episodeId === episodeId);
    // An inherited position can supply a valid cost basis without supplying an entire entry-to-exit cycle.
    const complete = checkpoints.length === 0 && buys.length > 0 && events.every(e => positive(e.qty) && positive(e.price));
    let balance = 0, avg = null, known = true;
    let costSourceNote = '移动加权均价';
    const legs = [];
    for (const e of events) {
      const checkpoint = checkpoints.find(c => c.beforeExecutionId === e.executionId);
      if (checkpoint && positive(checkpoint.quantityBefore) && positive(checkpoint.averageCost) &&
          checkpoint.source && checkpoint.source.originalCostBasisType === 'actual') {
        balance = checkpoint.quantityBefore; avg = checkpoint.averageCost; known = true;
        costSourceNote = '历史实际均价基准，后续移动加权';
      }
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
        executionId: e.executionId, date: e.date, time: e.time || null,
        price: number(e.price) ? e.price : null, qty: positive(e.qty) ? e.qty : null,
        cost: cost === null ? null : round(cost), costBasisType: basis,
        retPct: ret, note: cleanExecutionNote(e),
        costNote: fromFlow ? costSourceNote : (legacy.costNote || '成本待核实')
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
        totalRetNote: totalRet === null ? '加权收益待核实；相对摊薄成本的涨幅不代表真实盈亏' : '当日卖出成本收益率，非账户收益',
        cycleRetPct: closesEpisode && positive(cycleCapital) ? round(cyclePnl / cycleCapital * 100) : null,
        cycleResult: closesEpisode ? cycleResult : null,
        performanceEligible: closesEpisode && cycleKnown,
        reason: closesEpisode ? legacy.reason || ep.exitReason || '清仓登记' : '部分减仓兑现',
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
const partsAt = (ms, timezone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
function localInstant(date, time, timezone) {
  const target = Date.parse(date + 'T' + time + 'Z');
  let ms = target;
  for (let i = 0; i < 3; i++) {
    const p = partsAt(ms, timezone);
    ms += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return ms;
}
function chinaExecutionTime(e) {
  const instant = e.timestamp || e.source?.statementTimestamp;
  if (instant && /(?:Z|[+-]\d{2}:\d{2})$/.test(instant) && Number.isFinite(Date.parse(instant))) {
    const p = partsAt(Date.parse(instant), 'Asia/Shanghai');
    return { date: `${p.year}-${p.month}-${p.day}`, dateEnd: `${p.year}-${p.month}-${p.day}`,
      time: `${p.hour}:${p.minute}:${p.second}`, timezone: 'Asia/Shanghai', datePrecision: 'instant' };
  }
  // A confirmed local day is valid even when the exact execution clock is missing.
  if (e.chinaDate && e.chinaDateSource) return { date: e.chinaDate, dateEnd: e.chinaDate,
    time: null, timezone: 'Asia/Shanghai', datePrecision: 'day' };
  const zone = e.timezone || 'America/New_York';
  if (zone === 'Asia/Shanghai' || zone === 'Asia/Hong_Kong') return { date: e.date, dateEnd: e.date,
    time: null, timezone: 'Asia/Shanghai', datePrecision: 'day' };
  // A source calendar day can span two China dates. Session words are not timestamps.
  const a = partsAt(localInstant(e.date, '00:00:00', zone), 'Asia/Shanghai');
  const b = partsAt(localInstant(e.date, '23:59:59', zone), 'Asia/Shanghai');
  return { date: `${a.year}-${a.month}-${a.day}`, dateEnd: `${b.year}-${b.month}-${b.day}`,
    time: null, timezone: 'Asia/Shanghai', datePrecision: 'range' };
}
function presentChinaDates(derived, ledger) {
  const executions = new Map(ledger.executions.map(e => [e.executionId, e]));
  const combined = new Map();
  for (const t of derived.trades) {
    for (let i = 0; i < t.legs.length; i++) {
      const l = t.legs[i], e = executions.get(l.executionId);
      const display = chinaExecutionTime(e);
      const key = display.date === display.dateEnd ? display.date : display.date + '/' + display.dateEnd;
      const id = t.episodeId + ':' + key;
      const last = t.closesEpisode && i === t.legs.length - 1;
      if (!combined.has(id)) combined.set(id, { ...t, tradeId: id, soldDate: key, dateStart: display.date,
        dateEnd: display.dateEnd, legs: [], closesEpisode: false, performanceEligible: false,
        cycleRetPct: null, cycleResult: null });
      const out = combined.get(id);
      out.legs.push({ ...l, ...display, date: key });
      if (last) Object.assign(out, { closesEpisode: true, performanceEligible: t.performanceEligible,
        cycleRetPct: t.cycleRetPct, cycleResult: t.cycleResult, reason: t.reason });
    }
  }
  const trades = [...combined.values()];
  for (const t of trades) {
    t.isPartial = !t.closesEpisode;
    if (t.isPartial) t.reason = '部分减仓兑现';
    const same = t.legs.every(l => l.cost === t.legs[0].cost);
    t.cost = same ? t.legs[0].cost : null;
    t.costNote = same ? t.legs[0].costNote : '分批成本见成交备注';
    const known = t.legs.every(l => positive(l.qty) && positive(l.price) && positive(l.cost) && l.costBasisType === 'actual');
    const capital = known ? t.legs.reduce((s, l) => s + l.qty * l.cost, 0) : null;
    const pnl = known ? t.legs.reduce((s, l) => s + l.qty * (l.price - l.cost), 0) : null;
    t.totalRetPct = positive(capital) ? round(pnl / capital * 100) : null;
    t.result = resultOf(pnl);
  }
  const days = new Map();
  for (const t of trades) {
    if (!days.has(t.soldDate)) days.set(t.soldDate, { date: t.soldDate, dateStart: t.dateStart,
      dateEnd: t.dateEnd, timezone: 'Asia/Shanghai', dateLabel: t.dateStart === t.dateEnd ? t.dateStart : t.dateStart + '—' + t.dateEnd,
      trades: [] });
    days.get(t.soldDate).trades.push(t);
  }
  return { trades, groups: [...days.values()].sort((a, b) => b.dateEnd.localeCompare(a.dateEnd) || b.date.localeCompare(a.date)) };
}

module.exports = { derive, chinaExecutionTime, presentChinaDates };
