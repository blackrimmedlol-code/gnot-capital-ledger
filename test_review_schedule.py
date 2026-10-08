import datetime as dt
import json
from review_schedule import CALENDAR, next_schedule

calendar = json.loads(CALENDAR.read_text())
def check(after, expected):
    actual = next_schedule(dt.datetime.fromisoformat(after), calendar)
    assert actual['runAtShanghai'] == expected, actual

check('2026-10-08T10:33:39+08:00', '2026-10-09T04:30:00+08:00')
check('2026-11-02T00:00:00-05:00', '2026-11-03T05:30:00+08:00')
check('2026-11-26T00:00:00-05:00', '2026-11-28T02:30:00+08:00')
check('2026-11-27T13:31:00-05:00', '2026-12-01T05:30:00+08:00')
check('2026-12-23T16:31:00-05:00', '2026-12-25T02:30:00+08:00')
check('2026-12-24T13:31:00-05:00', '2026-12-29T05:30:00+08:00')
check('2028-07-02T00:00:00-04:00', '2028-07-04T01:30:00+08:00')
try:
    next_schedule(dt.datetime.fromisoformat('2029-01-01T00:00:00+00:00'), calendar)
except ValueError:
    pass
else:
    raise AssertionError('expired calendar was guessed')
print('✅ 收盘复盘调度通过：夏冬令时、休市、提前收盘、恢复常规时钟、日历有效期')
