// verify.js — 数据校验（executionId 去重 + 成本口径合规 + 内容哈希）
// 用法: node verify.js
// 用途: 提交/部署前必须跑一次；保护实施期间新增记录，确认成本口径分记正确
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = __dirname;
const LEDGER = path.join(ROOT, 'data', 'ledger-full.json');
const TEMPLATE = path.join(ROOT, '..', '投资台账复盘_20260920.html');
const RULES = path.join(ROOT, 'RULES_日常更新.md');

let j;
try {
  j = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
} catch (e) {
  console.error('❌ ledger-full.json 解析失败:', e.message);
  process.exit(1);
}

let errors = 0, warnings = 0;

// ---- 1. executionId 去重（成交唯一记录，重复导入不产生重复） ----
const ids = j.executions.map(e => e.executionId);
const nullIds = ids.filter(id => !id);
const dupIds = ids.filter((id, i) => id && ids.indexOf(id) !== i);
if (nullIds.length) { errors++; console.error(`❌ ${nullIds.length} 条 execution 缺 executionId`); }
if (dupIds.length) { errors++; console.error(`❌ executionId 重复: ${[...new Set(dupIds)].join(', ')}`); }
else console.log(`✅ executionId 去重: ${ids.length} 条无重复`);

// ---- 2. 成本口径合规（正股净投入 / 组合净投入分开；有期权持仓必须两者分离） ----
let optHolds = 0, noComposite = 0, noNet = 0, badPending = 0;
j.accounts.forEach(a => {
  (a.holdings || []).forEach(h => {
    const hasOpt = (h.options || []).length > 0;
    if (hasOpt) {
      optHolds++;
      if (!h.compositeNetInvested) { noComposite++; errors++; console.error(`❌ ${h.sym} 有期权但缺 compositeNetInvested（组合净投入，含期权现金流）`); }
      if (!h.netInvestedCost) { noNet++; errors++; console.error(`❌ ${h.sym} 缺 netInvestedCost（正股净投入，不含期权）`); }
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

// ---- 3. 内容哈希（数据 / 模板 / 规则 / 构建脚本，用于判断是否有变化） ----
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