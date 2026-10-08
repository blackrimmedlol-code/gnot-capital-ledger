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
