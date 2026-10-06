// build_public.js — 从 ledger-full.json 生成脱敏 public/index.html
// 用法: node build_public.js
// 输入: git-publish/data/ledger-full.json (唯一数据源) + git-publish/template.html (HTML 模板，已纳入仓库)
// 输出: git-publish/public/index.html (脱敏版，浏览器只加载脱敏数据)
const fs = require('fs');
const path = require('path');
const { derive } = require('./derive.js'); // 成交兑现视图派生（事实来自 executions）

const ROOT = __dirname;
const LEDGER_PATH = path.join(ROOT, 'data', 'ledger-full.json');
const TEMPLATE_PATH = path.join(ROOT, 'template.html');
const OUT_PATH = path.join(ROOT, 'public', 'index.html');

console.log('=== build_public.js ===');
console.log('数据源:', LEDGER_PATH);
console.log('模板:', TEMPLATE_PATH);
console.log('输出:', OUT_PATH);

// ---- 1. 读取 ledger-full.json ----
const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
console.log(`✅ ledger-full.json: ${ledger.accounts.length} accounts, ${ledger.executions.length} executions, ${ledger.episodes.length} episodes`);

// ---- 2. 生成脱敏数据 ----
// 成交兑现视图：由 executions 派生（事实），继承历史评语；按真实日期倒序
const derivedClosed = derive(ledger).groups;

// 递归剥离 qty 字段（股数），保留其他所有字段
function sanitize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      // 剥离 qty（股数），保留 cost（每股成本价，属于"价格"）
      if (k === 'qty') continue;
      // actualCostBasis/netInvestedCost 的 value 保留（是每股价格），但标注待核实的显示为 null
      if (k === 'actualCostBasis' && v && v.value === null) {
        out[k] = { value: null, note: v.note, status: v.status };
        continue;
      }
      out[k] = sanitize(v);
    }
    return out;
  }
  return obj;
}

// 用完整台账（含 qty）计算期权覆盖，返回脱敏字段（不含任何股数）
// 修复：公开数据删 qty 后 computeCoverage 把缺失当 0 导致 RAM/CRWG/CRDU 误判
function computeCoverageFromFull(h) {
  const shares = h.qty;
  const sharesUnknown = (shares === null || shares === undefined);
  let totalCallContracts = 0; // 未结算卖 call 张数
  if (h.options) {
    h.options.forEach(function (g) {
      (g.legs || []).forEach(function (leg) {
        if (leg.type !== 'C') return; // 仅统计 call
        if (g.settled) return;        // 仅统计尚未结算
        totalCallContracts += (leg.mult || 0);
      });
    });
  }
  const totalCallShares = totalCallContracts * 100;
  const sharesNum = sharesUnknown ? 0 : shares;
  const uncoveredShares = Math.max(0, totalCallShares - sharesNum); // 裸卖缺口
  const uncappedShares = Math.max(0, sharesNum - totalCallShares);   // 自由仓（非风险）
  let status, statusText;
  if (totalCallContracts === 0) { status = 'none'; statusText = '无备兑'; }
  else if (sharesUnknown) { status = 'unknown'; statusText = '待核实'; }
  else if (uncoveredShares > 0) { status = 'insufficient'; statusText = '覆盖不足'; }
  else if (uncappedShares > 0) { status = 'partial'; statusText = '部分覆盖'; }
  else { status = 'covered'; statusText = '全部覆盖'; }
  // 仅输出脱敏字段；股数字段（totalCallShares/uncoveredShares/uncappedShares）一律不外泄
  return {
    status: status,
    statusText: statusText,
    isFullyBacked: !sharesUnknown && totalCallContracts > 0 && uncoveredShares === 0,
    hasFreeShares: !sharesUnknown && uncappedShares > 0,
    sharesUnknown: sharesUnknown,
    coveragePct: (totalCallContracts > 0 && !sharesUnknown) ? Math.round(Math.min(sharesNum, totalCallShares) / totalCallShares * 100) : null,
    shareCoveragePct: (!sharesUnknown && sharesNum > 0) ? (totalCallShares > 0 ? Math.round(Math.min(sharesNum, totalCallShares) / sharesNum * 100) : 0) : null
  };
}

// 给完整 holding 附加预计算的覆盖结果（脱敏字段），供公开页面直接读取
function attachCoverage(h) {
  return { ...h, coverage: computeCoverageFromFull(h) };
}

// 字段映射：ledger-full.json 新字段名 → HTML 模板旧字段名
function mapFields(holding) {
  const h = { ...holding };
  // entrySetup → setup, entryExecStatus → execStatus（向后兼容）
  if (h.entrySetup && !h.setup) h.setup = h.entrySetup;
  if (h.entryExecStatus && !h.execStatus) h.execStatus = h.entryExecStatus;
  // costDisplay → costNote（持仓成本口径标注：渲染层用 costNote 显示"摊薄口径/实际成本"）
  if (h.costDisplay && !h.costNote) {
    h.costNote = h.costDisplay;
    delete h.costDisplay;
  }
  return h;
}

// 构建脱敏 DATA（与 HTML 模板中的 var DATA = {...} 结构一致）
const publicData = {
  asOf: ledger.asOf,
  asOfLabel: ledger.asOfLabel,
  fx: ledger.fx,
  discipline: ledger.discipline,
  accounts: ledger.accounts.map(acct => ({
    ...acct,
    holdings: (acct.holdings || []).map(h => mapFields(sanitize(attachCoverage(h))))
  })),
  closedTrades: derivedClosed.map(day => ({
    ...day,
    trades: (day.trades || []).map(t => ({
      ...sanitize(t),
      // legs 保留 executionId 引用（供勾稽），剥离可能出现的 qty
      legs: (t.legs || []).map(leg => sanitize(leg))
    }))
  })),
  // 结构化复盘（结构化记录），按真实日期倒序，最新置顶
  reviews: (ledger.reviews || []).slice().sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)))
};

// ---- 3. 读取 HTML 模板 ----
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// ---- 4. 替换 DATA 块 ----
// 找到 var DATA = {...} 的位置并替换
const dataMatch = template.match(/var DATA = (\{)/);
if (!dataMatch) {
  console.error('ERROR: 模板中未找到 var DATA');
  process.exit(1);
}
const dataStart = template.indexOf('{', dataMatch.index);
let depth = 0, dataEnd = -1;
for (let i = dataStart; i < template.length; i++) {
  if (template[i] === '{') depth++;
  else if (template[i] === '}') {
    depth--;
    if (depth === 0) { dataEnd = i; break; }
  }
}
if (dataEnd < 0) {
  console.error('ERROR: DATA 块配平失败');
  process.exit(1);
}

// 序列化脱敏数据为 JS 对象字面量（保持可读性）
function toJsLiteral(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map(item => padInner + toJsLiteral(item, indent + 1));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => {
      // 键名：如果是有效标识符则不加引号，否则加引号
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return padInner + key + ': ' + toJsLiteral(v, indent + 1);
    });
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return String(obj);
}

const dataLiteral = toJsLiteral(publicData);
const before = template.slice(0, dataStart);
const after = template.slice(dataEnd + 1);
const output = before + dataLiteral + after;

// ---- 5. 渲染层零泄露自检 ----
// 检查渲染函数中是否将 qty 拼入 HTML
const scriptMatch = output.match(/<script>([\s\S]*?)<\/script>/);
if (scriptMatch) {
  const script = scriptMatch[1];
  const renderFns = ['renderHoldings', 'renderClosed', 'renderMetrics', 'renderAccounts', 'renderAlerts'];
  let leak = 0;
  for (const fn of renderFns) {
    const fnStart = script.indexOf('function ' + fn);
    if (fnStart < 0) continue;
    const fnEnd = script.indexOf('\n  function ', fnStart + 1);
    const body = fnEnd > fnStart ? script.slice(fnStart, fnEnd) : script.slice(fnStart);
    const lines = body.split('\n');
    for (const line of lines) {
      // 检查 html += 或 innerHTML 赋值行中是否包含 .qty（但不包括注释和 computeCoverage 内部）
      if (/html\s*\+=|innerHTML/.test(line) && /\.qty\b/.test(line) && !line.trim().startsWith('//')) {
        // 排除 computeCoverage 函数体内的行
        if (!body.includes('computeCoverage')) {
          console.error(`⚠️ 渲染函数 ${fn} 疑似拼接 qty: ${line.trim()}`);
          leak++;
        }
      }
    }
  }
  if (leak > 0) {
    console.error(`渲染层自检发现 ${leak} 处疑似股数泄漏，中止发布`);
    process.exit(1);
  }
}

// 检查输出中是否残留 qty 字段（不应有）
const qtyCheck = output.match(/"qty"\s*:|qty\s*:/g);
if (qtyCheck) {
  // 只允许 computeCoverage 内部的 h.qty（泛化代码，无具体数值）
  const allowed = output.match(/h\.qty\s*\|\|\s*0/g);
  const allowedCount = allowed ? allowed.length : 0;
  if (qtyCheck.length > allowedCount) {
    console.error(`⚠️ 输出中残留 ${qtyCheck.length - allowedCount} 处 qty 字段（允许 ${allowedCount} 处 computeCoverage 泛化代码）`);
    // 打印前5处
    const lines = output.split('\n');
    let found = 0;
    for (let i = 0; i < lines.length && found < 5; i++) {
      if (/qty\s*:/.test(lines[i]) && !/h\.qty\s*\|\|\s*0/.test(lines[i])) {
        console.error(`  行${i+1}: ${lines[i].trim().slice(0, 100)}`);
        found++;
      }
    }
    console.error('中止发布');
    process.exit(1);
  }
}

// ---- 6. 输出 ----
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, output, 'utf8');

// 统计
const stats = {
  accounts: publicData.accounts.length,
  holdings: publicData.accounts.reduce((s, a) => s + (a.holdings || []).length, 0),
  closedTrades: publicData.closedTrades.length,
  dataSize: dataLiteral.length,
  outputSize: output.length
};

console.log('✅ PUBLISH OK →', OUT_PATH);
console.log('   统计:', stats);
console.log('   渲染层零泄露自检: 通过');
console.log('   qty 剥离: 通过');
