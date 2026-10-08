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

// Historical actual-cost snapshots must link to the preserved source, never a current net cost.
const checkpointIds = new Set();
(j.costCheckpoints || []).forEach(c => {
  const e = j.executions.find(e => e.executionId === c.beforeExecutionId);
  const source = j.closedTrades.flatMap(d => d.trades).find(t => t.tradeId === c.source?.tradeId);
  if (checkpointIds.has(c.beforeExecutionId) || !e || e.episodeId !== c.episodeId ||
      !Number.isFinite(c.quantityBefore) || c.quantityBefore <= 0 ||
      !Number.isFinite(c.averageCost) || c.averageCost <= 0 ||
      c.source?.originalCostBasisType !== 'actual' || source?.costBasisType !== 'actual' ||
      source?.cost !== c.averageCost) {
    errors++; console.error('❌ 历史成本基准缺失或来源不一致: ' + c.beforeExecutionId);
  }
  checkpointIds.add(c.beforeExecutionId);
});

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
function analysisQty(e) { return e.analysisQty === undefined ? e.qty : e.analysisQty; }
// Allocations preserve actual broker quantities; observations cannot become fake sells.
j.executions.forEach(e => {
  if (e.analysisQty !== undefined && (!Number.isFinite(e.analysisQty) || e.analysisQty < 0 ||
      e.analysisQty + (e.observationQty || 0) !== e.qty || !e.allocationSource)) {
    errors++; console.error('❌ 观察仓分配无效: ' + e.executionId);
  }
});
// A newer user-reported balance can conflict with an older broker snapshot.
// Preserve both as evidence; never invent the missing trade to force equality.
function pendingBalance(acct, sym, calculated, reported) {
  return (j.reconciliations || []).find(r => r.account === acct && r.sym === sym &&
    r.status === 'pending' && r.knownQuantity === calculated && r.reportedQuantity === reported &&
    r.statementAsOf && r.sourceId && r.note &&
    (j.sourceDocuments || []).some(s => s.sourceId === r.sourceId) &&
    (j.statementPositions || []).some(s => s.sourceId === r.sourceId && s.asOf === r.statementAsOf &&
      s.account === acct && s.holdings && s.holdings[sym] === calculated));
}
j.accounts.forEach(a => (a.holdings || []).forEach(h => {
  const acctId = acctIdOf(a);
  const closedEpIds = new Set((j.episodes || []).filter(e => e.status === 'closed').map(e => e.episodeId));
  const ex = j.executions.filter(e => e.sym === h.sym && e.account === acctId && !closedEpIds.has(e.episodeId));
  if (ex.length === 0) {
    warnings++; console.warn(`⚠️ ${h.sym}(${acctId}) 无 execution 流水，无法对账持仓（期初/买入/卖出缺失）`);
    return;
  }
  const missing = ex.filter(e => e.qty === null || e.qty === undefined);
  if (missing.length > 0) {
    warnings++; console.warn(`⚠️ ${h.sym}(${acctId}) 有 ${missing.length}/${ex.length} 条流水缺 qty，无法完整对账`);
    return;
  }
  const buys = ex.filter(e => e.side === 'buy').reduce((s, e) => s + analysisQty(e), 0);
  const sells = ex.filter(e => e.side === 'sell').reduce((s, e) => s + analysisQty(e), 0);
  const openings = (j.openingPositions || []).filter(o => o.account === acctId && o.sym === h.sym);
  const openingQty = openings.reduce((s, o) => s + analysisQty(o), 0);
  const calculated = openingQty + buys - sells;
  if (calculated !== h.qty) {
    if (pendingBalance(acctId, h.sym, calculated, h.qty)) {
      warnings++; console.warn(`⚠️ ${h.sym}(${acctId}) 已留痕的余额差异: 结单/已知流水${calculated}，较新记录${h.qty}；后续成交待补`);
    } else {
      errors++; console.error(`❌ ${h.sym}(${acctId}) 持仓对账失败: 期初${openingQty} + 买${buys} - 卖${sells} = ${calculated} ≠ 当前${h.qty}`);
    }
  }
}));
console.log('✅ 持仓对账: 流水完整者已核对（买卖差=当前持仓），缺失者已标注');

// ---- 6. 成本一致性（流水完整 + netInvestedCost 非 null 时重算核对正股净投入） ----
j.accounts.forEach(a => (a.holdings || []).forEach(h => {
  const ni = h.netInvestedCost;
  if (!ni || ni.value === null) return;
  const closedEpIds6 = new Set((j.episodes || []).filter(e => e.status === 'closed').map(e => e.episodeId));
  const ex = j.executions.filter(e => e.sym === h.sym && e.account === acctIdOf(a) && !closedEpIds6.has(e.episodeId));
  const allKnown = ex.length > 0 && ex.every(e => e.qty !== null && e.qty !== undefined);
  if (!allKnown || !h.qty) return; // 流水不完整跳过硬核对
  const calculated = ex.reduce((s, e) => s + (e.side === 'buy' ? analysisQty(e) : -analysisQty(e)), 0);
  if (pendingBalance(acctIdOf(a), h.sym, calculated, h.qty)) {
    if (ni.status === '确认' || (h.actualCostBasis && h.actualCostBasis.status === '确认')) {
      errors++; console.error(`❌ ${h.sym} 余额差异未解决，不能将最新成本标为确认`);
    }
    return;
  }
  const openings = (j.openingPositions || []).filter(o => o.account === acctIdOf(a) && o.sym === h.sym);
  if (openings.some(o => analysisQty(o) > 0 && o.actualCostBasis === null)) return;
  const costEvents = ni.scope === 'episode' ? ex.filter(e => e.episodeId === ni.episodeId) : ex;
  if (ni.scope === 'episode' && (!ni.episodeId || !costEvents.length)) {
    errors++; console.error(`❌ ${h.sym} 周期净投入缺对应流水`); return;
  }
  const buyAmt = costEvents.filter(e => e.side === 'buy').reduce((s, e) => s + analysisQty(e) * e.price, 0);
  const sellAmt = costEvents.filter(e => e.side === 'sell').reduce((s, e) => s + analysisQty(e) * e.price, 0);
  const openingAmt = openings.reduce((s, o) => s + analysisQty(o) * o.actualCostBasis, 0);
  const recomputed = Math.round((openingAmt + buyAmt - sellAmt) / h.qty * 100000) / 100000;
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

// ---- 8. Reviews 结构化复盘校验（reviewId 唯一、日期、executionId 引用、可见文本脱敏） ----
if (j.reviews) {
  const rvIds = j.reviews.map(r => r.reviewId);
  const nullRv = rvIds.filter(id => !id);
  const dupRv = rvIds.filter((id, i) => id && rvIds.indexOf(id) !== i);
  if (nullRv.length) { errors++; console.error(`❌ ${nullRv.length} 条 review 缺 reviewId`); }
  if (dupRv.length) { errors++; console.error(`❌ reviewId 重复: ${[...new Set(dupRv)].join(', ')}`); }
  else console.log(`✅ reviewId 唯一: ${rvIds.length} 条无重复`);
  let rvRefErr = 0, rvLeak = 0;
  const execIdSet = new Set(j.executions.map(e => e.executionId));
  j.reviews.forEach(r => {
    if (!r.date) { errors++; console.error(`❌ review ${r.reviewId} 缺 date`); }
    if (r.executionIds) r.executionIds.forEach(id => { if (!execIdSet.has(id)) { rvRefErr++; errors++; console.error(`❌ review ${r.reviewId} 引用缺失 execution: ${id}`); } });
    // 可见文本禁股数/金额（价格允许）
    if (r.visibility === 'internal') return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.reviewDate || '') || r.reviewTimezone !== 'Asia/Shanghai') {
      errors++; console.error('❌ 公开复盘缺中国日期/时区: ' + r.reviewId);
    }
    if (r.dateLabel !== r.reviewDate + ' 复盘') {
      errors++; console.error('❌ 复盘卡片日期与归属日不一致: ' + r.reviewId);
    }
    const texts = [r.title, r.dateLabel].concat(r.plan || [], r.execution || [], r.good || [], r.issues || [], r.todo || []);
    texts.forEach(t => { if (t && /[0-9]+\s*股|\$\s?[0-9]|[0-9]+\s*(美元|USD|元)/.test(t)) { rvLeak++; errors++; console.error(`❌ review ${r.reviewId} 可见文本含股数/金额: ${t.slice(0, 40)}`); } });
  });
  if (!rvRefErr) console.log('✅ reviews 引用关系: 所有 executionIds 均存在');
  if (!rvLeak) console.log('✅ reviews 可见文本无股数/金额');
} else {
  console.log('ℹ️ 无 reviews（尚未启用结构化复盘）');
}

// 同步验收：每条卖出必须派生一次；新交易必须被对应交易日复盘引用。
const derived = require('./derive').derive(j);
const viewIds = derived.trades.flatMap(t => t.legs.map(l => l.executionId));
const sales = j.executions.filter(e => e.side === 'sell' && e.includeInPerformance !== false && e.analysisQty !== 0);
sales.forEach(e => {
  if (viewIds.filter(id => id === e.executionId).length !== 1) {
    errors++; console.error('❌ 卖出视图缺失或重复: ' + e.executionId);
  }
});
derived.groups.forEach(d => d.trades.forEach(t => t.legs.forEach(l => {
  if (l.date !== d.date) { errors++; console.error('❌ 成交被归到错误交易日: ' + l.executionId); }
})));
require('./review_dates').validateReviewLinks(j).forEach(problem => {
  errors++; console.error('❌ ' + problem);
});
console.log('ℹ️ 同步检查: ' + sales.length + ' 条卖出与兑现视图对照，复盘按中国日期检查唯一归属');

// 当前纪律只有一个来源；旧ID继续映射，避免历史引用断裂或重新执行停用规则。
if (j.discipline && j.discipline.rules) {
  const groups = new Set((j.discipline.groups || []).map(g => g.id));
  const ruleIds = new Set();
  for (const r of j.discipline.rules) {
    if (!r.id || !groups.has(r.group) || !r.title || !Array.isArray(r.items) || !r.items.length) {
      errors++; console.error('❌ 当前纪律字段/分组缺失: ' + r.id);
    }
    for (const id of [r.id, ...(r.aliases || [])]) {
      if (ruleIds.has(id)) { errors++; console.error('❌ 当前纪律ID/别名重复: ' + id); }
      ruleIds.add(id);
    }
  }
  for (const r of j.discipline.inactiveRules || []) if (ruleIds.has(r.id)) {
    errors++; console.error('❌ 停用纪律仍作为当前规则: ' + r.id);
  }
  console.log('✅ 当前纪律及历史别名引用通过');
}

// 校验失败不能写入成功哈希。
if (errors > 0) {
  console.error(`\n❌ 校验失败: ${errors} 错误, ${warnings} 警告`);
  process.exit(1);
}

// ---- 9. 内容哈希（包含派生逻辑与渲染回归脚本） ----
function sha256(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
}
const hashes = {
  ledger: sha256(LEDGER),
  template: sha256(TEMPLATE),
  rules: sha256(RULES),
  build_public: sha256(path.join(ROOT, 'build_public.js')),
  derive: sha256(path.join(ROOT, 'derive.js')),
  presentation: sha256(path.join(ROOT, 'presentation.js')),
  review_dates: sha256(path.join(ROOT, 'review_dates.js')),
  render_test: sha256(path.join(ROOT, 'test_render.js')),
  agents: sha256(path.join(ROOT, 'AGENTS.md'))
};
const HASH_PATH = path.join(ROOT, '.hashes.json');
const HASH_KEYS = Object.keys(hashes);
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
