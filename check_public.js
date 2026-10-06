// check_public.js — 检查 public/index.html 发布产物是否符合最新展示规则
// 规则：允许期权张数(mult)；禁止实际股票数量(qty)、资金金额(nav 数字/市值)
// 用法: node check_public.js（须在 build_public.js 之后运行）
const fs = require('fs');
const path = require('path');
const HTML = path.join(__dirname, 'public', 'index.html');

let errors = 0;
let html;
try {
  html = fs.readFileSync(HTML, 'utf8');
} catch (e) {
  console.error('❌ public/index.html 不存在或无法读取（先运行 node build_public.js）');
  process.exit(1);
}

// 1. 禁止股数字段（实际股票数量）
if (/qty\s*:/.test(html)) {
  errors++;
  console.error('❌ 发布产物含 qty 字段（股票数量泄漏）');
} else {
  console.log('✅ 无股票数量（qty）泄漏');
}

// 2. 禁止资金金额（nav 数字 / 市值数字）
if (/nav\s*:\s*[0-9]/.test(html)) {
  errors++;
  console.error('❌ 发布产物含数字 nav（资金金额泄漏）');
} else {
  console.log('✅ 无资金金额（nav 数字）泄漏');
}

// 3. 允许期权张数（mult），确认没有被误删（有期权持仓时应存在）
if (/mult\s*:/.test(html)) {
  console.log('✅ 期权张数（mult）正常保留展示');
} else {
  console.log('ℹ️ 无 mult 字段（当前无期权张数数据，正常）');
}

// 4. 可见文本（reviews/journal/closed 说明等）禁止股数/金额：数字+「股」、数字+「元」、$数字
let proseBad = 0;
const proseLeaks = html.match(/[0-9]+\s*股|[0-9]+\s*(美元|USD|\b元)|\$\s?[0-9]/g);
if (proseLeaks) {
  // 排除期权「张数 ×8」的偶发命中（× 后为张数可显示）、价格上下文由人工辨识
  proseBad += proseLeaks.length;
  console.error('❌ 可见文本疑似股数/金额泄漏: ' + [...new Set(proseLeaks)].slice(0, 10).join(' | '));
} else {
  console.log('✅ 可见文本无股数/金额（prose 扫描）');
}
if (proseBad > 0) errors += proseBad;

if (errors > 0) {
  console.error(`\n❌ 发布产物检查失败: ${errors} 处问题，阻止部署`);
  process.exit(1);
}
console.log('\n✅ 发布产物检查通过（允许期权张数、无股数、无金额）');