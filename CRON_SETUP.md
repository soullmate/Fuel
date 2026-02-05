# FUEL Cron Jobs

Background agents run on cron schedules to maintain system health and data quality. This guide explains how to set them up.

## Prerequisites

1. FUEL server running (`node web/server.js`)
2. Logs directory exists (`mkdir -p logs`)
3. Node.js available in cron environment

---

## Cron Entries

Edit your crontab:

```bash
crontab -e
```

Add these entries (adjust `/path/to/fuel-public` to your actual path):

```cron
# ============================================
# FUEL Background Agents
# ============================================

# PA Scan — Process agent reports (every 15 min)
# Reads reports from HAYDEN, DIQQ, etc. and acknowledges them
*/15 * * * * cd /path/to/fuel-public && node agents/pa-scan.js >> logs/pa-scan.log 2>&1

# HAYDEN Quick — Fast health check (every 15 min)
# Tests: database connection, API health
*/15 * * * * cd /path/to/fuel-public && node agents/hayden.js --quick >> logs/hayden-quick.log 2>&1

# HAYDEN Full — Complete test suite (hourly)
# Tests: schema integrity, write capability, DIQQ status, meal sanity, pipeline audit
0 * * * * cd /path/to/fuel-public && node agents/hayden.js >> logs/hayden.log 2>&1

# DIQQ — Data quality scan (every 3 hours)
# Enriches foods with USDA micronutrient data
0 */3 * * * curl -s -X POST http://localhost:3456/api/diqq/scan >> /path/to/fuel-public/logs/diqq.log 2>&1
```

---

## Schedule Overview

| Agent | Frequency | Purpose |
|-------|-----------|---------|
| PA Scan | Every 15 min | Process pending agent reports |
| HAYDEN Quick | Every 15 min | Basic health check (DB + API) |
| HAYDEN Full | Hourly | Complete test suite |
| DIQQ | Every 3 hours | USDA data enrichment |

---

## Verification

### Check cron is configured

```bash
crontab -l
```

### Watch logs in real-time

```bash
# PA scan
tail -f logs/pa-scan.log

# HAYDEN
tail -f logs/hayden.log

# DIQQ
tail -f logs/diqq.log
```

### Check pending reports

```bash
curl http://localhost:3456/api/reports/pending
```

### Manually trigger each agent

```bash
# PA Scan
node agents/pa-scan.js

# HAYDEN Quick
node agents/hayden.js --quick

# HAYDEN Full
node agents/hayden.js

# DIQQ Scan
curl -X POST http://localhost:3456/api/diqq/scan
```

---

## Troubleshooting

### Cron not running

1. Check cron service: `systemctl status cron`
2. Check cron logs: `grep CRON /var/log/syslog`
3. Ensure paths are absolute (cron doesn't use your shell's PATH)

### Agent reports not being created

1. Ensure FUEL server is running: `curl http://localhost:3456/api/health`
2. Check agent output manually: `node agents/hayden.js`
3. Verify `agent_reports` table exists: `sqlite3 food_tracker.db ".schema agent_reports"`

### PA Scan not processing reports

1. Check pending reports exist: `curl http://localhost:3456/api/reports/pending`
2. Run PA scan manually: `node agents/pa-scan.js`
3. Check for errors in logs: `tail -20 logs/pa-scan.log`

---

## Agent Communication Flow

```
┌─────────────────┐     ┌─────────────────┐
│  HAYDEN (1h)    │     │   DIQQ (3h)     │
│  Health checks  │     │  Data quality   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
            POST /api/reports
                     │
                     ▼
        ┌─────────────────────┐
        │   agent_reports     │
        │   (SQLite table)    │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │   PA Scan (15min)   │
        │   GET /api/reports/ │
        │   pending           │
        └──────────┬──────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
    for_human=0         for_human=1
    (PA handles)        (Queue for human)
         │                   │
    Store/note          Alert next
                        conversation
```

---

## Log Rotation (Optional)

To prevent logs from growing indefinitely, add logrotate config:

```bash
sudo nano /etc/logrotate.d/fuel
```

```
/path/to/fuel-public/logs/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```
