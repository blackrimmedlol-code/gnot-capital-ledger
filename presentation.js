// Build-time presentation: public stock weights are permitted; quantities and money stay internal.
const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
function summarizeHoldings(account) {
  const holdings = account.holdings || [];
  const values = holdings.map(h => {
    const qty = h.analysisQty !== undefined ? h.analysisQty :
      (typeof h.qty === 'number' ? h.qty - (h.observationQty || 0) : null);
    if (qty === 0) return 0; // Confirmed pure observation holdings do not need a trading valuation.
    return positive(qty) && positive(h.lastPrice) ? qty * h.lastPrice : null;
  });
  const rows = values.map(v => v === 0 ? { excluded: true } : {});
  const available = values.some(positive) && values.every(v => v === 0 || positive(v));
  if (!available) return { available: false, topSym: null, level: null,
    holdings: rows.map(r => r.excluded ? r : { stockWeightPct: null }) };
  const total = values.reduce((s, v) => s + v, 0);
  const order = values.map((v, i) => i).filter(i => values[i] > 0).sort((a, b) => values[b] - values[a] || a - b);
  const level = v => v / total >= 0.5 ? '高' : v / total >= 0.25 ? '中' : '低';
  return {
    available: true, topSym: holdings[order[0]].sym, level: level(values[order[0]]),
    holdings: holdings.map((h, i) => values[i] === 0 ? rows[i] : {
      weightRank: order.indexOf(i) + 1, weightLevel: level(values[i]),
      stockWeightPct: Math.round(values[i] / total * 1000) / 10 })
  };
}
function cleanExecutionNote(event) {
  // This obsolete phrase can be removed only after the source quantity is known.
  const note = event.note || '';
  return positive(event.qty) ? note.replace(/[（(]\s*数量待核实\s*[）)]/g, '').trim() : note;
}
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function shareCountPatterns(event) {
  const sym = escapeRegex(event.sym || '');
  if (!sym) return [];
  const quantities = [...new Set([event.qty, event.analysisQty, event.observationQty].filter(positive))];
  return quantities.flatMap(q => {
    const qty = escapeRegex(q);
    return [new RegExp('(' + sym + ')\\s+' + qty + '(?=[\\s（(，,；;）)]|$)', 'g'),
      new RegExp(qty + '\\s*(?:股)?\\s*(' + sym + ')(?![A-Z])', 'g')];
  });
}
function publicExecutionNote(event) {
  let note = cleanExecutionNote(event);
  for (const pattern of shareCountPatterns(event)) note = note.replace(pattern, '$1');
  note = note.replace(/\d+(?:,\d{3})*\s*股/g, '部分仓位')
    .replace(/\d+(?:,\d{3})*\s*[@＠]\s*(\d+(?:\.\d+)?)/g, '按$1');
  return note.trim();
}
module.exports = { summarizeHoldings, cleanExecutionNote, publicExecutionNote, shareCountPatterns };
