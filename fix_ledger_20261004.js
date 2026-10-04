// fix_ledger_20261004.js — 一次性数据修复脚本
// 修复：CRWG重复成交 / episodeId重复 / CRWG netInvestedCost 重算
// 用法: node fix_ledger_20261004.js
// 前置：已备份 ledger-full.json
const fs = require('fs');
const path = require('path');
const LEDGER = path.join(__dirname, 'data', 'ledger-full.json');

const j = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const log = [];
const fix = m => log.push('🔧 ' + m);
const ok = m => log.push('✅ ' + m);

// ============ A. CRWG 重复成交去重 ============
const sell038 = j.executions.filter(e => e.executionId === 'EX-20260922-CRWG-SELL-038');
const sell010 = j.executions.filter(e => e.executionId === 'EX-20260922-CRWG-SELL-010');
if (sell038.length !== 1 || sell010.length !== 1) {
  console.error('CRWG SELL-010/038 匹配数异常:', sell010.length, sell038.length);
  process.exit(1);
}
const A = sell038[0], B = sell010[0];
const sameExec = A.account === B.account && A.sym === B.sym && A.date === B.date && A.qty === B.qty && A.price === B.price;
if (!sameExec) {
  console.error('SELL-010/038 并非同一笔成交，中止（避免误删真实不同成交）');
  process.exit(1);
}
j.executions = j.executions.filter(e => e.executionId !== 'EX-20260922-CRWG-SELL-038');
fix('删除重复成交 EX-20260922-CRWG-SELL-038（与 SELL-010 同账户/标的/日期/数量100/价格17.26，保留 SELL-010→EP-CRWG-2026Q3）');

// ============ B. 删除错误 episode EP-CRWG-CLOSED-20260922 ============
if (j.episodes.filter(e => e.episodeId === 'EP-CRWG-CLOSED-20260922').length !== 1) {
  console.error('EP-CRWG-CLOSED-20260922 匹配数异常');
  process.exit(1);
}
j.episodes = j.episodes.filter(e => e.episodeId !== 'EP-CRWG-CLOSED-20260922');
fix('删除 EP-CRWG-CLOSED-20260922（CRWG 仅部分减仓、仍持101股，不构成完整结束周期）');

// ============ C. closedTrades CRWG-SELL 指向 open 周期 ============
let crwgClosedTradeFixed = false;
j.closedTrades.forEach(d => d.trades.forEach(t => {
  if (t.tradeId === 'CRWG-SELL' && t.episodeId === 'EP-CRWG-CLOSED-20260922') {
    t.episodeId = 'EP-CRWG-2026Q3';
    crwgClosedTradeFixed = true;
  }
}));
if (!crwgClosedTradeFixed) { console.error('未找到 CRWG-SELL 的 closedTrades 记录'); process.exit(1); }
fix('closedTrades CRWG-SELL.episodeId → EP-CRWG-2026Q3（部分止盈归属 open 周期）');

// ============ D. SOXS 按账号拆分 episodeId ============
let soxsFixed = 0;
j.episodes.forEach(e => {
  if (e.sym === 'SOXS' && e.episodeId === 'EP-SOXS-CLOSED-20260923' && e.account === 'sat1') {
    e.episodeId = 'EP-SOXS1-CLOSED-20260923';
    soxsFixed++;
  }
});
j.executions.forEach(e => {
  if (e.executionId === 'EX-20260923-SOXS-SELL-036') { e.episodeId = 'EP-SOXS1-CLOSED-20260923'; soxsFixed++; }
});
j.closedTrades.forEach(d => d.trades.forEach(t => {
  if (t.tradeId === 'SOXS-1' && t.episodeId === 'EP-SOXS-CLOSED-20260923') { t.episodeId = 'EP-SOXS1-CLOSED-20260923'; soxsFixed++; }
}));
if (soxsFixed !== 3) { console.error('SOXS episodeId 拆分异常:', soxsFixed); process.exit(1); }
fix('SOXS sat1 账号 episodeId → EP-SOXS1-CLOSED-20260923（区分 main 与 sat1，共3处引用同步）');

// ============ E. RAM 按减仓性质拆分 episodeId ============
let ramFixed = 0;
j.episodes.forEach(e => {
  if (e.sym === 'RAM' && e.episodeId === 'EP-RAM-CLOSED-20260922' && (e.entrySetup || []).includes('日内 Scalp')) {
    e.episodeId = 'EP-RAM-SCALP-20260922';
    ramFixed++;
  }
});
j.executions.forEach(e => {
  if (e.executionId === 'EX-20260922-RAM-SELL-039') { e.episodeId = 'EP-RAM-SCALP-20260922'; ramFixed++; }
});
j.closedTrades.forEach(d => d.trades.forEach(t => {
  if (t.tradeId === 'RAM-SCALP' && t.episodeId === 'EP-RAM-CLOSED-20260922') { t.episodeId = 'EP-RAM-SCALP-20260922'; ramFixed++; }
}));
if (ramFixed !== 3) { console.error('RAM episodeId 拆分异常:', ramFixed); process.exit(1); }
fix('RAM 日内Scalp减仓 episodeId → EP-RAM-SCALP-20260922（SELL-039/scalp，区分 SELL-037 锁定利润）');

// ============ F. CRWG netInvestedCost 重算 ============
const ni = (201 * 15.75 - 100 * 17.26) / 101;
const niRounded = Math.round(ni * 100000) / 100000;
let crwgHoldingFixed = false;
j.accounts.forEach(a => (a.holdings || []).forEach(h => {
  if (h.sym === 'CRWG' && (h.netInvestedCost || {}).value === 15.75) {
    h.netInvestedCost.value = niRounded;
    h.netInvestedCost.note = '正股净投入摊薄=(201×15.75-100×17.26)÷101，含减仓回款、未计费用、未含期权现金流';
    h.netInvestedCost.status = '确认';
    crwgHoldingFixed = true;
  }
}));
if (!crwgHoldingFixed) { console.error('未找到 CRWG holding 需重算 netInvestedCost'); process.exit(1); }
fix(`CRWG netInvestedCost 15.75 → ${niRounded}（=(${201 * 15.75}-${100 * 17.26})÷101）`);

// ============ G. 记录修正说明（顶层，不影响页面渲染） ============
j.corrections = (j.corrections || []).concat([
  { date: '2026-10-04', item: 'CRWG重复成交', detail: '删除 EX-20260922-CRWG-SELL-038（与 SELL-010 同一笔 100@17.26），保留 SELL-010' },
  { date: '2026-10-04', item: 'EP-CRWG错误周期', detail: '删除 EP-CRWG-CLOSED-20260922（部分减仓非清仓），CRWG-SELL 归属 EP-CRWG-2026Q3' },
  { date: '2026-10-04', item: 'SOXS episodeId', detail: 'sat1 账号拆分 EP-SOXS1-CLOSED-20260923' },
  { date: '2026-10-04', item: 'RAM episodeId', detail: '日内Scalp减仓拆分 EP-RAM-SCALP-20260922（区分锁定利润减仓）' },
  { date: '2026-10-04', item: 'CRWG成本', detail: 'netInvestedCost 重算为 ' + niRounded + '（正股净投入摊薄，含减仓回款）' }
]);
ok('修正说明已记入 corrections[]');

// ============ 写回 ============
fs.writeFileSync(LEDGER, JSON.stringify(j, null, 2) + '\n', 'utf8');
console.log(log.join('\n'));
console.log('\n修正后统计: executions=' + j.executions.length + ' episodes=' + j.episodes.length + ' closedTrades=' + j.closedTrades.reduce((s, d) => s + d.trades.length, 0));