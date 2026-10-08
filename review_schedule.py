"""Compute the next real NYSE close + 30m using the verified calendar.

The task keeps one RRULE and moves its next DTSTART/clock before reviewing.
Calendar facts stay in the repository and never enter the public website.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
CN = ZoneInfo('Asia/Shanghai')
CALENDAR = Path(__file__).parent / 'data' / 'review-calendar.json'


def next_schedule(after, calendar):
    if after.tzinfo is None:
        raise ValueError('after requires an explicit timezone')
    start = dt.date.fromisoformat(calendar['validFrom'])
    end = dt.date.fromisoformat(calendar['validThrough'])
    day = max(after.astimezone(NY).date(), start)
    holidays = set(calendar['closedDates'])
    early = set(calendar['earlyCloseDates'])
    while day <= end:
        label = day.isoformat()
        if day.weekday() < 5 and label not in holidays:
            hour = 13 if label in early else 16
            trigger = dt.datetime.combine(day, dt.time(hour, 30), NY)
            if trigger > after:
                schedule = ('BEGIN:VEVENT\nDTSTART;TZID=America/New_York:' +
                            trigger.strftime('%Y%m%dT%H%M%S') +
                            '\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=' +
                            str(hour) + ';BYMINUTE=30;BYSECOND=0\nEND:VEVENT')
                return {'schedule': schedule, 'marketDate': label,
                        'runAtNY': trigger.isoformat(),
                        'runAtShanghai': trigger.astimezone(CN).isoformat()}
        day += dt.timedelta(days=1)
    raise ValueError('Calendar expired: refresh official NYSE dates before rescheduling')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--after', help='ISO instant with offset; default is now')
    args = parser.parse_args()
    after = dt.datetime.fromisoformat(args.after) if args.after else dt.datetime.now(dt.timezone.utc)
    print(json.dumps(next_schedule(after, json.loads(CALENDAR.read_text())), ensure_ascii=False))
