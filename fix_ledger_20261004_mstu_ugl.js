// fix_ledger_20261004_mstu_ugl.js — 修复 MSTU/UGL 重复成交 + episodeId 引用断裂
const fs = require('fs');
const path = require('path');
const LEDGER = path.join(__dirname, 'data', 'ledger-full.json');
const j = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const log = [];
const fix = m => log.push('🔧 ' + m);

// ============ 1. UGL 明确重复：SELL-028 vs SELL-030（同账户/标的/日期/数量30/价格48.5） ============
const u28 = j.executions.filter(e => e.executionId === 'EX-20260925-UGL-SELL-028');
const u30 = j.executions.filter(e => e.executionId === 'EX-20260925-UGL-SELL-030');
if (u28.length === 1 && u30.length === 1 && u28[0].qty === u30[0].qty && u28[0].price === u30[0].price) {
  j.executions = j.executions.filter(e => e.executionId !== 'EX-20260925-UGL-SELL-028');
  fix('删除重复成交 EX-20260925-UGL-SELL-028（与 SELL-030 同账户/标的/日期/数量30/价格48.5），保留 SELL-030→EP-UGL-CLOSED-20260925');
} else { console.error('UGL SELL-028/030 匹配异常'); process.exit(1); }

// ============ 2. MSTU 重复：SELL-026 vs SELL-029（同账户/标的/日期/价格43.5，清仓腿唯一） ============
const m26 = j.executions.filter(e => e.executionId === 'EX-20261001-MSTU-SELL-026');
const m29 = j.executions.filter(e => e.executionId === 'EX-20261001-MSTU-SELL-029');
if (m26.length === 1 && m29.length === 1 && m26[0].price === m29[0].price) {
  j.executions = j.executions.filter(e => e.executionId !== 'EX-20261001-MSTU-SELL-026');
  fix('删除重复成交 EX-20261001-MSTU-SELL-026（与 SELL-029 同价格43.5清仓腿，数量待核实的那条），保留 SELL-029→EP-MSTU-CLOSED-20261001');
} else { console.error('MSTU SELL-026/029 匹配异常'); process.exit(1); }

// ============ 3. MSTU 剩余 executions episodeId 统一到 CLOSED ============
let mstuRenamed = 0;
j.executions.forEach(e => {
  if (e.sym === 'MSTU' && e.episodeId === 'EP-MSTU-2026Q3') { e.episodeId = 'EP-MSTU-CLOSED-20261001'; mstuRenamed++; }
});
fix(`MSTU ${mstuRenamed} 条 executions episodeId → EP-MSTU-CLOSED-20261001`);

// ============ 4. UGL 剩余 executions episodeId 统一到 CLOSED ============
let uglRenamed = 0;
j.executions.forEach(e => {
  if (e.sym === 'UGL' && e.episodeId === 'EP-UGL-2026Q3') { e.episodeId = 'EP-UGL-CLOSED-20260925'; uglRenamed++; }
});
fix(`UGL ${uglRenamed} 条 executions episodeId → EP-UGL-CLOSED-20260925`);

// ============ 5. 记录修正 ============
j.corrections = (j.corrections || []).concat([
  { date: '2026-10-04', item: 'UGL重复成交', detail: '删除 EX-20260925-UGL-SELL-028（与 SELL-030 同一笔 30@48.5）' },
  { date: '2026-10-04', item: 'MSTU重复成交', detail: '删除 EX-20261001-MSTU-SELL-026（与 SELL-029 同一清仓腿 43.5）' },
  { date: '2026-10-04', item: 'MSTU/UGL引用', detail: 'executions episodeId 统一到 CLOSED 周期（修复 open→closed 迁移遗留断裂）' }
]);

fs.writeFileSync(LEDGER, JSON.stringify(j, null, 2) + '\n', 'utf8');
console.log(log.join('\n'));
console.log('修正后 executions=' + j.executions.length + ' episodes=' + j.episodes.length);