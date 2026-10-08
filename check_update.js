// 日常更新单一验收入口；只汇总结果，失败时输出完整诊断。
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const script of ['verify.js', 'build_public.js', 'check_public.js', 'test_derive.js', 'test_review_dates.js', 'test_review_schedule.py', 'test_reconciliation.js', 'test_render.js']) {
  const result = spawnSync(script.endsWith('.py') ? 'python3' : process.execPath, [path.join(__dirname, script)], { cwd: __dirname, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || String(result.error || ''));
    console.error('❌ 更新验收失败：' + script);
    process.exit(result.status || 1);
  }
  const warnings = (result.stderr || '').split('\n').filter(l => l.includes('⚠️')).length;
  console.log('✅ ' + script + (warnings ? '（' + warnings + ' 项待核实警告，详见完整校验输出）' : ''));
}
console.log('✅ 更新验收通过；部署后仍须验证实际线上卡片。');
