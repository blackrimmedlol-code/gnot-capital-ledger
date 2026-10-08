const assert = require('node:assert/strict');
const { validateReviewLinks } = require('./review_dates');
const ledger = {
  methodology: { updatePolicy: { reviewRequiredFrom: '2026-10-05' } },
  executions: [{ executionId: 'SALE', date: '2026-10-07', timezone: 'America/New_York',
    chinaDate: '2026-10-08', chinaDateSource: { type: 'explicit_user_confirmation' } }],
  reviews: [{ reviewId: 'RV7', date: '2026-10-07', reviewDate: '2026-10-07', executionIds: ['SALE'] }]
};
assert.ok(validateReviewLinks(ledger).some(x => x.includes('中国成交日期')), '相同美东日期掩盖了错误复盘归属');
ledger.reviews[0].reviewDate = '2026-10-08';
assert.deepEqual(validateReviewLinks(ledger), [], '原美东日不同不应阻止正确中国日期复盘');
ledger.reviews.push({ ...ledger.reviews[0], reviewId: 'DUP' });
assert.ok(validateReviewLinks(ledger).some(x => x.includes('唯一')), '成交被重复放入两个复盘');
ledger.reviews.pop();
ledger.reviews[0].executionIds = [];
assert.ok(validateReviewLinks(ledger).some(x => x.includes('唯一')), '成交复盘遗漏未被阻止');
ledger.reviews[0].executionIds = ['SALE'];
ledger.executions[0] = { executionId: 'SALE', date: '2026-10-07', timezone: 'America/New_York',
  timestamp: '2026-10-07T13:00:00-04:00' };
assert.deepEqual(validateReviewLinks(ledger), [], '带时区成交未按实际中国日期归属');
delete ledger.executions[0].timestamp;
ledger.reviews[0].reviewDate = '2026-10-09';
assert.ok(validateReviewLinks(ledger).some(x => x.includes('中国成交日期')), '未知时刻被挪到可能日期区间之外');
ledger.reviewDateOverrides = [{ executionId: 'SALE', reviewDate: '2026-10-07',
  source: { type: 'user_confirmed_review_label' } }];
ledger.reviews[0].reviewDate = '2026-10-07';
assert.deepEqual(validateReviewLinks(ledger), [], '用户确认的历史归属未保留');
ledger.executions[0].chinaDate = '2026-10-08';
ledger.executions[0].chinaDateSource = { type: 'explicit_user_confirmation' };
assert.ok(validateReviewLinks(ledger).length, '历史例外覆盖了后来明确确认的实际成交日期');
assert.deepEqual(validateReviewLinks(require('./data/ledger-full.json')), []);
console.log('✅ 复盘归属通过：中国日期、跨午夜、唯一引用、历史例外与明确日期优先');
const { validateExecutionDates } = require('./review_dates');
const current = { methodology: { updatePolicy: { actualChinaDateRequiredFrom: '2026-10-08' } },
  executions: [{ executionId: 'NEW', date: '2026-10-08', timezone: 'America/New_York', time: null }] };
assert.ok(validateExecutionDates(current).some(p => p.includes('不能发布模糊日期区间')));
current.executions[0].chinaDate = '2026-10-08';
current.executions[0].chinaDateSource = { type: 'explicit_user_confirmation', evidence: '用户确认实际中国日期' };
assert.deepEqual(validateExecutionDates(current), [], '已确认日期且无时刻仍被阻止');
current.executions[0].timestamp = '2026-10-08T13:00:00-04:00';
assert.ok(validateExecutionDates(current).some(p => p.includes('精确成交时刻冲突')));
current.executions[0].chinaDate = '2026-10-09';
assert.deepEqual(validateExecutionDates(current), []);
delete current.executions[0].timestamp;
current.executions[0].chinaDate = '2026-02-30';
assert.ok(validateExecutionDates(current).some(p => p.includes('无效')));
current.executions[0] = { executionId: 'BACKFILL', date: '2026-09-01', timezone: 'America/New_York',
  source: { confirmedDate: '2026-10-08' } };
assert.ok(validateExecutionDates(current).length, '当前补录的旧成交漏过实际日期要求');
current.executions[0].source.confirmedDate = '2026-09-02';
assert.deepEqual(validateExecutionDates(current), [], '未知历史日期被强制猜填');
assert.deepEqual(validateExecutionDates(require('./data/ledger-full.json')), []);
console.log('✅ 成交日期来源门槛、非法日期、精确时刻冲突与历史保留通过');
