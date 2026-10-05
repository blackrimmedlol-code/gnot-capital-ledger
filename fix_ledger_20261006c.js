// fix_ledger_20261006c.js — 一次性补录：10/5 1号小账户新开 SNXX 143@15.695
// 起始版本 HEAD=f65791e；先备份后变换（用户确认：1号小账户新开，2号67股不受影响）
const fs = require('fs');
const path = require('path');
const LEDGER = path.join(__dirname, 'data', 'ledger-full.json');
const fsRaw = fs.readFileSync(LEDGER, 'utf8');
const L = JSON.parse(fsRaw);

// ---- 前置断言 ----
const sat1 = L.accounts.find(a => a.id === 'sat1');
if (sat1.holdings.find(h => h.sym === 'SNXX')) throw new Error('sat1 已有 SNXX');
if (L.executions.find(e => e.executionId === 'EX-20261005-SNXX-BUY-056')) throw new Error('056 已存在');
if (L.episodes.find(e => e.episodeId === 'EP-SNXX1-2026Q4')) throw new Error('EP-SNXX1 已存在');

// ---- 备份 ----
const bak = path.join(path.dirname(LEDGER), 'ledger-full.json.bak.20261006_0305');
if (!fs.existsSync(bak)) fs.writeFileSync(bak, fsRaw);

// ---- executions ----
L.executions.push(
  { executionId: 'EX-20261005-SNXX-BUY-056', episodeId: 'EP-SNXX1-2026Q4', account: 'sat1', sym: 'SNXX', side: 'buy', qty: 143, price: 15.695, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '1号小账户新开 SNXX 143@15.695（2x 闪迪）', status: 'confirmed' }
);

// ---- episode（sat1 独立周期 EP-SNXX1-2026Q4）----
L.episodes.push(
  { episodeId: 'EP-SNXX1-2026Q4', sym: 'SNXX', account: 'sat1', status: 'open', entryDate: '2026-10-05', entrySetup: ['其他'], entryExecStatus: 'unknown', currentQty: 143, exitReason: null, exitDate: null }
);

// ---- sat1 holding 新增 SNXX ----
sat1.holdings.push({
  sym: 'SNXX', name: 'Tradr 2X Long SNDK · 2x 闪迪', qty: 143, cost: 15.695,
  costDate: '10/5 首建（1号小账户新开）', lastPrice: 15.695,
  lastPriceDate: '2026-10-05 买入价（10/5 收盘待 10/6 刷新）', wtPct: 100,
  strategy: ['卫星仓·存储杠杆博弈'], options: [], tags: ['hold'], status: ['持有'],
  alertSub: '2x 每日重置 · 高波动标的', setup: ['其他'], execStatus: 'unknown',
  oneLiner: '1号小账户 10/5 新开 SNXX 143@15.695（2x 闪迪）；建仓逻辑待补。',
  actualCostBasis: { value: 15.695, note: '2026-10-05 首建（1号小账户）', status: '确认' },
  netInvestedCost: { value: 15.695, note: '与真实成本一致（无减仓摊薄）', status: '确认' },
  costDisplay: '实际成本', entrySetup: ['其他'], entryExecStatus: 'unknown',
  actionExecStatus: null, exitReason: null, episodeId: 'EP-SNXX1-2026Q4'
});

// ---- stats / asOf / corrections ----
L.stats = L.stats || {};
L.stats.registeredEntries = (L.stats.registeredEntries || 0) + 1;
L.stats.confirmedFills = (L.stats.confirmedFills || 0) + 1;
L.stats.openEpisodes = (L.stats.openEpisodes || 0) + 1; // 10
L.asOf = '2026-10-05 登记（主号 IRE 补仓 / GDXU 高抛清仓；1号号 AVGX/LABU 清仓后新开 SNXX 143@15.695）· 美股行情仍 10/2 收盘（10/6 刷新 10/5）· A股 9/30 收盘（国庆休市）';
L.asOfLabel = '2026-10-05 登记（1号号新开 SNXX / 主号 GDXU 高抛了结、IRE 补仓）';
L.corrections = L.corrections || [];
L.corrections.push({ date: '2026-10-06', item: '1号小账户新开 SNXX', detail: '1号小账户 10/5 新开 SNXX 143@15.695（2x 闪迪），EP-SNXX1-2026Q4；2号小账户 67 股 SNXX 不受影响。建仓逻辑待补（execStatus=unknown）。' });

fs.writeFileSync(LEDGER, JSON.stringify(L, null, 2) + '\n', 'utf8');
console.log('✅ 补录完成: executions=' + L.executions.length + ' episodes=' + L.episodes.length);
console.log('  sat1 持仓:', sat1.holdings.map(h => h.sym + '@' + h.netInvestedCost.value).join(','));
console.log('  openEpisodes:', L.episodes.filter(e => e.status === 'open').length);