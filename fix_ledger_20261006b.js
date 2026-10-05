// fix_ledger_20261006b.js — 一次性补录：10/5 主号 GDXU 高抛清仓 + 1号小账户 AVGX 清仓 / LABU 快进快出
// 起始版本 HEAD=5acb95c；先备份后变换
const fs = require('fs');
const path = require('path');
const LEDGER = path.join(__dirname, 'data', 'ledger-full.json');
const fsRaw = fs.readFileSync(LEDGER, 'utf8');
const L = JSON.parse(fsRaw);

// ---- 前置断言 ----
const main = L.accounts.find(a => a.id === 'main');
const sat1 = L.accounts.find(a => a.id === 'sat1');
const gdxuH = main.holdings.find(h => h.sym === 'GDXU');
const avgxH = sat1.holdings.find(h => h.sym === 'AVGX');
if (!gdxuH || gdxuH.qty !== 20) throw new Error('GDXU 前置不符');
if (!avgxH || avgxH.qty !== 53) throw new Error('AVGX 前置不符');
if (L.executions.find(e => e.executionId === 'EX-20261005-GDXU-SELL-055')) throw new Error('GDXU-SELL-055 已存在');
if (L.episodes.find(e => e.episodeId === 'EP-GDXU-CLOSED-20261005')) throw new Error('GDXU-CLOSED 已存在');

// ---- 备份 ----
const bak = path.join(path.dirname(LEDGER), 'ledger-full.json.bak.20261006_0210');
if (!fs.existsSync(bak)) fs.writeFileSync(bak, fsRaw);

// ---- 1. executions 新增 4 条 ----
L.executions.push(
  { executionId: 'EX-20261005-AVGX-SELL-052', episodeId: 'EP-AVGX-2026Q3', account: 'sat1', sym: 'AVGX', side: 'sell', qty: 53, price: 39.8, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '1号小账户缩量上涨日 @39.8 全数清仓，转空仓观望', status: 'confirmed' },
  { executionId: 'EX-20261005-LABU-BUY-053', episodeId: 'EP-LABU-CLOSED-20261005', account: 'sat1', sym: 'LABU', side: 'buy', qty: 8, price: 240.65, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '3x 做多生物科技 ETF 快进建仓 8@240.65', status: 'confirmed' },
  { executionId: 'EX-20261005-LABU-SELL-054', episodeId: 'EP-LABU-CLOSED-20261005', account: 'sat1', sym: 'LABU', side: 'sell', qty: 8, price: 255, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '当日 255 全数清仓（快进快出）', status: 'confirmed' },
  { executionId: 'EX-20261005-GDXU-SELL-055', episodeId: 'EP-GDXU-CLOSED-20261005', account: 'main', sym: 'GDXU', side: 'sell', qty: 20, price: 104, date: '2026-10-05', time: '盘中', timezone: 'America/New_York', fee: null, note: '主号 10/5 当日建（99.7）→104 高抛清仓', status: 'confirmed' }
);

// ---- 2. GDXU-BUY-050 改挂 CLOSED ----
L.executions.find(e => e.executionId === 'EX-20261005-GDXU-BUY-050').episodeId = 'EP-GDXU-CLOSED-20261005';

// ---- 3. episodes ----
// AVGX: open -> closed
const avgxEp = L.episodes.find(e => e.episodeId === 'EP-AVGX-2026Q3');
avgxEp.status = 'closed'; avgxEp.currentQty = 0;
avgxEp.exitReason = '1号小账户缩量上涨日清仓：AVGX @39.8 全清，转空仓观望'; avgxEp.exitDate = '2026-10-05';
// GDXU: EP-GDXU-2026Q4 改名 + closed
const gdxuEp = L.episodes.find(e => e.episodeId === 'EP-GDXU-2026Q4');
delete gdxuEp.episodeId; gdxuEp.episodeId = 'EP-GDXU-CLOSED-20261005';
gdxuEp.status = 'closed'; gdxuEp.currentQty = 0;
gdxuEp.exitReason = '10/5 当日建仓（99.7）→104 高抛清仓'; gdxuEp.exitDate = '2026-10-05';
gdxuEp.entrySetup = ['日内高抛']; gdxuEp.entryExecStatus = 'adhoc';
// LABU: 新增 closed
L.episodes.push({ episodeId: 'EP-LABU-CLOSED-20261005', sym: 'LABU', account: 'sat1', status: 'closed', entryDate: '2026-10-05', entrySetup: ['快进快出'], entryExecStatus: 'adhoc', currentQty: 0, exitReason: '当日建当日清：240.65 建 →255 清', exitDate: '2026-10-05' });
// IRE Q4: currentQty 同步为 200（两笔各100）
const ireQ4 = L.episodes.find(e => e.episodeId === 'EP-IRE-2026Q4');
ireQ4.currentQty = 200;

// ---- 4. holdings 移除清仓标 ----
main.holdings = main.holdings.filter(h => h.sym !== 'GDXU');
sat1.holdings = sat1.holdings.filter(h => h.sym !== 'AVGX');

// ---- 5. closedTrades 新增 10/5 组 ----
const ret = (sell, buy) => Math.round((sell - buy) / buy * 1000) / 10;
const avgxRet = ret(39.8, 38.95), labuRet = ret(255, 240.65), gdxuRet = ret(104, 99.7);
L.closedTrades.push({
  date: '2026-10-05', dateLabel: '2026-10-05', trades: [
    { tradeId: 'AVGX-SELL', sym: 'AVGX', name: 'Defiance 2x AVGO · 2x博通', acct: '1号小账号', qty: null, cost: 38.95,
      legs: [{ time: '10/5 缩量上涨日', price: 39.8, retPct: avgxRet, note: '@39.8 全数清仓' }],
      totalRetPct: avgxRet, totalRetNote: `+${avgxRet}%（清仓·相对建仓成本）`, result: 'win',
      reason: '1号小账户缩量上涨日离场：AVGX @39.8 全清，当日转空仓观望',
      setup: ['超跌反弹', '趋势波段'], execStatus: 'adhoc',
      oneLiner: 'AVGX 缩量上涨日 @39.8 全清离场、1号小账户转空仓观望；落袋为安。',
      episodeId: 'EP-AVGX-2026Q3', entrySetup: ['超跌反弹', '趋势波段'], entryExecStatus: 'adhoc',
      exitReason: '1号小账户缩量上涨日清仓，转空仓观望', costBasisType: 'actual', costNote: '建仓成本口径' },
    { tradeId: 'LABU-SELL', sym: 'LABU', name: '3x 做多生物科技ETF', acct: '1号小账号', qty: null, cost: 240.65,
      legs: [{ time: '10/5 快进快出', price: 255, retPct: labuRet, note: '当日 240.65 建 →255 全清' }],
      totalRetPct: labuRet, totalRetNote: `+${labuRet}%（清仓·相对建仓成本）`, result: 'win',
      reason: '1号小账户日内快进快出：LABU 240.65 建、255 全清，缩量上涨日轻仓博弈后离场',
      setup: ['快进快出'], execStatus: 'adhoc',
      oneLiner: 'LABU 当日快进快出 +6%：240.65 建、255 全清，缩量上涨日打一枪就走。',
      episodeId: 'EP-LABU-CLOSED-20261005', entrySetup: ['快进快出'], entryExecStatus: 'adhoc',
      exitReason: '日内快进快出全清', costBasisType: 'actual', costNote: '当日建仓成本口径' },
    { tradeId: 'GDXU-SELL', sym: 'GDXU', name: 'Direxion Daily Gold Miners Bull 2X', acct: '主账号', qty: null, cost: 99.7,
      legs: [{ time: '10/5 日内', price: 104, retPct: gdxuRet, note: '当日 99.7 建 →104 高抛清仓' }],
      totalRetPct: gdxuRet, totalRetNote: `+${gdxuRet}%（清仓·相对建仓成本）`, result: 'win',
      reason: '主号 10/5 当日建仓 GDXU（99.7）、盘中 @104 高抛了结，日内波段落袋',
      setup: ['日内高抛'], execStatus: 'adhoc',
      oneLiner: 'GDXU 当日建仓 @99.7、@104 高抛清仓 +4.3%；缩量上涨日日内了结。',
      episodeId: 'EP-GDXU-CLOSED-20261005', entrySetup: ['日内高抛'], entryExecStatus: 'adhoc',
      exitReason: '10/5 当日高抛清仓', costBasisType: 'actual', costNote: '当日建仓成本口径' }
  ]
});

// ---- 6. stats / asOf / corrections ----
L.stats = L.stats || {};
L.stats.registeredEntries = (L.stats.registeredEntries || 0) + 1;          // LABU 新 entry
L.stats.confirmedFills = (L.stats.confirmedFills || 0) + 4;                 // +4 成交
L.stats.completedEpisodes = (L.stats.completedEpisodes || 0) + 3;           // AVGX/GDXU/LABU 完结
L.stats.openEpisodes = 9;                                                   // RAM/CRWG/CRDU/IRE-Q3/IRE-Q4/SNXX/杰瑞/兴业/科达
L.asOf = '2026-10-05 登记（主号 IRE 补仓摊薄8.32 / GDXU 日内高抛清仓；1号号清仓 AVGX+LABU，转空仓观望）· 美股行情仍 10/2 收盘（10/6 刷新 10/5）· A股 9/30 收盘（国庆休市）';
L.asOfLabel = '2026-10-05 登记（1号号清仓转空仓观望 / 主号 GDXU 高抛了结、IRE 补仓）';
L.corrections = L.corrections || [];
L.corrections.push({ date: '2026-10-06', item: '清仓与快进快出登记', detail: '主号 GDXU 当日建当日清（99.7→104），EP-GDXU-2026Q4 改名 EP-GDXU-CLOSED-20261005；1号号 AVGX @39.8 全清（EP-AVGX-2026Q3 转 closed）、LABU 当日 240.65→255 快进快出（EP-LABU-CLOSED-20261005）；1号小账户转空仓观望。IE Q4 currentQty 同步 200。' });

fs.writeFileSync(LEDGER, JSON.stringify(L, null, 2) + '\n', 'utf8');
console.log(`✅ 补录完成: executions=${L.executions.length} episodes=${L.episodes.length} closedTrades=${L.closedTrades.length}`);
console.log(`  AVGX ret=${avgxRet}% LABU ret=${labuRet}% GDXU ret=${gdxuRet}%`);
console.log('  openEpisodes:', L.episodes.filter(e=>e.status==='open').map(e=>e.episodeId).join(', '));