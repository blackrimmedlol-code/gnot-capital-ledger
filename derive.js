// derive.js — 从 ledger 派生成交兑现视图（closedTrades）
// 原则：事实字段（价格/数量/日期/收益）全部来自 executions，不重新手填；
//      评语字段（name/cost注记/reason/result/setup/execStatus/oneLiner）继承历史 closedTrades（按 episodeId 关联），兼容历史；
//      缺 qty/成本 → 缺项保留 null、收益显示「待核实」，不参与无法计算的绩效统计；
//      部分卖出进兑现记录但不算完整清仓；只有 episode closed 才关闭周期。
//      按真实卖出日期倒序，最新置顶。
// 用法: const { derive } = require('./derive.js');
const ACCT_NAME = { main: '主账号', sat1: '1 号小账号', sat2: '2 号小账号', cn: 'A 股账户' };

function derive(ledger) {
  // 历史 closedTrades 评语（按 episodeId 关联，仅继承文字，不覆盖事实）
  const legacyByEp = {};
  (ledger.closedTrades || []).forEach(d => (d.trades || []).forEach(t => { legacyByEp[t.episodeId] = t; }));

  // sym → 名称（来自当前 holdings，兼 A 股）
  const symName = {};
  (ledger.accounts || []).forEach(a => (a.holdings || []).forEach(h => { if (h.sym && h.name) symName[h.sym] = h.name; }));

  // executions 按 episode 聚合
  const exByEp = {};
  ledger.executions.forEach(e => { (exByEp[e.episodeId] = exByEp[e.episodeId] || []).push(e); });

  const trades = [];
  Object.entries(exByEp).forEach(([epId, exs]) => {
    const sells = exs.filter(e => e.side === 'sell');
    if (sells.length === 0) return; // 无卖出 → 无兑现记录
    const ep = ledger.episodes.find(x => x.episodeId === epId);
    const buys = exs.filter(e => e.side === 'buy');
    const leg0 = legacyByEp[epId] || {};

    // 买入成本：仅当该 episode 所有买入腿 qty 完整才加权（避免用部分流水当全部成本，违规高估）；否则待核实
    const allBuysKnown = buys.length > 0 && buys.every(b => b.qty !== null && b.qty !== undefined && b.qty > 0);
    let avgCost = null, costNote = '待核实';
    if (allBuysKnown) {
      const qty = buys.reduce((s, b) => s + b.qty, 0);
      const amt = buys.reduce((s, b) => s + b.qty * (b.price || 0), 0);
      if (qty > 0) { avgCost = Math.round(amt / qty * 100000) / 100000; costNote = '摊薄成本'; }
    }
    let costRef = avgCost;
    if (costRef === null && leg0.cost !== null && leg0.cost !== undefined) { costRef = leg0.cost; costNote = leg0.costNote || '历史成本口径'; }

    // 卖出 legs（事实来自 execution；单腿收益率相对成本价，仅需成本+价格，不需 qty）
    const legs = sells.map(s => {
      const ret = (costRef !== null && s.price !== null && s.price !== undefined)
        ? Math.round((s.price - costRef) / costRef * 1000) / 10
        : null;
      return {
        executionId: s.executionId,
        date: s.date, time: s.time || s.date, price: s.price,
        qty: (s.qty === null || s.qty === undefined) ? null : s.qty,
        retPct: ret,
        note: (ret === null && !s.note) ? '收益待核实（缺成本或数量）' : (s.note || '')
      };
    });

    const soldQty = sells.every(s => s.qty !== null && s.qty !== undefined)
      ? sells.reduce((x, s) => x + s.qty, 0) : null;
    const initialQty = buys.length && buys.every(b => b.qty !== null && b.qty !== undefined && b.qty > 0)
      ? buys.reduce((x, b) => x + b.qty, 0)
      : (leg0.qty !== null && leg0.qty !== undefined ? leg0.qty : null);

    const lastSellDate = sells.map(s => s.date).sort().pop();
    const isFullClose = !!(ep && ep.status === 'closed');

    // 加权总回报：仅当数量完整 + 成本已知
    let totalRet = null;
    if (sells.every(s => s.qty !== null && s.qty > 0) && costRef !== null) {
      const denom = sells.reduce((x, s) => x + s.qty, 0);
      totalRet = denom > 0
        ? Math.round(sells.reduce((x, s) => x + s.qty * ((s.price - costRef) / costRef) * 100, 0) / denom * 10) / 10
        : null;
    }
    const totalRetOK = totalRet !== null;
    const result = (leg0.result === 'win' || leg0.result === 'loss') ? leg0.result : (isFullClose ? (totalRetOK ? (totalRet >= 0 ? 'win' : 'loss') : null) : null);

    trades.push({
      tradeId: epId, sym: exs[0].sym, name: leg0.name || symName[exs[0].sym] || exs[0].sym,
      acct: ACCT_NAME[exs[0].account] || exs[0].account,
      episodeId: epId, qty: initialQty, cost: costRef, costNote: costNote,
      legs: legs,
      soldDate: lastSellDate, isPartial: !isFullClose,
      totalRetPct: totalRet,
      totalRetNote: totalRetOK ? '毛盈亏，未扣费用' : '收益待核实（缺数量/成本）',
      reason: leg0.reason || (isFullClose ? (ep && ep.exitReason ? ep.exitReason : '完整清仓') : '部分减仓兑现'),
      result: result, setup: leg0.setup || [], execStatus: leg0.execStatus || (isFullClose ? null : 'partial'),
      oneLiner: leg0.oneLiner
    });
  });

  // 按真实卖出日期倒序分组
  const byDate = {};
  trades.forEach(t => { const d = t.soldDate; (byDate[d] = byDate[d] || []).push(t); });
  const groups = Object.entries(byDate).map(([date, ts]) => ({ date: date, dateLabel: date, trades: ts }))
    .sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)));

  return { groups, trades };
}

module.exports = { derive };