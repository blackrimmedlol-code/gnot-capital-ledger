// 复盘引用按实际中国日期核对；原美东日期只用于来源和成本流水顺序。
const { chinaExecutionTime } = require('./derive');

function reviewDateConstraint(execution, ledger) {
  const local = chinaExecutionTime(execution);
  // 明确成交日期或精确时刻优先于历史复盘归属例外。
  const explicit = local.datePrecision === 'instant' ||
    execution.chinaDateSource?.type === 'explicit_user_confirmation';
  const override = !explicit && (ledger.reviewDateOverrides || []).find(x =>
    x.executionId === execution.executionId && x.source?.type === 'user_confirmed_review_label');
  return override ? { date: override.reviewDate, dateEnd: override.reviewDate } : local;
}

function validateReviewLinks(ledger) {
  const problems = [];
  const reviews = (ledger.reviews || []).filter(r => r.visibility !== 'internal');
  for (const r of reviews) {
    if (new Set(r.executionIds || []).size !== (r.executionIds || []).length)
      problems.push('复盘重复引用成交: ' + r.reviewId);
  }
  const since = ledger.methodology?.updatePolicy?.reviewRequiredFrom;
  for (const e of ledger.executions || []) {
    if (!since || e.date < since) continue;
    const linked = reviews.filter(r => (r.executionIds || []).includes(e.executionId));
    if (linked.length !== 1) {
      problems.push('新成交必须归属唯一公开复盘: ' + e.executionId);
      continue;
    }
    const expected = reviewDateConstraint(e, ledger);
    const date = linked[0].reviewDate;
    if (!date || date < expected.date || date > expected.dateEnd)
      problems.push('复盘归属与中国成交日期不符: ' + e.executionId + ' → ' + linked[0].reviewId);
  }
  return problems;
}

module.exports = { reviewDateConstraint, validateReviewLinks };
