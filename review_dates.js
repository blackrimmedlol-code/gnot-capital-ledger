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

function validateExecutionDates(ledger) {
  const problems = [];
  const since = ledger.methodology?.updatePolicy?.actualChinaDateRequiredFrom;
  const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  for (const e of ledger.executions || []) {
    const instant = e.timestamp || e.source?.statementTimestamp;
    const exact = instant && /(?:Z|[+-]\d{2}:\d{2})$/.test(instant) && Number.isFinite(Date.parse(instant));
    if (e.chinaDate !== undefined && (!validDay(e.chinaDate) || !e.chinaDateSource?.type))
      problems.push('实际中国日期无效或缺来源: ' + e.executionId);
    if (exact && e.chinaDate && e.chinaDate !== chinaExecutionTime(e).date)
      problems.push('实际中国日期与精确成交时刻冲突: ' + e.executionId);
    const recorded = e.recordedAt || e.source?.reportedAt || e.source?.confirmedAt || e.source?.confirmedDate;
    const current = since && (e.date >= since || (recorded && recorded.slice(0, 10) >= since));
    const sourcedDay = validDay(e.chinaDate) && e.chinaDateSource?.type && e.chinaDateSource?.evidence;
    const localSource = validDay(e.date) && ['Asia/Shanghai', 'Asia/Hong_Kong'].includes(e.timezone);
    if (current && !exact && !sourcedDay && !localSource)
      problems.push('新成交缺有来源的实际中国日期/带时区成交时间，不能发布模糊日期区间: ' + e.executionId);
  }
  return problems;
}

module.exports = { reviewDateConstraint, validateReviewLinks, validateExecutionDates };
