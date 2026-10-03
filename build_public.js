// build_public.js — 生成 GitHub 公开脱敏版页面
// 用法: node build_public.js <源文件> <输出文件>
// 说明: 从内部主文件(含 qty:成本等内部字段)生成零股数公开版。
//   - 预计算每只含期权持仓的覆盖%(_cov)并从 DATA 移除 qty
//   - 移除平仓记录与其余所有 qty 字段(渲染不依赖)
//   - 保留 cost(每股成本价,价格口径)、价格、张数、收益率%、仓位%
const fs = require('fs');

const srcPath = process.argv[2];
const outPath = process.argv[3];
if (!srcPath || !outPath) { console.error('用法: node build_public.js <源> <输出>'); process.exit(1); }

const src = fs.readFileSync(srcPath, 'utf8');

// —— 提取含 var DATA 的 <script> 块 ——
const blocks = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m; while ((m = re.exec(src))) blocks.push(m[1]);
const js0 = blocks.find(b => b.includes('var DATA ='));
if (!js0) { console.error('未找到 DATA script'); process.exit(1); }

// —— 定位 DATA 字面量(花括号配平) ——
const ds = js0.indexOf('var DATA =');
const open = js0.indexOf('{', ds);
let depth = 0, end = -1;
for (let i = open; i < js0.length; i++) {
  const c = js0[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
}
if (end < 0) { console.error('DATA 配平失败'); process.exit(1); }
const dataSrc = js0.slice(open, end + 1);

// —— 运行时求值 DATA(本项目自有可信内容) ——
const DATA = eval('(' + dataSrc + ')');

// —— 复刻 computeCoverage 逻辑(不含 qty 亦可配合 _cov) ——
function cov(h) {
  const shares = h.qty || 0;
  let totalCall = 0, naked = 0, settled = 0;
  if (h.options) h.options.forEach(g => g.legs.forEach(leg => {
    const c = (leg.mult || 0) * 100;
    if (g.settled) { settled += c; return; }
    totalCall += c; if (leg.naked) naked += c;
  }));
  const eff = Math.min(shares, totalCall - naked);
  const uncovered = totalCall - eff;
  let status = 'covered';
  if (uncovered > 0 && totalCall > 0) status = naked >= totalCall ? 'naked' : 'partial';
  if (totalCall === 0) status = 'none';
  return {
    totalCallShares: totalCall, coveredShares: eff, nakedShares: uncovered,
    settledShares: settled,
    coveragePct: totalCall > 0 ? Math.round(eff / totalCall * 100) : 100,
    shareCoveragePct: shares > 0 ? Math.round(eff / shares * 100) : 100,
    status: status
  };
}

// —— 1) 为含期权的持仓注入 _cov 并替换其 qty(按键值安全定位) ——
let nd = dataSrc;
(DATA.accounts || []).forEach(acct => {
  (acct.holdings || []).forEach(h => {
    if (h.options && h.options.length > 0 && h.qty != null) {
      const body = JSON.stringify(cov(h));
      const pat = new RegExp('(sym:\\s*"' + h.sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '",[^}]*?)\\bqty\\s*:\\s*' + h.qty + '\\s*,\\s*');
      if (!pat.test(nd)) { console.error('未定位持仓 qty: ' + h.sym); process.exit(1); }
      nd = nd.replace(pat, '$1_cov: ' + body + ', ');
    }
  });
});

// —— 2) 移除其余所有 qty(null|数字) 字段 ——
nd = nd.replace(/\bqty\s*:\s*(?:null|[\d.]+)\s*,?\s*/g, '');

// —— 3) computeCoverage 优先使用预计算 _cov ——
const covOpen = '  function computeCoverage(h) {\n    // 返回 { coveredCalls, nakedCalls, coveredShares, nakedShares, coveragePct, status }';
const covPatch = '  function computeCoverage(h) {\n    if (h._cov) { return h._cov; }\n    // 返回 { coveredCalls, nakedCalls, coveredShares, nakedShares, coveragePct, status }';
if (!js0.includes(covOpen)) { console.error('computeCoverage 起始文本不匹配'); process.exit(1); }
let js1 = js0.replace(covOpen, covPatch);

// —— 4) 回填 DATA、(若有多个 script 需定位原块) 重新拼装整页 ——
js1 = js1.replace(dataSrc, nd);
const out = src.replace(js0, js1);
fs.writeFileSync(outPath, out, 'utf8');
console.log('BUILD OK ->', outPath);
console.log('已脱敏 _cov:', (DATA.accounts||[]).reduce((a,x)=>a.concat((x.holdings||[]).filter(h=>h._cov).map(h=>h.sym+' shareCov='+(cov(h).shareCoveragePct)+'% status='+cov(h).status)),[]).join('  ') || '无');