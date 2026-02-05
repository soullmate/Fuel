#!/usr/bin/env python3
"""
Generate and output daily food summary for cron job.
Uses USER_TIMEZONE env var (defaults to UTC) since meals are logged in local time.
"""
from tracker import FoodTracker
from datetime import datetime
import os
import zoneinfo

def main():
    tz_name = os.environ.get('USER_TIMEZONE', 'UTC')
    tz = zoneinfo.ZoneInfo(tz_name)
    today_local = datetime.now(tz).date()
    tracker = FoodTracker()
    summary = tracker.format_daily_summary(today_local)
    print(summary)

if __name__ == '__main__':
    main()
