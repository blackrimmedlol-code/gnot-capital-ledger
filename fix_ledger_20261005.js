// fix_ledger_20261005.js — 一次性补录：10/5 主号新增买入（IRE 加仓 + GDXU 首建）
// 保留起始版本 HEAD=6a3f5e7；先备份后变换，脚本可重复跑但依赖前置状态
const fs = require('fs');
const path = require('path');

const LEDGER = path.join(__dirname, 'data', 'ledger-full.json');
const fsRaw = fs.readFileSync(LEDGER, 'utf8');
const L = JSON.parse(fsRaw);

// ---- 前置断言 ----
const ireH = L.accounts.find(a => a.id === 'main').holdings.find(h => h.sym === 'IRE');
if (!ireH) throw new Error('未找到 IRE holding');
if (ireH.qty !== 200) throw new Error('IRE qty 前置不符: ' + ireH.qty);
if (L.executions.find(e => e.executionId === 'EX-20261005-IRE-BUY-049')) throw new Error('049 已存在');
if (L.executions.find(e => e.executionId === 'EX-20261005-GDXU-BUY-050')) throw new Error('050 已存在');
if (L.episodes.find(e => e.episodeId === 'EP-GDXU-2026Q4')) throw new Error('GDXU-Q4 episode 已存在');
if (L.episodes.find(e => e.episodeId === 'EP-IRE-2026Q4')) throw new Error('IRE-Q4 episode 已存在');

// ---- 备份 ----
const bak = path.join(path.dirname(LEDGER), 'ledger-full.json.bak.20261005_2210');
if (!fs.existsSync(bak)) fs.writeFileSync(bak, fsRaw);
console.log('备份:', bak);

// ---- 1. executions ----
L.executions.push(
  { executionId: 'EX-20261005-IRE-BUY-049', episodeId: 'EP-IRE-2026Q4', account: 'main', sym: 'IRE', side: 'buy', qty: 100, price: 8.93, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '10/5 主号加仓 100@8.93（用户确认），净投入摊薄 7.79→8.17', status: 'confirmed' },
  { executionId: 'EX-20261005-GDXU-BUY-050', episodeId: 'EP-GDXU-2026Q4', account: 'main', sym: 'GDXU', side: 'buy', qty: 20, price: 99.7, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '2x 做多金矿股 ETF 首建底仓 20@99.7', status: 'confirmed' }
);

// ---- 2. episodes ----
L.episodes.push(
  { episodeId: 'EP-IRE-2026Q4', sym: 'IRE', account: 'main', status: 'open', entryDate: '2026-10-05', entrySetup: ['支撑低吸'], entryExecStatus: 'adhoc', currentQty: 100, exitReason: null, exitDate: null },
  { episodeId: 'EP-GDXU-2026Q4', sym: 'GDXU', account: 'main', status: 'open', entryDate: '2026-10-05', entrySetup: ['新标的建仓'], entryExecStatus: 'adhoc', currentQty: 20, exitReason: null, exitDate: null }
);

// ---- 3. IRE holding ----
ireH.qty = 300;
ireH.cost = 8.17;
ireH.costDate = '9/30建底仓 / 10/1 8.58+8.81补底仓 / 10/2 9.9 止盈摊薄 / 10/2 10.38 止盈摊薄 / 10/2 9.23 回调接回 / 10/5 8.93 加仓';
ireH.wtPct = 11;
ireH.note = ireH.note + '；10/5 @8.93 加仓 100、摊薄 8.17——等回调接回后加码，持有多观';
ireH.oneLiner = ireH.oneLiner + '；10/5 @8.93 加仓、摊薄 8.17。';
ireH.actualCostBasis.note = '分批买入（9/30+10/1）+日内高抛低吸（10/2）+10/5 加仓，真实均价待核实';
ireH.netInvestedCost.value = 8.17;
ireH.netInvestedCost.note = '净投入摊薄口径（10/2 @9.23 接回后 + 10/5 @8.93 加仓100）';
ireH.episodeId = 'EP-IRE-2026Q4';

// ---- 4. GDXU holding（新增）----
L.accounts.find(a => a.id === 'main').holdings.push({
  sym: 'GDXU',
  name: 'Direxion Daily Gold Miners Bull 2X',
  qty: 20,
  cost: 99.7,
  costDate: '10/5 首建',
  lastPrice: 99.7,
  lastPriceDate: '2026-10-05 买入价（10/5 收盘待 10/6 刷新）',
  wtPct: 7,
  strategy: ['卫星仓·2x金矿'],
  options: [],
  tags: ['hold'],
  status: ['持有'],
  alertSub: '2x 每日重置 · 高波动',
  setup: ['新标的建仓'],
  execStatus: 'adhoc',
  oneLiner: 'GDXU 10/5 首建底仓 20@99.7（2x 做多金矿股 ETF）；建仓逻辑待补。',
  actualCostBasis: { value: 99.7, note: '2026-10-05 首建成本', status: '确认' },
  netInvestedCost: { value: 99.7, note: '与真实成本一致（无减仓摊薄）', status: '确认' },
  costDisplay: '摊薄口径',
  entrySetup: ['新标的建仓'],
  entryExecStatus: 'adhoc',
  actionExecStatus: null,
  exitReason: null,
  episodeId: 'EP-GDXU-2026Q4'
});

// ---- 5. asOf / stats / corrections ----
L.asOf = '2026-10-05 登记（主号新增 IRE+100@8.93、GDXU 首建 20@99.7）· 美股行情仍 2026-10-02 收盘（10/6 刷新 10/5）· A股 9/30 收盘（国庆休市）';
L.asOfLabel = '2026-10-05 登记新增买入（IRE 加仓 / GDXU 首建）';
L.stats = L.stats || {};
L.stats.registeredEntries = (L.stats.registeredEntries || 0) + 1;
L.stats.confirmedFills = (L.stats.confirmedFills || 0) + 2;
L.stats.openEpisodes = (L.stats.openEpisodes || 0) + 2;
L.corrections = L.corrections || [];
L.corrections.push({ date: '2026-10-05', item: '新增买入登记', detail: '主号 IRE +100@8.93（新开 EP-IRE-2026Q4，净投入摊薄 7.79→8.17）；GDXU 首建 20@99.7（新开 EP-GDXU-2026Q4）。行情仍 10/2 收盘，10/6 刷新 10/5 收盘后重算权重。' });

// ---- 写回 ----
fs.writeFileSync(LEDGER, JSON.stringify(L, null, 2) + '\n', 'utf8');
console.log('✅ ledger 更新完成');
console.log('  executions:', L.executions.length, '| episodes:', L.episodes.length);
console.log('  IRE qty:', ireH.qty, 'netInvested:', ireH.netInvestedCost.value);
console.log('  GDXU:', L.accounts.find(a => a.id === 'main').holdings.find(h => h.sym === 'GDXU').qty);