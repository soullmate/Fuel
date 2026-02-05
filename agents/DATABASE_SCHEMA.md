# DATABASE_SCHEMA.md — Canonical DB Reference for LOGOS

**Last verified:** 2026-02-03
**Database:** food_tracker.db

---

## ⚠️ CRITICAL RULES

1. **All food macros are stored PER 100g/100ml** — not per serving
2. **meal_items.amount is a MULTIPLIER of 100g** — not grams (0.15 = 15g)
3. **Column names have suffixes** — `protein_g` not `protein`, `sodium_mg` not `sodium`
4. **meal_time is DATETIME** — format: `'YYYY-MM-DD HH:MM:SS'`

---

## Table: `foods`

Stores nutritional data **per 100g or 100ml**.

### Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `name` | TEXT | Unique food name |
| `brand` | TEXT | Brand name (optional) |
| `serving_size` | REAL | Default serving in grams (e.g., 15 for a 15g bar) |
| `serving_unit` | TEXT | 'g' or 'ml' — **determines if macros are per-100g or per-100ml** |
| `calories` | REAL | Calories per 100g |
| `protein_g` | REAL | Protein per 100g |
| `fat_g` | REAL | Fat per 100g |
| `carbs_g` | REAL | Carbs per 100g |
| `fiber_g` | REAL | Fiber per 100g |
| `sugar_g` | REAL | Sugar per 100g |
| `saturated_fat_g` | REAL | Saturated fat per 100g |
| `sodium_mg` | REAL | Sodium per 100g |
| `usda_enriched` | INTEGER | 0 = not checked, 1 = USDA lookup done (skip re-check) |
| `usda_fdc_id` | INTEGER | USDA FoodData Central ID (set when USDA match found) |

### Converting Label Values to DB Values

**If a nutrition label shows per-serving values, convert to per-100g:**

```
db_value = label_value × (100 ÷ serving_size_grams)
```

**Example: Sweet William Choc Koala (15g serving)**
- Label: 130 cal, 0.2g protein, 7.8g fat, 14.4g carbs
- DB values (per 100g):
  - calories = 130 × (100/15) = 866.67
  - protein_g = 0.2 × (100/15) = 1.33
  - fat_g = 7.8 × (100/15) = 52.0
  - carbs_g = 14.4 × (100/15) = 96.0
  - serving_size = 15

### Insert Example

```sql
INSERT INTO foods (name, brand, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g, saturated_fat_g, sodium_mg, serving_size, serving_unit)
VALUES ('Rice Crackle Choc Koala', 'Sweet William', 866.67, 1.33, 52.0, 96.0, 8.0, 57.33, 47.33, 180.0, 15, 'g');
```

---

## Table: `meals`

Stores meal metadata.

### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `meal_type` | TEXT | **Must be**: 'breakfast', 'lunch', 'dinner', or 'snack' |
| `meal_time` | DATETIME | **Format**: 'YYYY-MM-DD HH:MM:SS' |
| `title` | TEXT | Creative meal name for display |
| `notes` | TEXT | Optional description |
| `photo_url` | TEXT | Optional photo path |

### Insert Example

```sql
INSERT INTO meals (meal_type, meal_time, title)
VALUES ('snack', '2026-01-31 23:00:00', 'Choc Koala 🐨');
```

---

## Table: `meal_items`

Links meals to foods with quantities.

### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `meal_id` | INTEGER | FK to meals.id |
| `food_id` | INTEGER | FK to foods.id |
| `amount` | REAL | **MULTIPLIER of 100g** (0.15 = 15g, 1.5 = 150g) |
| `actual_grams` | REAL | Actual grams consumed (for reference/fallback) |
| `quantity` | REAL | Number of servings (default 1) |
| `unit` | TEXT | Unit description (optional) |
| `notes` | TEXT | Item-specific notes |

### ⚠️ CRITICAL: Calculating `amount`

**amount = grams_consumed ÷ 100**

| Consumed | amount value |
|----------|--------------|
| 15g | 0.15 |
| 50g | 0.50 |
| 100g | 1.00 |
| 150g | 1.50 |
| 200g | 2.00 |

### Server-Side Calculation

**Simple:** The server uses `amount` directly as the multiplier:

```sql
f.calories * mi.amount
```

**`amount` is the authoritative value.** Always set it correctly:
- `amount` = grams ÷ 100 (the multiplier)
- `actual_grams` = actual grams (for reference/validation only)

### Calorie Calculation

```
actual_calories = food.calories × multiplier
```

Where multiplier = amount (if actual_grams is NULL) OR actual_grams/100 (if > 10)

Example: Choc Koala (866.67 cal/100g) × 0.15 = 130 cal ✓

### Insert Example

```sql
-- For 15g of a food:
INSERT INTO meal_items (meal_id, food_id, amount, actual_grams, quantity)
VALUES (127, 255, 0.15, 15, 1);
```

### ⚠️ Common Mistakes

| Mistake | Result | Correct |
|---------|--------|---------|
| `amount = 15` (for 15g) | 1500g logged! | `amount = 0.15` |
| `amount = 1, actual_grams = NULL` | 100g assumed | Set `actual_grams` too |
| Forgetting to convert label→DB | Wrong base values | Always × (100/serving) |

---

## Complete Meal Logging Flow

### Step 1: Check if food exists

```sql
SELECT id, name, calories, serving_size FROM foods 
WHERE name LIKE '%search_term%' OR brand LIKE '%search_term%';
```

### Step 2: Create food if needed (convert to per-100g!)

```sql
INSERT INTO foods (name, brand, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g, serving_size, serving_unit)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'g')
RETURNING id;
```

### Step 3: Create meal

```sql
INSERT INTO meals (meal_type, meal_time, title)
VALUES (?, ?, ?)
RETURNING id;
```

### Step 4: Create meal_item(s)

```sql
INSERT INTO meal_items (meal_id, food_id, amount, actual_grams, quantity)
VALUES (?, ?, grams/100.0, grams, 1);
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  LOGOS DB CHEAT SHEET                                       │
├─────────────────────────────────────────────────────────────┤
│  foods.calories     = per 100g OR per 100ml                 │
│  foods.serving_unit = 'g' or 'ml' (determines which!)       │
│  foods.protein_g    = column has _g suffix                  │
│  foods.serving_size = default serving in g or ml            │
│                                                             │
│  meals.meal_time    = 'YYYY-MM-DD HH:MM:SS' (DATETIME)      │
│  meals.meal_type    = breakfast|lunch|dinner|snack          │
│                                                             │
│  meal_items.amount  = quantity ÷ 100 (0.15 = 15g or 15ml)   │
│  meal_items.actual_grams = actual quantity consumed         │
├─────────────────────────────────────────────────────────────┤
│  SOLIDS (serving_unit = 'g'):                               │
│    15g snack → amount = 0.15                                │
│    150g chicken → amount = 1.5                              │
│    Label 130cal/15g → DB 866.67cal/100g                     │
│                                                             │
│  LIQUIDS (serving_unit = 'ml'):                             │
│    15ml oil → amount = 0.15                                 │
│    250ml milk → amount = 2.5                                │
│    1 tbsp = 15ml → amount = 0.15                            │
│                                                             │
│  CONVERSIONS:                                               │
│    1 tbsp = 15ml    1 tsp = 5ml    1 cup = 250ml            │
│    Oil: 1ml = 0.92g    Honey: 1ml = 1.42g                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Validation Queries

### Check a logged meal's actual calories

```sql
SELECT 
    m.title,
    f.name,
    f.calories as cal_per_100g,
    mi.amount,
    mi.actual_grams,
    ROUND(f.calories * mi.amount, 1) as actual_calories
FROM meals m
JOIN meal_items mi ON m.id = mi.meal_id
JOIN foods f ON mi.food_id = f.id
WHERE m.id = ?;
```

### Verify amount matches actual_grams

```sql
SELECT * FROM meal_items
WHERE ABS(amount - actual_grams/100.0) > 0.01;
```

---

## Table: `unit_weights`

Deterministic unit-to-gram conversion reference. Populated from USDA portion data and pipeline estimates.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `food_id` | INTEGER | FK to foods.id |
| `unit` | TEXT | 'cup', 'tbsp', 'large', 'slice', 'piece', etc. |
| `grams` | REAL | 1 unit = X grams |
| `source` | TEXT | 'usda', 'manual', 'llm_estimate' |

Unique constraint on (food_id, unit).

---

## Table: `decision_log`

Audit trail for every pipeline and agent decision.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `entity_type` | TEXT | 'meal', 'meal_item', 'food', 'input', 'request', 'system' |
| `entity_id` | INTEGER | ID of the entity being decided on |
| `agent` | TEXT | 'logos', 'diqq', 'hayden', 'pigeon', 'router', 'pipeline' |
| `action` | TEXT | 'parse', 'match_food', 'convert_unit', 'validate', 'audit', 'chase', 'anomaly_scan' |
| `details` | TEXT | JSON blob with action-specific reasoning |
| `model_used` | TEXT | 'deterministic', 'haiku', 'sonnet', null |
| `confidence_pct` | REAL | 0.0 - 1.0 |

---

## Table: `known_decompositions`

Cached composite meal breakdowns (e.g., "chicken salad" → chicken + lettuce + dressing).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `meal_name` | TEXT | Composite meal name (unique) |
| `ingredients` | TEXT | JSON array of {food_name, default_quantity, default_unit} |
| `source` | TEXT | 'manual', 'llm', 'verified' |

---

## Table: `pipeline_requests`

Logs every `pipeline.process()` call for tracking and follow-up.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `raw_input` | TEXT | Exactly what the user typed |
| `intent` | TEXT | 'log', 'correction', 'advice', 'query', 'system' |
| `status` | TEXT | 'pending' → 'confirmed' → 'committed' \| 'abandoned' \| 'expired' |
| `meal_id` | INTEGER | FK to meals.id (set on commit) |
| `result_summary` | TEXT | JSON: {items, totals, confidence} |
| `incomplete_reason` | TEXT | Why unresolved (e.g., unmatched foods) |
| `confidence_pct` | REAL | Overall pipeline confidence |
| `followup_count` | INTEGER | How many times HAYDEN has pinged about this |
| `last_followup_at` | DATETIME | When last followed up |
| `confirmed_at` | DATETIME | When user confirmed |
| `committed_at` | DATETIME | When commit() wrote to meals |

---

## Table: `food_history`

Append-only mutation log for the `foods` table. Populated automatically by SQLite triggers on UPDATE and DELETE — no application code needed. This is the "refinery" audit trail: nothing disappears.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `food_id` | INTEGER | The food that was modified |
| `operation` | TEXT | 'update' or 'delete' |
| `old_values` | TEXT | JSON snapshot of previous state (key nutritional + metadata fields) |
| `new_values` | TEXT | JSON snapshot of new state (NULL for deletes) |
| `created_at` | DATETIME | When the mutation happened |

### Tracked Fields in Snapshots

name, brand, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g, sodium_mg, potassium_mg, calcium_mg, iron_mg, serving_size, serving_unit, confidence_pct, data_source, usda_enriched, usda_fdc_id

### Triggers

- `trg_food_history_update` — fires on UPDATE when any tracked field changes (ignores `updated_at`-only bumps)
- `trg_food_history_delete` — fires on DELETE (captures full snapshot before removal)

### Query Examples

```sql
-- Full history for a specific food
SELECT * FROM food_history WHERE food_id = ? ORDER BY created_at;

-- All changes in the last 24 hours
SELECT fh.*, f.name FROM food_history fh
LEFT JOIN foods f ON fh.food_id = f.id
WHERE fh.created_at >= datetime('now', '-1 day')
ORDER BY fh.created_at DESC;

-- Find when a food's calories changed
SELECT id, food_id,
  json_extract(old_values, '$.calories') as old_cal,
  json_extract(new_values, '$.calories') as new_cal,
  created_at
FROM food_history
WHERE food_id = ? AND json_extract(old_values, '$.calories') != json_extract(new_values, '$.calories');
```

---

## Table: `agent_reports`

Communication channel from background agents to the personal assistant. Background agents (HAYDEN, DIQQ, RICKY) write reports here; the PA scan cron reads and processes them.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `agent` | TEXT | 'hayden', 'diqq', 'ricky', 'gera', 'zeus' |
| `severity` | TEXT | 'critical', 'high', 'medium', 'low', 'info' |
| `category` | TEXT | 'health', 'data_quality', 'learning', 'anomaly', 'preference' |
| `summary` | TEXT | One-line summary for PA |
| `details` | TEXT | JSON blob for structured data |
| `for_human` | INTEGER | 1 = needs human decision, 0 = PA can handle |
| `created_at` | DATETIME | When report was created |
| `acknowledged_at` | DATETIME | When PA processed it (NULL = pending) |
| `resolution` | TEXT | What PA did with it |

### Indexes

- `idx_agent_reports_pending` — partial index on unacknowledged reports
- `idx_agent_reports_agent` — filter by agent
- `idx_agent_reports_severity` — filter by severity

### Query Examples

```sql
-- Pending reports (PA scan reads these)
SELECT * FROM agent_reports WHERE acknowledged_at IS NULL
ORDER BY CASE severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
END, created_at ASC;

-- Acknowledge a report
UPDATE agent_reports
SET acknowledged_at = datetime('now'), resolution = 'logged_for_briefing'
WHERE id = ?;

-- Reports from last 7 days
SELECT * FROM agent_reports
WHERE created_at > datetime('now', '-7 days')
ORDER BY created_at DESC;
```
