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

if (errors > 0) {
  console.error(`\n❌ 发布产物检查失败: ${errors} 处问题，阻止部署`);
  process.exit(1);
}
console.log('\n✅ 发布产物检查通过（允许期权张数、无股数、无金额）');