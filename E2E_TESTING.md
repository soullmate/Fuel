# FUEL — End-to-End Testing Guide

> This document describes every E2E test that should be run to validate the FUEL system.
> An agent can follow this guide step-by-step to verify a fresh install works completely.

## Prerequisites

1. Node.js 18+
2. No existing `food_tracker.db` (tests use a fresh database)
3. Server NOT already running on port 3456

## Setup

```bash
cd /path/to/fuel-public
npm install
cp .env.example .env
# Edit .env: set ACCESS_TOKEN to something or remove it for easier testing
```

---

## Phase 1: Fresh Install & Server Boot

**Goal:** Verify the system starts from zero state.

### 1.1 Start the server with no database

```bash
# Remove any existing DB to test fresh install
rm -f food_tracker.db
node web/server.js &
# Wait for: "FUEL v3 running on http://..."
# The server should auto-create the DB from schema.sql
```

**Verify:**
- [ ] Server prints "Database initialized from schema.sql"
- [ ] Server prints "FUEL v3 running on http://127.0.0.1:3456"
- [ ] File `food_tracker.db` now exists

### 1.2 Health check

```bash
curl http://localhost:3456/api/health
```

**Expected:** `{"status":"ok"}`

### 1.3 Verify empty state

```bash
# Settings should have defaults
curl http://localhost:3456/api/settings
# Expected: JSON with weight_kg, height_cm, age, sex fields (may be defaults or empty)

# No foods yet
curl http://localhost:3456/api/foods
# Expected: [] (empty array)

# No meals today
curl http://localhost:3456/api/daily
# Expected: JSON with targets + consumed (all zeros) + empty meals array

# No pending reports
curl http://localhost:3456/api/reports/pending
# Expected: {"count":0,"reports":[]}
```

**Checklist:**
- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] `/api/settings` returns JSON (defaults exist)
- [ ] `/api/foods` returns `[]`
- [ ] `/api/daily` returns targets with zero consumed
- [ ] `/api/reports/pending` returns count 0

---

## Phase 2: Settings

**Goal:** Verify user profile configuration and target calculation.

### 2.1 Update user settings

```bash
curl -X PUT http://localhost:3456/api/settings \
  -H 'Content-Type: application/json' \
  -d '{
    "weight_kg": 70,
    "height_cm": 175,
    "age": 30,
    "sex": "male",
    "activity_mult": 1.55,
    "protein_per_kg": 1.6
  }'
```

**Expected:** 200 OK with updated settings.

### 2.2 Read back settings

```bash
curl http://localhost:3456/api/settings
```

**Verify:**
- [ ] `weight_kg` = 70
- [ ] `height_cm` = 175
- [ ] `age` = 30
- [ ] `sex` = "male"
- [ ] `activity_mult` = 1.55
- [ ] `protein_per_kg` = 1.6
- [ ] `carb_cycling_enabled` = 0 (default off)

### 2.3 Daily targets reflect settings (simple mode)

```bash
curl http://localhost:3456/api/daily
```

**Verify:**
- [ ] `targets.calories` is a positive number (should be ~2500-2700 based on TDEE for 70kg/175cm/30yo male at 1.55 activity)
- [ ] `targets.protein_g` = 112 (70 * 1.6)
- [ ] Phase info shows "Simple" or "off"

### 2.4 Enable carb cycling

```bash
curl -X PUT http://localhost:3456/api/settings \
  -H 'Content-Type: application/json' \
  -d '{
    "carb_cycling_enabled": 1,
    "cycle_start_date": "2026-02-01",
    "cycle_length": 28,
    "buffer_days": 5,
    "fasting_duration": 2,
    "keto_strictness": 50
  }'
```

### 2.5 Verify cycling targets change by date

```bash
# Day 1 of cycle (buffer phase - high carb)
curl http://localhost:3456/api/daily/2026-02-01

# Day 7 (fasting phase - should be zero or near-zero)
curl http://localhost:3456/api/daily/2026-02-07

# Day 10 (keto phase - low carb)
curl http://localhost:3456/api/daily/2026-02-10

# Day 20 (reintro/refuel - carbs increasing)
curl http://localhost:3456/api/daily/2026-02-20
```

**Verify:**
- [ ] Day 1: High calories, high carbs (buffer)
- [ ] Day 7: Zero or near-zero calories (fasting phase)
- [ ] Day 10: Low carbs (<50g), higher fat (keto phase)
- [ ] Day 20: Moderate carbs, increasing (reintro/refuel)
- [ ] Protein stays consistent on non-fasting days (~112g)

### 2.6 Week view shows phase progression

```bash
curl "http://localhost:3456/api/week/2026-02-01?days=14"
```

**Verify:**
- [ ] Returns 14 days of data
- [ ] Each day has different targets (not flat)
- [ ] Phases progress: buffer → pre-fast → fasting → keto

### 2.7 Disable cycling (return to simple mode)

```bash
curl -X PUT http://localhost:3456/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"carb_cycling_enabled": 0}'
```

```bash
curl http://localhost:3456/api/daily
```

**Verify:**
- [ ] Targets are flat (no phase info)
- [ ] Phase shows "Simple" or "off"

---

## Phase 3: Foods CRUD

**Goal:** Verify the food database works end-to-end with all 50+ nutrition fields.

### 3.1 Create a basic food

```bash
curl -X POST http://localhost:3456/api/foods \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "chicken breast",
    "serving_unit": "g",
    "calories": 165,
    "protein_g": 31,
    "fat_g": 3.6,
    "carbs_g": 0,
    "fiber_g": 0,
    "sugar_g": 0
  }'
```

**Expected:** Returns `{ id: 1 }` (or similar). Save this ID as `CHICKEN_ID`.

### 3.2 Create a food with full micronutrients

```bash
curl -X POST http://localhost:3456/api/foods \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "egg, whole, cooked",
    "serving_unit": "g",
    "calories": 155,
    "protein_g": 12.6,
    "fat_g": 10.6,
    "carbs_g": 1.1,
    "fiber_g": 0,
    "sugar_g": 1.1,
    "cholesterol_mg": 373,
    "sodium_mg": 124,
    "potassium_mg": 126,
    "calcium_mg": 50,
    "iron_mg": 1.2,
    "vitamin_a_mcg": 149,
    "vitamin_d_mcg": 2.0,
    "vitamin_b12_mcg": 1.1,
    "selenium_mcg": 30.8,
    "choline_mg": 293.8,
    "histidine_g": 0.31,
    "isoleucine_g": 0.67,
    "leucine_g": 1.09,
    "lysine_g": 0.91,
    "methionine_g": 0.39,
    "phenylalanine_g": 0.68,
    "threonine_g": 0.56,
    "tryptophan_g": 0.17,
    "valine_g": 0.86
  }'
```

Save returned ID as `EGG_ID`.

### 3.3 Create more test foods

```bash
# Brown rice
curl -X POST http://localhost:3456/api/foods \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "brown rice, cooked",
    "calories": 123,
    "protein_g": 2.7,
    "fat_g": 1.0,
    "carbs_g": 25.6,
    "fiber_g": 1.6,
    "sugar_g": 0.4
  }'

# Broccoli
curl -X POST http://localhost:3456/api/foods \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "broccoli, steamed",
    "calories": 35,
    "protein_g": 2.4,
    "fat_g": 0.4,
    "carbs_g": 7.2,
    "fiber_g": 3.3,
    "sugar_g": 1.4,
    "vitamin_c_mg": 64.9,
    "vitamin_k_mcg": 141.1
  }'
```

### 3.4 Search foods

```bash
curl "http://localhost:3456/api/foods?search=chicken"
```

**Verify:**
- [ ] Returns array containing "chicken breast"
- [ ] Does NOT return egg, rice, or broccoli

```bash
curl "http://localhost:3456/api/foods?search=egg"
```

**Verify:**
- [ ] Returns "egg, whole, cooked"

### 3.5 Get single food

```bash
curl http://localhost:3456/api/foods/1
```

**Verify:**
- [ ] Returns chicken breast with all macro fields
- [ ] `calories` = 165, `protein_g` = 31

### 3.6 Update a food

```bash
curl -X PUT http://localhost:3456/api/foods/1 \
  -H 'Content-Type: application/json' \
  -d '{"calories": 170, "protein_g": 31.5}'
```

```bash
curl http://localhost:3456/api/foods/1
```

**Verify:**
- [ ] `calories` = 170 (updated)
- [ ] `protein_g` = 31.5 (updated)
- [ ] Other fields unchanged

### 3.7 Delete a food

```bash
# Create a throwaway food
curl -X POST http://localhost:3456/api/foods \
  -H 'Content-Type: application/json' \
  -d '{"name": "delete_me", "calories": 1}'
```

Save returned ID as `DELETE_ID`.

```bash
curl -X DELETE http://localhost:3456/api/foods/$DELETE_ID
curl http://localhost:3456/api/foods/$DELETE_ID
```

**Verify:**
- [ ] DELETE returns success
- [ ] Subsequent GET returns 404 or empty result

---

## Phase 4: Meal Logging

**Goal:** Verify the complete meal logging lifecycle and macro calculations.

### 4.1 Log a simple meal

```bash
curl -X POST http://localhost:3456/api/meals \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Grilled Chicken Bowl",
    "meal_type": "lunch",
    "meal_time": "2026-02-05 12:30:00",
    "items": [
      {"food_id": 1, "amount": 1.5},
      {"food_id": 3, "amount": 2.0},
      {"food_id": 4, "amount": 0.8}
    ]
  }'
```

Notes:
- food_id 1 = chicken breast (150g → amount 1.5)
- food_id 3 = brown rice (200g → amount 2.0)
- food_id 4 = broccoli (80g → amount 0.8)

Save returned meal ID as `MEAL_ID`.

### 4.2 Verify meal macros

```bash
curl http://localhost:3456/api/meals/$MEAL_ID
```

**Verify macro math (per 100g * amount):**
- [ ] Chicken: 170 * 1.5 = 255 cal, 31.5 * 1.5 = 47.25g protein
- [ ] Rice: 123 * 2.0 = 246 cal, 2.7 * 2.0 = 5.4g protein
- [ ] Broccoli: 35 * 0.8 = 28 cal, 2.4 * 0.8 = 1.92g protein
- [ ] **Total: ~529 cal, ~54.6g protein** (approximately)
- [ ] Meal has 3 items listed

### 4.3 Add an item to existing meal

```bash
curl -X POST http://localhost:3456/api/meals/$MEAL_ID/items \
  -H 'Content-Type: application/json' \
  -d '{"food_id": 2, "amount": 0.5}'
```

(Adding 50g of egg)

```bash
curl http://localhost:3456/api/meals/$MEAL_ID
```

**Verify:**
- [ ] Meal now has 4 items
- [ ] Totals increased by egg contribution (~77.5 cal, ~6.3g protein)

### 4.4 Update a meal item

Get the egg item ID from the previous response, then:

```bash
curl -X PUT http://localhost:3456/api/meal-items/$ITEM_ID \
  -H 'Content-Type: application/json' \
  -d '{"amount": 1.0}'
```

(Change egg from 50g to 100g)

**Verify:**
- [ ] Item amount updated to 1.0
- [ ] Meal totals recalculated

### 4.5 Delete a meal item

```bash
curl -X DELETE http://localhost:3456/api/meal-items/$ITEM_ID
```

**Verify:**
- [ ] Item removed
- [ ] Meal now has 3 items again
- [ ] Totals decreased accordingly

### 4.6 Update meal metadata

```bash
curl -X PUT http://localhost:3456/api/meals/$MEAL_ID \
  -H 'Content-Type: application/json' \
  -d '{"title": "Updated Chicken Bowl", "meal_type": "dinner"}'
```

**Verify:**
- [ ] Title changed
- [ ] meal_type changed to "dinner"
- [ ] Items and macros unchanged

### 4.7 Log a second meal (different time)

```bash
curl -X POST http://localhost:3456/api/meals \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Morning Eggs",
    "meal_type": "breakfast",
    "meal_time": "2026-02-05 08:00:00",
    "items": [
      {"food_id": 2, "amount": 2.0}
    ]
  }'
```

(200g of eggs for breakfast)

### 4.8 List meals with pagination

```bash
curl "http://localhost:3456/api/meals?limit=1&offset=0"
```

**Verify:**
- [ ] Returns 1 meal (limit=1)
- [ ] Pagination works

```bash
curl "http://localhost:3456/api/meals?limit=10&offset=0"
```

**Verify:**
- [ ] Returns 2 meals

### 4.9 Delete a meal

```bash
curl -X DELETE http://localhost:3456/api/meals/$MEAL_ID
```

```bash
curl http://localhost:3456/api/meals/$MEAL_ID
```

**Verify:**
- [ ] DELETE succeeds
- [ ] GET returns 404 or empty
- [ ] Meal items also deleted (cascade)

---

## Phase 5: Daily Progress Tracking

**Goal:** Verify daily aggregation, target calculation, and date isolation.

### 5.1 Set up: re-enable simple mode, log meals on two different days

```bash
curl -X PUT http://localhost:3456/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"carb_cycling_enabled": 0}'
```

```bash
# Meal on Feb 5
curl -X POST http://localhost:3456/api/meals \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Lunch Bowl",
    "meal_type": "lunch",
    "meal_time": "2026-02-05 12:00:00",
    "items": [{"food_id": 1, "amount": 2.0}]
  }'

# Meal on Feb 4 (yesterday)
curl -X POST http://localhost:3456/api/meals \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Yesterday Dinner",
    "meal_type": "dinner",
    "meal_time": "2026-02-04 19:00:00",
    "items": [{"food_id": 2, "amount": 1.5}]
  }'
```

### 5.2 Check Feb 5 daily

```bash
curl http://localhost:3456/api/daily/2026-02-05
```

**Verify:**
- [ ] `consumed.calories` reflects ONLY the Feb 5 meal (chicken 170 * 2.0 = 340 cal)
- [ ] `consumed.protein_g` = 31.5 * 2.0 = 63g
- [ ] `targets` section has calorie/protein/fat/carb targets
- [ ] `progress` section shows remaining = targets - consumed
- [ ] `meals` array has exactly 1 meal (may include the breakfast eggs if not deleted)

### 5.3 Check Feb 4 daily

```bash
curl http://localhost:3456/api/daily/2026-02-04
```

**Verify:**
- [ ] `consumed.calories` reflects ONLY the Feb 4 meal (eggs 155 * 1.5 = 232.5 cal)
- [ ] Feb 5 meals do NOT appear here

### 5.4 Check a date with no meals

```bash
curl http://localhost:3456/api/daily/2026-01-01
```

**Verify:**
- [ ] `consumed` all zeros
- [ ] `targets` still present (based on settings)
- [ ] `meals` is empty array

---

## Phase 6: Meal Validation

**Goal:** Verify the validation system catches common errors.

### 6.1 Log a meal with suspiciously high amount (raw grams mistake)

```bash
curl -X POST http://localhost:3456/api/meals \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Bad Amount Test",
    "meal_type": "lunch",
    "meal_time": "2026-02-05 13:00:00",
    "items": [{"food_id": 1, "amount": 150}]
  }'
```

Note: `amount: 150` means 15,000g of chicken — clearly wrong. The user meant 150g (should be 1.5).

**Verify:**
- [ ] Meal is saved (validation is post-save)
- [ ] Validation log contains a warning about amount=150 looking like raw grams
- [ ] Check: `curl http://localhost:3456/api/validation/log` — should show the issue

### 6.2 Recheck validation

```bash
curl http://localhost:3456/api/validation/recheck/$BAD_MEAL_ID
```

**Verify:**
- [ ] Returns validation result with issues
- [ ] Issue mentions amount looks like raw grams

### 6.3 Clean up bad meal

```bash
curl -X DELETE http://localhost:3456/api/meals/$BAD_MEAL_ID
```

---

## Phase 7: Agent Reports System

**Goal:** Verify the full agent communication lifecycle.

### 7.1 Create a report (simulating HAYDEN)

```bash
curl -X POST http://localhost:3456/api/reports \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "hayden",
    "severity": "info",
    "category": "health",
    "summary": "All 13 tests passed",
    "details": {"tests_run": 13, "tests_passed": 13, "duration_ms": 450},
    "for_human": 0
  }'
```

Save returned ID as `REPORT_1`.

### 7.2 Create a critical report (simulating HAYDEN failure)

```bash
curl -X POST http://localhost:3456/api/reports \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "hayden",
    "severity": "critical",
    "category": "health",
    "summary": "Database write test FAILED — cannot create meals",
    "details": {"test": "write_canary", "error": "SQLITE_READONLY"},
    "for_human": 1
  }'
```

Save returned ID as `REPORT_2`.

### 7.3 Create a DIQQ data quality report

```bash
curl -X POST http://localhost:3456/api/reports \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "diqq",
    "severity": "low",
    "category": "data_quality",
    "summary": "Enriched 5 foods with USDA data",
    "details": {"enriched": 5, "failed": 1, "queue_remaining": 12},
    "for_human": 0
  }'
```

### 7.4 Create a learning report

```bash
curl -X POST http://localhost:3456/api/reports \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "ricky",
    "severity": "info",
    "category": "learning",
    "summary": "User prefers metric units",
    "details": {"preference": "metric_units", "confidence": 0.9},
    "for_human": 0
  }'
```

### 7.5 Check pending reports

```bash
curl http://localhost:3456/api/reports/pending
```

**Verify:**
- [ ] `count` = 4 (all 4 unacknowledged)
- [ ] Reports contain all agents (hayden, diqq, ricky)
- [ ] for_human flags are correct (report 2 = 1, others = 0)

### 7.6 Acknowledge a report

```bash
curl -X PUT http://localhost:3456/api/reports/$REPORT_1/ack \
  -H 'Content-Type: application/json' \
  -d '{"resolution": "noted"}'
```

```bash
curl http://localhost:3456/api/reports/pending
```

**Verify:**
- [ ] `count` = 3 (one acknowledged)
- [ ] Acknowledged report no longer in pending list

### 7.7 Filter reports

```bash
curl "http://localhost:3456/api/reports?agent=hayden"
```

**Verify:**
- [ ] Returns only HAYDEN reports (2)

```bash
curl "http://localhost:3456/api/reports?severity=critical"
```

**Verify:**
- [ ] Returns only the critical report

---

## Phase 8: PA Scan Agent

**Goal:** Verify `agents/pa-scan.js` processes reports correctly.

### 8.1 Ensure pending reports exist

```bash
curl http://localhost:3456/api/reports/pending
# Should have 3 pending from Phase 7
```

### 8.2 Run PA Scan

```bash
cd /path/to/fuel-public
FUEL_API_BASE=http://localhost:3456 node agents/pa-scan.js
```

**Expected output:**
```
PA Scan starting...
Processing 3 pending report(s)...
[CRITICAL] hayden: Database write test FAILED...
  → Queued for human attention
[LOW     ] diqq: Enriched 5 foods with USDA data
  → logged_for_briefing
[INFO    ] ricky: User prefers metric units
  → Learning: {"preference":"metric_units","confidence":0.9}
  → stored_in_memory
PA Scan complete. Processed 3 report(s).
```

### 8.3 Verify all reports acknowledged

```bash
curl http://localhost:3456/api/reports/pending
```

**Verify:**
- [ ] `count` = 0
- [ ] All reports processed

### 8.4 Check resolutions

```bash
curl http://localhost:3456/api/reports
```

**Verify resolutions:**
- [ ] Critical health report → `queued_for_human`
- [ ] Low data_quality report → `logged_for_briefing`
- [ ] Info learning report → `stored_in_memory`
- [ ] Info health report (from 7.6) → `noted` (manually acked)

### 8.5 Run PA Scan with no pending reports

```bash
FUEL_API_BASE=http://localhost:3456 node agents/pa-scan.js
```

**Verify:**
- [ ] Prints "No pending reports."
- [ ] Exits cleanly (exit code 0)

---

## Phase 9: HAYDEN Health Agent

**Goal:** Verify `agents/hayden.js` runs its test suite against the live system.

### 9.1 Run HAYDEN quick check

```bash
cd /path/to/fuel-public
FUEL_API_BASE=http://localhost:3456 node agents/hayden.js --quick
```

**Verify:**
- [ ] Runs without crashing
- [ ] Tests DB connection
- [ ] Tests API health endpoint
- [ ] Prints pass/fail summary

### 9.2 Run HAYDEN full suite

```bash
FUEL_API_BASE=http://localhost:3456 node agents/hayden.js
```

**Verify:**
- [ ] All tests run (schema check, write test, API validation, etc.)
- [ ] State file updated: check `agents/hayden-state.json`
- [ ] Reports created: `curl http://localhost:3456/api/reports?agent=hayden`

### 9.3 Verify HAYDEN reports

```bash
curl "http://localhost:3456/api/reports?agent=hayden"
```

**Verify:**
- [ ] New reports created by HAYDEN (from this run)
- [ ] Severity reflects test results (info if all pass, high/critical if failures)

---

## Phase 10: Unit Weights

**Goal:** Verify unit-to-gram conversion system.

### 10.1 Create a unit weight

```bash
curl -X POST http://localhost:3456/api/unit-weights \
  -H 'Content-Type: application/json' \
  -d '{"food_id": 2, "unit": "large egg", "grams": 50}'
```

### 10.2 Retrieve unit weights for a food

```bash
curl "http://localhost:3456/api/unit-weights?food_id=2"
```

**Verify:**
- [ ] Returns the "large egg" = 50g mapping
- [ ] Correctly associated with food_id 2

### 10.3 Get all unit weights

```bash
curl http://localhost:3456/api/unit-weights
```

**Verify:**
- [ ] Returns all unit weight entries

---

## Phase 11: Decision Log & Decompositions

**Goal:** Verify audit trail and composite dish tracking.

### 11.1 Create a decision log entry

```bash
curl -X POST http://localhost:3456/api/decision-log \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "logos",
    "action": "food_matched",
    "meal_id": 1,
    "details": {"input": "chicken", "matched": "chicken breast", "confidence": 0.95}
  }'
```

### 11.2 Read decision log

```bash
curl http://localhost:3456/api/decision-log
```

**Verify:**
- [ ] Entry exists with agent, action, details

### 11.3 Create a decomposition

```bash
curl -X POST http://localhost:3456/api/decompositions \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Caesar Salad",
    "components": [
      {"food_id": 1, "amount_g": 100, "note": "grilled chicken"},
      {"food_id": 4, "amount_g": 150, "note": "romaine base"}
    ]
  }'
```

### 11.4 Retrieve decomposition

```bash
curl http://localhost:3456/api/decompositions/1
```

**Verify:**
- [ ] Returns decomposition with components
- [ ] Components have food references

---

## Phase 12: DIQQ Data Quality (Partial — No USDA Key Required)

**Goal:** Verify DIQQ endpoints respond correctly even without an API key.

### 12.1 Check DIQQ status

```bash
curl http://localhost:3456/api/diqq/status
```

**Verify:**
- [ ] Returns JSON with data quality overview
- [ ] Does not crash even if USDA_API_KEY not set

### 12.2 Trigger DIQQ scan

```bash
curl -X POST http://localhost:3456/api/diqq/scan
```

**Verify:**
- [ ] Returns response (may be error about missing API key, which is fine)
- [ ] Server doesn't crash

### 12.3 Try enriching a food

```bash
curl -X POST http://localhost:3456/api/diqq/enrich/1
```

**Verify:**
- [ ] Returns response (may fail without API key)
- [ ] Server remains healthy: `curl http://localhost:3456/api/health`

---

## Phase 13: History & Audit

### 13.1 Meal history

```bash
curl "http://localhost:3456/api/history?limit=10"
```

**Verify:**
- [ ] Returns recent meals
- [ ] Sorted by most recent first
- [ ] Pagination works

### 13.2 Audit endpoint

```bash
curl http://localhost:3456/api/audit
```

**Verify:**
- [ ] Returns `{ total_issues: 0, issues: [] }` or similar

---

## Phase 14: Authentication (If ACCESS_TOKEN Set)

**Goal:** Verify token-based authentication protects the app.

### 14.1 Set up: restart server with ACCESS_TOKEN

Stop the server, ensure `.env` has:
```
ACCESS_TOKEN=fuel-test123
```

Restart: `node web/server.js &`

### 14.2 Unauthenticated request blocked

```bash
curl http://localhost:3456/api/settings
```

**Verify:**
- [ ] Returns 404 "Not found" (not 401 — app hides its existence)

### 14.3 Health check still accessible

```bash
curl http://localhost:3456/health
```

**Verify:**
- [ ] Returns 200 (health check bypasses auth — note: `/health` not `/api/health`)

### 14.4 Authenticated via token URL

```bash
curl http://localhost:3456/fuel-test123/api/settings
```

**Verify:**
- [ ] Returns 200 with settings JSON
- [ ] Response includes `Set-Cookie: fuel_token=...`

### 14.5 Localhost direct access (for cron agents)

Requests from 127.0.0.1 without `X-Forwarded-For` header bypass auth:

```bash
curl http://127.0.0.1:3456/api/health
```

**Verify:**
- [ ] Returns 200 (localhost bypass works)
- [ ] This is how HAYDEN, PA-Scan, and DIQQ cron jobs access the API

---

## Phase 15: Cleanup & Final Checks

### 15.1 Stop the server

```bash
kill %1  # or kill the server process
```

### 15.2 Verify no orphaned processes

```bash
ps aux | grep "web/server.js" | grep -v grep
# Should return nothing
```

### 15.3 Clean up test data

```bash
rm -f food_tracker.db
rm -f data/meal_validation.log
rm -f agents/hayden-state.json
```

---

## Summary Checklist

| Phase | Tests | Description |
|-------|-------|-------------|
| 1 | 5 | Fresh install & server boot |
| 2 | 7 | Settings CRUD + cycling toggle |
| 3 | 7 | Foods CRUD (create, read, search, update, delete) |
| 4 | 9 | Meal lifecycle (log, add/update/delete items, pagination) |
| 5 | 4 | Daily progress aggregation + date isolation |
| 6 | 3 | Meal validation catches bad data |
| 7 | 7 | Agent reports CRUD + filtering |
| 8 | 5 | PA Scan processes reports with correct resolutions |
| 9 | 3 | HAYDEN health checks run successfully |
| 10 | 3 | Unit weight mappings |
| 11 | 4 | Decision log + decompositions |
| 12 | 3 | DIQQ endpoints (no API key needed) |
| 13 | 2 | History + audit |
| 14 | 4 | Authentication (token URL, localhost bypass) |
| 15 | 3 | Cleanup |

**Total: ~69 checks across 15 phases**

---

## Running as Automated Tests

To convert this manual guide into automated tests, create `tests/e2e.test.js` using Jest:

1. `npm install --save-dev jest`
2. Add to `package.json`: `"test": "jest --forceExit --detectOpenHandles"`
3. Write a `tests/helpers.js` that:
   - Creates a temp DB from `schema.sql` + migrations
   - Starts `web/server.js` on a random port as a child process
   - Provides `api(method, path, body)` helper
   - Cleans up (kill server, delete temp DB) in `afterAll`
4. Each Phase above becomes a `describe()` block
5. Each checkbox becomes an `it()` test with `expect()` assertions

```bash
npm test
# Expected: All tests pass, clean exit
```
