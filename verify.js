// verify.js — 数据校验（executionId/episodeId 去重、引用关系、疑似重复成交、持仓对账、成本一致性、成本口径、内容哈希）
// 用法: node verify.js
// 用途: 提交/部署前必须跑一次；校验失败返回非零退出码，阻止发布
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = __dirname;
const LEDGER = path.join(ROOT, 'data', 'ledger-full.json');
const TEMPLATE = path.join(ROOT, 'template.html');
const RULES = path.join(ROOT, 'RULES_日常更新.md');

let j;
try {
  j = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
} catch (e) {
  console.error('❌ ledger-full.json 解析失败:', e.message);
  process.exit(1);
}

let errors = 0, warnings = 0;

// ---- 1. executionId 去重 ----
const ids = j.executions.map(e => e.executionId);
const nullIds = ids.filter(id => !id);
const dupIds = ids.filter((id, i) => id && ids.indexOf(id) !== i);
if (nullIds.length) { errors++; console.error(`❌ ${nullIds.length} 条 execution 缺 executionId`); }
if (dupIds.length) { errors++; console.error(`❌ executionId 重复: ${[...new Set(dupIds)].join(', ')}`); }
else console.log(`✅ executionId 去重: ${ids.length} 条无重复`);

// ---- 2. episodeId 唯一性 ----
const epIds = j.episodes.map(e => e.episodeId);
const nullEpIds = epIds.filter(id => !id);
const dupEpIds = epIds.filter((id, i) => id && epIds.indexOf(id) !== i);
if (nullEpIds.length) { errors++; console.error(`❌ ${nullEpIds.length} 条 episode 缺 episodeId`); }
if (dupEpIds.length) { errors++; console.error(`❌ episodeId 重复: ${[...new Set(dupEpIds)].join(', ')}`); }
else console.log(`✅ episodeId 唯一: ${epIds.length} 条无重复`);

// ---- 3. 引用关系（execution / closedTrades 必须指向存在的 episode） ----
const epSet = new Set(epIds);
let refErr = 0;
j.executions.forEach(e => {
  if (!epSet.has(e.episodeId)) { refErr++; errors++; console.error(`❌ execution 引用缺失 episode: ${e.executionId} → ${e.episodeId}`); }
});
j.closedTrades.forEach(d => d.trades.forEach(t => {
  if (!epSet.has(t.episodeId)) { refErr++; errors++; console.error(`❌ closedTrade 引用缺失 episode: ${t.tradeId} → ${t.episodeId}`); }
}));
if (!refErr) console.log('✅ 引用关系: 所有 execution / closedTrade 均指向存在的 episode');

// ---- 4. 疑似重复成交（同账户+标的+方向+日期+价格） ----
const execKey = {};
j.executions.forEach(e => {
  const k = [e.account, e.sym, e.side, e.date, e.price].join('|');
  (execKey[k] = execKey[k] || []).push(e);
});
let dupErr = 0, dupWarn = 0;
Object.entries(execKey).forEach(([k, arr]) => {
  if (arr.length > 1) {
    const qtyAllSame = arr.every(e => e.qty === arr[0].qty);
    if (qtyAllSame) {
      dupErr++; errors++;
      console.error(`❌ 疑似重复成交（账户/标的/方向/日期/价格/数量全一致）: ${arr.map(e => e.executionId).join(' vs ')}`);
    } else {
      dupWarn++; warnings++;
      console.warn(`⚠️ 疑似重复成交（数量不一致/缺失，需人工确认）: ${arr.map(e => e.executionId + '(' + (e.qty ?? '?') + ')').join(' vs ')}`);
    }
  }
});
if (!dupErr && !dupWarn) console.log('✅ 疑似重复成交: 无');

// ---- 5. 持仓余额对账（期初0 + 买入 - 卖出 = 当前持仓；qty 缺失标注无法完整对账） ----
function acctIdOf(acct) { return acct.id || acct.name; }
j.accounts.forEach(a => (a.holdings || []).forEach(h => {
  const acctId = acctIdOf(a);
  const ex = j.executions.filter(e => e.sym === h.sym && e.account === acctId);
  if (ex.length === 0) {
    warnings++; console.warn(`⚠️ ${h.sym}(${acctId}) 无 execution 流水，无法对账持仓（期初/买入/卖出缺失）`);
    return;
  }
  const missing = ex.filter(e => e.qty === null || e.qty === undefined);
  if (missing.length > 0) {
    warnings++; console.warn(`⚠️ ${h.sym}(${acctId}) 有 ${missing.length}/${ex.length} 条流水缺 qty，无法完整对账`);
    return;
  }
  const buys = ex.filter(e => e.side === 'buy').reduce((s, e) => s + e.qty, 0);
  const sells = ex.filter(e => e.side === 'sell').reduce((s, e) => s + e.qty, 0);
  if (buys - sells !== h.qty) {
    errors++; console.error(`❌ ${h.sym}(${acctId}) 持仓对账失败: 买${buys} - 卖${sells} = ${buys - sells} ≠ 当前${h.qty}`);
  }
}));
console.log('✅ 持仓对账: 流水完整者已核对（买卖差=当前持仓），缺失者已标注');

// ---- 6. 成本一致性（流水完整 + netInvestedCost 非 null 时重算核对正股净投入） ----
j.accounts.forEach(a => (a.holdings || []).forEach(h => {
  const ni = h.netInvestedCost;
  if (!ni || ni.value === null) return;
  const ex = j.executions.filter(e => e.sym === h.sym && e.account === acctIdOf(a));
  const allKnown = ex.length > 0 && ex.every(e => e.qty !== null && e.qty !== undefined);
  if (!allKnown || !h.qty) return; // 流水不完整跳过硬核对
  const buyAmt = ex.filter(e => e.side === 'buy').reduce((s, e) => s + e.qty * e.price, 0);
  const sellAmt = ex.filter(e => e.side === 'sell').reduce((s, e) => s + e.qty * e.price, 0);
  const recomputed = Math.round((buyAmt - sellAmt) / h.qty * 100000) / 100000;
  if (Math.abs(recomputed - ni.value) > 0.001) {
    errors++; console.error(`❌ ${h.sym} netInvestedCost=${ni.value} 与流水重算 ${recomputed} 不一致`);
  }
}));
console.log('✅ 成本一致性: 流水完整者已重算核对 netInvestedCost（正股净投入摊薄）');

// ---- 7. 成本口径合规（正股净投入 / 组合净投入分开；有期权持仓必须两者分离） ----
let optHolds = 0, badPending = 0;
j.accounts.forEach(a => {
  (a.holdings || []).forEach(h => {
    const hasOpt = (h.options || []).length > 0;
    if (hasOpt) {
      optHolds++;
      if (!h.compositeNetInvested) { errors++; console.error(`❌ ${h.sym} 有期权但缺 compositeNetInvested（组合净投入，含期权现金流）`); }
      if (!h.netInvestedCost) { errors++; console.error(`❌ ${h.sym} 缺 netInvestedCost（正股净投入，不含期权）`); }
    }
    if (h.actualCostBasis && h.actualCostBasis.status === '待核实' && h.actualCostBasis.value !== null) {
      badPending++; warnings++; console.warn(`⚠️ ${h.sym} actualCostBasis 标"待核实"但 value 非 null（=${h.actualCostBasis.value}）`);
    }
    if (h.compositeNetInvested && h.compositeNetInvested.status === '待核实' && h.compositeNetInvested.value !== null) {
      badPending++; warnings++; console.warn(`⚠️ ${h.sym} compositeNetInvested 标"待核实"但 value 非 null`);
    }
  });
});
console.log(`✅ 成本口径: ${optHolds} 个期权持仓均分记 netInvestedCost（正股）/ compositeNetInvested（组合）`);

// ---- 8. 内容哈希（数据 / 模板 / 规则 / 构建脚本，用于判断是否有变化） ----
function sha256(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
}
const hashes = {
  ledger: sha256(LEDGER),
  template: sha256(TEMPLATE),
  rules: sha256(RULES),
  build_public: sha256(path.join(ROOT, 'build_public.js'))
};
const HASH_PATH = path.join(ROOT, '.hashes.json');
const HASH_KEYS = ['ledger', 'template', 'rules', 'build_public'];
let changed = true;
if (fs.existsSync(HASH_PATH)) {
  try {
    const old = JSON.parse(fs.readFileSync(HASH_PATH, 'utf8'));
    changed = HASH_KEYS.some(k => old[k] !== hashes[k]);
  } catch (e) { /* 旧哈希文件损坏则重写 */ }
}
if (changed) {
  hashes.generatedAt = new Date().toISOString();
  fs.writeFileSync(HASH_PATH, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
  console.log('✅ 内容哈希已更新 .hashes.json（有变化）');
} else {
  console.log('ℹ️ 内容哈希无变化，跳过写入（数据/模板/规则/脚本未变）');
}
console.log('   ledger     :', hashes.ledger);
console.log('   template   :', hashes.template);
console.log('   rules      :', hashes.rules);
console.log('   build_public:', hashes.build_public);

// ---- 总结 ----
if (errors > 0) {
  console.error(`\n❌ 校验失败: ${errors} 错误, ${warnings} 警告`);
  process.exit(1);
}
console.log(`\n✅ 校验通过 (${warnings} 警告)`);