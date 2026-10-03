// build_public.js — 发布脚本：把内部主文件发布到 GitHub 仓库
// 用法: node build_public.js <源文件> <输出文件>
// 口径(2026-10-03 变更)：源码保留完整 qty/cost/交易记录，供 Agent 爬取回顾；
//   页面渲染层不显示股数/金额（renderHoldings/renderClosed 本就不输出 qty）。
//   本脚本负责：①渲染层零股数自检 ②原样复制 ③输出数据完整性摘要。
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

// —— 渲染层零股数自检：渲染/告警函数体内，拼接 HTML 的行不得出现 qty ——
// (computeCoverage 内 var shares=h.qty 只用于算覆盖率%、不渲染股数，属豁免)
const renderFns = ['renderHoldings', 'renderClosed', 'renderMetrics', 'renderAccounts', 'renderAlerts', 'collectAlerts'];
let leak = 0;
renderFns.forEach(fn => {
  const s = js0.indexOf('function ' + fn);
  if (s < 0) return;
  const e = js0.indexOf('\n  function ', s + 1);
  const body = e > s ? js0.slice(s, e) : js0.slice(s);
  body.split('\n').forEach(line => {
    if (/html\s*\+?=/.test(line) && /\.qty\b|\bqty\b/.test(line)) {
      console.error('⚠️ 渲染函数 ' + fn + ' 疑似拼接股数: ' + line.trim());
      leak++;
    }
  });
});
if (leak > 0) { console.error('渲染层自检发现 ' + leak + ' 处疑似股数泄漏，中止发布'); process.exit(1); }

// —— 原样复制（源码保留完整 qty/cost，供 Agent 爬取）——
fs.writeFileSync(outPath, src, 'utf8');

// —— 数据完整性摘要 ——
let holdings = 0, opts = 0, closedTrades = 0, fills = 0;
(DATA.accounts || []).forEach(a => (a.holdings || []).forEach(h => { holdings++; if (h.options) opts += h.options.reduce((n, g) => n + g.legs.length, 0); }));
(DATA.closedTrades || []).forEach(d => d.trades.forEach(t => { closedTrades++; fills += t.legs.length; }));
console.log('PUBLISH OK ->', outPath);
console.log('数据完整性：持仓 ' + holdings + ' · 期权腿 ' + opts + ' · 平仓交易 ' + closedTrades + ' · 成交笔 ' + fills);
console.log('源码已保留 qty/cost（供 Agent 爬取），渲染层不显示股数/金额');