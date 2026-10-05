// fix_ledger_20261006.js — 一次性补录：10/5 主号 IRE 再补仓 100@8.77（续 EP-IRE-2026Q4）
// 起始版本 HEAD=60ae1c8；先备份后变换
const fs = require('fs');
const path = require('path');
const LEDGER = path.join(__dirname, 'data', 'ledger-full.json');
const fsRaw = fs.readFileSync(LEDGER, 'utf8');
const L = JSON.parse(fsRaw);

// ---- 前置断言 ----
const main = L.accounts.find(a => a.id === 'main');
const ireH = main.holdings.find(h => h.sym === 'IRE');
if (!ireH || ireH.qty !== 300) throw new Error('IRE 前置不符 qty=' + (ireH && ireH.qty));
if (L.executions.find(e => e.executionId === 'EX-20261005-IRE-BUY-051')) throw new Error('051 已存在');

// ---- 备份 ----
const bak = path.join(path.dirname(LEDGER), 'ledger-full.json.bak.20261006_0045');
if (!fs.existsSync(bak)) fs.writeFileSync(bak, fsRaw);

// ---- executions ----
L.executions.push(
  { executionId: 'EX-20261005-IRE-BUY-051', episodeId: 'EP-IRE-2026Q4', account: 'main', sym: 'IRE', side: 'buy', qty: 100, price: 8.77, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '10/5 再补仓 100@8.77（用户确认）；观望 1 周能否回升至 10', status: 'confirmed' }
);

// ---- IRE holding ----
ireH.qty = 400;
ireH.cost = 8.32;
ireH.costDate = '9/30建底仓 / 10/1 8.58+8.81补底仓 / 10/2 9.9 止盈摊薄 / 10/2 10.38 止盈摊薄 / 10/2 9.23 回调接回 / 10/5 8.93 加仓 / 10/5 8.77 再加仓';
ireH.wtPct = 14;
ireH.note = ireH.note + '；10/5 @8.77 再补 100、摊薄 8.32——望 1 周回升至 10（待观察）';
ireH.oneLiner = 'IRE 10/5 两档补仓（@8.93/@8.77 各 100）摊薄 8.32；观望 1 周能否回升至 10。';
ireH.netInvestedCost.value = 8.32;
ireH.netInvestedCost.note = '净投入摊薄口径（10/2 @9.23 接回 + 10/5 @8.93/@8.77 各加100）';

// ---- stats / asOf / corrections ----
L.stats = L.stats || {};
L.stats.confirmedFills = (L.stats.confirmedFills || 0) + 1;
L.asOf = '2026-10-05 登记（主号 IRE +200@8.93/8.77 摊薄 8.32、GDXU 首建 20@99.7）· 美股行情仍 2026-10-02 收盘（10/6 刷新 10/5）· A股 9/30 收盘（国庆休市）';
L.asOfLabel = '2026-10-05 登记（IRE 加仓 200 / GDXU 首建）· 观望 IRE 回升至 10';
L.corrections = L.corrections || [];
L.corrections.push({ date: '2026-10-06', item: 'IRE 再补仓登记', detail: '主号 IRE 再补 100@8.77（10/5 美东盘中），净投入摊薄 8.17→8.32，qty 300→400；观望 1 周（约至 10/13）能否回升至 10。' });

fs.writeFileSync(LEDGER, JSON.stringify(L, null, 2) + '\n', 'utf8');
console.log('✅ 补录完成: IRE qty=' + ireH.qty + ' netInvested=' + ireH.netInvestedCost.value + ' executions=' + L.executions.length + ' episodes=' + L.episodes.length);