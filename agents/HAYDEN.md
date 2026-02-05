# HAYDEN — System Health Supervisor

**Role:** Continuous system health monitoring. Runs hourly to catch failures before users hit them.

**Named after:** A vigilant guardian who never sleeps.

---

## Core Responsibility

HAYDEN ensures the food tracker system is functioning correctly by:
1. Running test scenarios against the database
2. Validating API endpoints return expected data
3. Creating issues (tickets) when something breaks
4. Auto-fixing problems when possible
5. Reporting to the personal assistant, which decides what to escalate to the human

---

## Hourly Test Suite

### Test 1: Database Connection
```sql
SELECT 1;
```
- **Pass:** Returns 1
- **Fail:** DB file missing, corrupted, or locked

### Test 2: Schema Integrity
```sql
-- Check all expected tables exist
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('foods', 'meals', 'meal_items');

-- Check critical columns exist in foods
PRAGMA table_info(foods);
-- Must have: id, name, calories, protein_g, total_fat_g, total_carbs_g

-- Check critical columns exist in meals  
PRAGMA table_info(meals);
-- Must have: id, date, time, meal_type

-- Check critical columns exist in meal_items
PRAGMA table_info(meal_items);
-- Must have: id, meal_id, food_id, quantity, unit, actual_grams
```
- **Pass:** All tables and columns present
- **Fail:** Missing table/column → attempt migration or create issue

### Test 3: API Health Check
```
GET /api/health → expect { status: 'ok' }
GET /api/daily → expect valid JSON with 'date' field
GET /api/foods?limit=1 → expect array
```
- **Pass:** All endpoints return expected format
- **Fail:** Server down, endpoint broken, or wrong response format

### Test 4: Write Test (Canary Meal)
```
POST /api/meals {
  date: TODAY,
  time: '00:00',
  meal_type: 'test',
  items: [{ food_name: 'Test Canary', calories: 0 }]
}
→ Expect 201 with meal ID

DELETE /api/meals/{id}
→ Expect 200/204
```
- **Pass:** Can create and delete test meal
- **Fail:** Write permissions broken, foreign key issues, etc.

### Test 5: DIQQ Integration
```
GET /api/diqq/status → expect JSON with counts
```
- **Pass:** DIQQ reporting correctly
- **Fail:** DIQQ module broken

### Test 6: Daily Summary Generation
```
-- Simulate daily summary query
SELECT 
  m.meal_time,
  SUM(f.calories * mi.amount) as total_calories
FROM meals m
JOIN meal_items mi ON m.id = mi.meal_id
JOIN foods f ON mi.food_id = f.id
WHERE date(m.meal_time) = date('now')
GROUP BY date(m.meal_time);
```
- **Pass:** Query executes without error
- **Fail:** Schema mismatch, missing columns

### Test 7: LOGOS Schema Consistency ⚠️ CRITICAL

Verifies that `DATABASE_SCHEMA.md` matches the actual database schema.

**Check 1: Foods table columns**
```sql
PRAGMA table_info(foods);
```
Verify these columns exist with correct names:
- `calories` (not `cal`)
- `protein_g` (not `protein`)
- `fat_g` (not `fat`)
- `carbs_g` (not `carbs`)
- `fiber_g` (not `fiber`)
- `sugar_g` (not `sugar`)
- `serving_size`
- `brand`

**Check 2: Meals table structure**
```sql
PRAGMA table_info(meals);
```
Verify:
- `meal_time` is DATETIME (not separate date/time columns)
- `meal_type` exists
- `title` exists

**Check 3: Meal_items amount convention**
```sql
PRAGMA table_info(meal_items);
```
Verify:
- `amount` exists (100g multiplier)
- `actual_grams` exists
- `quantity` exists

**Check 4: Validate existing data**
```sql
-- Find any meal_items where amount looks like raw grams (>10 is suspicious)
SELECT COUNT(*) FROM meal_items WHERE amount > 10;
```
- If count > 0, likely logging errors exist (amount should be 0.01-3.0 typically)

**Check 5: Verify DATABASE_SCHEMA.md exists and is recent**
```bash
stat agents/DATABASE_SCHEMA.md
```
- File must exist
- Modified within last 30 days

**On Failure:**
1. Create CRITICAL issue
2. Alert user immediately — incorrect schema docs cause silent data corruption
3. Regenerate DATABASE_SCHEMA.md from actual DB if needed

---

### Test 8: Pipeline Documentation Check

Verifies critical documentation exists:

```bash
stat agents/MEAL_LOGGING_PIPELINE.md
stat agents/DATABASE_SCHEMA.md
stat agents/LOGOS.md
```

- **Pass:** All files exist and are < 30 days old
- **Fail:** Missing documentation → CRITICAL issue

### Test 9: Meal Amount Sanity Check

Catches logging errors where `amount` was set to grams instead of grams÷100.

```sql
SELECT 
    m.id as meal_id,
    m.title,
    m.meal_time,
    f.name as food,
    mi.amount,
    mi.actual_grams,
    ROUND(f.calories * mi.amount, 1) as calculated_cal
FROM meals m
JOIN meal_items mi ON m.id = mi.meal_id
JOIN foods f ON mi.food_id = f.id
WHERE mi.amount > 10  -- Suspicious: >1kg of food?
   OR (mi.actual_grams IS NOT NULL AND ABS(mi.amount - mi.actual_grams/100.0) > 0.1)
ORDER BY m.meal_time DESC
LIMIT 20;
```

- **Pass:** No rows returned
- **Fail:** Found meals with suspicious amounts → create issue with specific meal IDs

**Auto-fix:** If `actual_grams` exists and `amount` looks wrong, offer to fix:
```sql
UPDATE meal_items SET amount = actual_grams / 100.0 
WHERE actual_grams IS NOT NULL AND amount > 10;
```

---

## Issue Management

When a test fails, HAYDEN creates an issue in `issues/`:

```
issues/
├── OPEN/
│   └── 2026-01-29_schema_mismatch.md
├── FIXED/
│   └── 2026-01-28_api_timeout.md
└── WONTFIX/
```

### Issue Format
```markdown
# [SEVERITY] Brief Description

**Detected:** 2026-01-29 08:00 UTC
**Test:** Test 2 - Schema Integrity
**Status:** OPEN | FIXED | WONTFIX

## Error
<exact error message>

## Impact
What user-facing features are broken?

## Auto-Fix Attempted
- [x] Attempted: <action>
- [ ] Result: Success/Failed

## Manual Fix Required
Steps for human to resolve if auto-fix failed.

## Resolution
(filled when fixed)
```

---

## Auto-Fix Capabilities

HAYDEN can automatically fix:

| Issue | Auto-Fix |
|-------|----------|
| Missing column | `ALTER TABLE ADD COLUMN` |
| Missing index | `CREATE INDEX` |
| Server not running | `pm2 restart fuel` |
| Stale test data | Clean up orphaned test meals |
| DIQQ backlog | Trigger DIQQ scan |

HAYDEN **cannot** auto-fix (creates issue for human):
- Data corruption
- Missing tables (needs full migration)
- Permission errors
- External API failures (USDA down)

---

## Alert Policy

HAYDEN reports to the **personal assistant** via the `agent_reports` table. The PA decides what to escalate to the human.

| Severity | Report Action | PA Should |
|----------|---------------|-----------|
| **CRITICAL** | `for_human=1` | Alert human immediately |
| **HIGH** | `for_human=1` | Alert human next conversation |
| **MEDIUM** | `for_human=0` | Include in daily briefing |
| **LOW/INFO** | `for_human=0` | Log only, don't mention |

**Critical examples:** DB corrupted, can't write meals, server completely down
**High examples:** Daily summary broken, API returning errors
**Medium examples:** DIQQ enrichment failing, slow queries
**Low examples:** Test cleanup failed, minor warnings

### Reporting to PA

After each run, HAYDEN posts a summary to `POST /api/reports`:

```json
{
  "agent": "hayden",
  "severity": "info",        // or "high", "critical"
  "category": "health",
  "summary": "All 13 tests passed",
  "details": {
    "tests_run": 13,
    "tests_passed": 13,
    "failed_tests": [],
    "auto_fixes": [],
    "issues_created": []
  },
  "for_human": 0             // 1 if critical/high
}
```

---

## Cron Setup

### 1. Add to crontab

```bash
crontab -e
```

Add these entries (adjust path as needed):

```cron
# HAYDEN Full — Complete test suite (hourly)
0 * * * * cd /path/to/fuel-public && node agents/hayden.js >> logs/hayden.log 2>&1

# HAYDEN Quick — Health check (every 15 min)
*/15 * * * * cd /path/to/fuel-public && node agents/hayden.js --quick >> logs/hayden-quick.log 2>&1
```

### 2. Create logs directory

```bash
mkdir -p logs
```

### 3. Verify

```bash
# Check cron is running
crontab -l

# Watch logs
tail -f logs/hayden.log

# Check reports are being created
curl http://localhost:3456/api/reports/pending?agent=hayden
```

---

## State File

HAYDEN maintains state in `agents/hayden-state.json`:

```json
{
  "lastRun": "2026-01-29T08:00:00Z",
  "lastFullRun": "2026-01-29T08:00:00Z",
  "consecutiveFailures": 0,
  "openIssues": 1,
  "testsRun": 156,
  "testsPassed": 155,
  "lastAlert": null,
  "checksToday": {
    "database": "pass",
    "schema": "pass", 
    "api": "pass",
    "write": "pass",
    "diqq": "pass",
    "dailySummary": "fail"
  }
}
```

---

## Pipeline Audit & Monitoring (Tests 10-13)

These run during the full test suite (not --quick) and perform active maintenance.

### Test 10: Stale Request Sweep
- Calls `GET /api/pipeline/sweep/stale?minutes=30`
- For each stale request: composes nudge message, calls `POST /api/pipeline/requests/:id/followup`
- After 3 followups with no response: calls `POST /api/pipeline/requests/:id/abandon`
- Runs `POST /api/pipeline/sweep/expire` to bulk-expire over-followed requests

### Test 11: Committed Meal Audit
- Calls `GET /api/pipeline/sweep/audit?threshold=0.6` for low-confidence meals
- For each meal: checks gram amounts, calorie sanity, decision chain integrity, food match confidence
- Writes audit findings to `decision_log` with `agent='hayden', action='audit'`
- Verdicts: `clean`, `needs_review`, `needs_correction`

### Test 12: Dashboard Anomaly Detection
- Flags daily calories > 6000
- Flags empty meals (0 items)
- Flags impossible amounts (single item > 2000g or > 5000 cal)
- Logs anomalies to `decision_log` with `agent='hayden', action='anomaly_scan'`

### Test 13: Error Rate Reporting
- Calls `GET /api/pipeline/requests/stats?days=7` and `?days=14`
- Tracks commit rate, drop rate (abandoned + expired)
- Compares this week vs last week for trend
- Alerts if drop rate > 10%

---

## Pigeon Integration

HAYDEN can spawn Pigeon audit workers (`lib/pigeon.js`) for deeper investigation:
- `pigeon.audit(mealId)` — full meal audit with confidence adjustment
- `pigeon.chase(requestId)` — evaluate and follow up on stale requests
- `pigeon.flock()` — batch audit + chase + anomaly scan

Pigeons write to `decision_log` with `agent='pigeon'`. HAYDEN writes with `agent='hayden'`.

---

## Integration with Other Agents

- **Pipeline**: HAYDEN sweeps stale requests and audits low-confidence commits
- **DIQQ**: HAYDEN checks DIQQ is running; DIQQ focuses on data quality
- **LOGOS**: HAYDEN ensures the logging pipeline works; LOGOS handles user input
- **Pigeon**: HAYDEN spawns pigeons for detailed meal audits
