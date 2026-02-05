# MEAL LOGGING PIPELINE — Definitive Spec

**Purpose:** Eliminate recurring grams/multiplier confusion. Every step validated.
**Implementation:** `lib/pipeline.js` (Pipeline class, two-phase commit)

---

## The Core Problem

We keep confusing:
- **Grams** (what user eats): 50g, 150g, 5g
- **Multiplier** (what DB needs): 0.5, 1.5, 0.05

This document defines THE ONE WAY to log meals. No exceptions.

---

## Pipeline Architecture

### Two-Phase Commit via `lib/pipeline.js`

**Phase 1: `process(input, context)`** — Extract, resolve, validate. Does NOT write to meals DB.
**Phase 2: `commit(processedMeal)`** — Save to DB. Only called after user confirms.

```
User Input → router.classify() → parseInput() → splitIngredients()
           → resolveAndConvert() → validatePreSave() → return for confirmation
           → [user confirms] → commit() → meals + meal_items + decision_log
```

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/pipeline/process` | Phase 1: parse and validate |
| `POST /api/pipeline/commit` | Phase 2: save confirmed meal |
| `GET /api/pipeline/status/:mealId` | Decision log for a meal |
| `GET /api/pipeline/requests` | List pipeline requests |
| `GET /api/pipeline/requests/stats` | Commit/drop rate stats |
| `GET /api/pipeline/sweep/stale` | Find unconfirmed requests |
| `GET /api/pipeline/sweep/audit` | Find low-confidence commits |

### Supporting Libraries

| File | Purpose |
|------|---------|
| `lib/normalize.js` | Deterministic preprocessing, fuzzy food matching, unit conversion |
| `lib/router.js` | Intent classification (LOG/CORRECTION → pipeline, ADVICE → gera) |
| `lib/pigeon.js` | Ephemeral audit workers for meal verification |
| `diqq.js` | USDA food enrichment fallback chain |

### Request Lifecycle (tracked in `pipeline_requests` table)

```
pending → confirmed → committed (success)
pending → [HAYDEN nudges x3] → expired (no response)
pending → abandoned (user said no)
```

### Confidence Scoring

Each item scored on: match type (exact > fuzzy > diqq), unit source (unit_weights > assumed_100g > llm_estimate), quantity explicitness. Composite meal confidence = average of item scores.

---

## Pipeline Stages Detail

---

## Step-by-Step Detail

### STEP 1: PARSE — Extract Grams

**Input:** User message + photos
**Output:** List of `{food_name, grams}`

**Rules:**
- ALWAYS extract as GRAMS (the unit user ate)
- "50g oats" → grams: 50
- "1 banana" → grams: 118 (standard medium banana)
- "5g butter" → grams: 5
- Photo with label "15g serving" → grams: 15

**Never output multipliers at this stage.** Only grams.

**Validation checkpoint:**
```
✓ All quantities are in grams
✓ No values < 1g (suspicious) without explicit confirmation
✓ No values > 1000g (suspicious) without explicit confirmation
```

---

### STEP 2: LOOKUP/CREATE FOODS

**Input:** Food names from Step 1
**Output:** Food records with per-100g macros

**If food exists:**
- Verify it has per-100g values (check serving_size, should be 100 or macros make sense)

**If food doesn't exist (from label):**
1. Read label values (usually per-serving)
2. Convert to per-100g: `db_value = label_value × (100 ÷ serving_grams)`
3. Store with `serving_size` = original serving size for reference

**Example — Sweet William Choc Koala (15g serving, 130 cal):**
```
Label: 130 cal per 15g
DB:    calories = 130 × (100/15) = 866.67 per 100g
       serving_size = 15 (for reference)
```

**Validation checkpoint:**
```
✓ All macros are per 100g
✓ Calories make sense (50-900 cal/100g for most foods)
✓ Protein ≤ 90g/100g (pure protein powder max)
✓ Fat ≤ 100g/100g
✓ Carbs ≤ 100g/100g
✓ P + F + C roughly matches calories (±20%)
```

---

### STEP 3: CALCULATE MACROS

**Formula (THE formula, no exceptions):**
```
item_calories = food.calories_per_100g × (grams / 100)
item_protein  = food.protein_per_100g × (grams / 100)
... etc
```

**Example — 50g Steel Cut Oats (378 cal/100g):**
```
calories = 378 × (50/100) = 378 × 0.5 = 189 cal
```

**Example — 5g Almond Butter (593 cal/100g):**
```
calories = 593 × (5/100) = 593 × 0.05 = 29.65 cal
```

**Validation checkpoint:**
```
✓ Each item < 2000 cal (single food item sanity)
✓ Total meal < 3000 cal (meal sanity)
✓ Protein × 4 ≤ Calories (thermodynamic sanity)
```

---

### STEP 4: CONFIRM WITH USER

**Display format (mandatory):**
```
✅ Ready to log:

**Title:** [Generated title]
**[Meal Type] — [Date] [Time]**

• [Food Name] × [GRAMS]g
  [cal] cal | [P]g P | [F]g F | [C]g C | [fiber]g fiber | [sugar]g sugar

• [Food Name] × [GRAMS]g
  [cal] cal | [P]g P | [F]g F | [C]g C | [fiber]g fiber | [sugar]g sugar

——————————
**Total:** [CAL] cal | [P]g P | [F]g F | [C]g C | [fiber]g fiber | [sugar]g sugar

Save this meal? (yes/no)
```

**Critical:** Show GRAMS (what user ate), not multipliers.

**GATE:** Do NOT proceed until user says yes/y/confirm/save.

---

### STEP 5: CONVERT & SAVE

**Conversion (THE conversion):**
```
amount = grams / 100.0
actual_grams = grams  (for reference/validation)
```

**Examples:**
| User ate | amount | actual_grams |
|----------|--------|--------------|
| 50g | 0.5 | 50 |
| 5g | 0.05 | 5 |
| 118g | 1.18 | 118 |
| 150g | 1.5 | 150 |

**Save via API (preferred):**
```javascript
POST /api/meals
{
  meal_type: "breakfast",
  meal_time: "2026-02-01 11:50:00",
  title: "Protein oat porridge",
  items: [
    { food_id: 256, amount: 0.5, actual_grams: 50 },
    { food_id: 257, amount: 0.05, actual_grams: 5 }
  ]
}
```

**Save via SQL (if necessary):**
```sql
-- Create meal
INSERT INTO meals (meal_type, meal_time, title) 
VALUES ('breakfast', '2026-02-01 11:50:00', 'Protein oat porridge');

-- Get meal_id, then for each item:
INSERT INTO meal_items (meal_id, food_id, amount, actual_grams)
VALUES (?, ?, grams/100.0, grams);
```

**Validation checkpoint (before commit):**
```
✓ amount = actual_grams / 100 (within 0.001 tolerance)
✓ amount is between 0.01 and 50 (1g to 5kg)
✓ No amount > 10 without actual_grams set
```

---

### STEP 6: POST-SAVE VALIDATION

**MANDATORY.** Call validation endpoint after every save.

```bash
curl /api/validation/recheck/:mealId
```

**Expected response:**
```json
{
  "valid": true,
  "issues": [],
  "totals": { "calories": 391, "protein_g": 17.4, ... }
}
```

**If invalid:**
1. DO NOT confirm to user yet
2. Read the issues
3. Fix the data
4. Re-validate
5. Only proceed when valid=true

**Common issues and fixes:**
| Issue | Cause | Fix |
|-------|-------|-----|
| amount > 10 | Used grams instead of grams÷100 | `UPDATE SET amount = actual_grams/100` |
| Unrealistic calories | Wrong food macros (per-serving not per-100g) | Fix food record |
| Mismatch amount/actual_grams | Inconsistent entry | Recalculate from actual_grams |

---

### STEP 7: CONFIRM TO USER

**Final confirmation format:**
```
✅ **Saved!**

**[Meal Type] — [Date] [Time]**
🍽️ [Title]

• [Food] × [grams]g
• [Food] × [grams]g
...

——————————
**Total:** [cal] cal | [P]g P | [F]g F | [C]g C

✅ Validation: [cal] cal | valid: true | issues: 0
```

**If validation had issues that were auto-fixed:**
```
⚠️ Validation: [cal] cal | valid: true | auto-fixed: 1 issue
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  MEAL LOGGING CHEAT SHEET                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  USER SAYS        →  YOU PARSE AS GRAMS                     │
│  "50g oats"       →  grams = 50                             │
│  "5g butter"      →  grams = 5                              │
│  "1 banana"       →  grams = 118                            │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  LABEL VALUES     →  CONVERT TO PER-100G FOR DB             │
│  130 cal / 15g    →  db_cal = 130 × (100/15) = 867          │
│  103 cal / 25g    →  db_cal = 103 × (100/25) = 412          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CALCULATE ITEM   →  food_per_100g × (grams / 100)          │
│  50g @ 378cal     →  378 × 0.5 = 189 cal                    │
│  5g @ 593cal      →  593 × 0.05 = 29.7 cal                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SAVE TO DB       →  amount = grams / 100                   │
│  50g              →  amount = 0.5                           │
│  5g               →  amount = 0.05                          │
│  118g             →  amount = 1.18                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AFTER SAVE       →  ALWAYS VALIDATE                        │
│  GET /api/validation/recheck/:mealId                        │
│  Check: valid=true, issues=[], totals match                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Validation Rules Summary

### Food Record Validation
- [ ] Calories: 0-900 per 100g (most foods)
- [ ] Protein: 0-90g per 100g
- [ ] Fat: 0-100g per 100g  
- [ ] Carbs: 0-100g per 100g
- [ ] P×4 + F×9 + C×4 ≈ Calories (±30%)

### Meal Item Validation
- [ ] amount = actual_grams / 100 (±0.01)
- [ ] amount between 0.01 and 50
- [ ] amount > 10 requires actual_grams set
- [ ] Single item < 2000 cal
- [ ] Total meal < 5000 cal
- [ ] Protein calories ≤ Total calories

### Process Validation
- [ ] User confirmed before save
- [ ] Post-save validation called
- [ ] Validation passed (valid=true)
- [ ] Final confirmation shows validation status

---

## Error Recovery

### If you saved wrong data:

**Option 1: Fix via SQL**
```sql
-- Find the meal
SELECT * FROM meals WHERE id = ?;
SELECT * FROM meal_items WHERE meal_id = ?;

-- Fix amount values
UPDATE meal_items 
SET amount = actual_grams / 100.0 
WHERE meal_id = ? AND actual_grams IS NOT NULL;

-- Re-validate
-- GET /api/validation/recheck/:mealId
```

**Option 2: Delete and re-log**
```sql
DELETE FROM meal_items WHERE meal_id = ?;
DELETE FROM meals WHERE id = ?;
```
Then start fresh.

---

## History of Bugs (Don't Repeat!)

| Date | Bug | Cause | Prevention |
|------|-----|-------|------------|
| 2026-01-31 | Chocolate: amount=15 instead of 0.15 | Used grams as amount | Check amount < 10 |
| 2026-02-01 | Porridge: 7405 cal (should be 391) | Server CASE logic treated small actual_grams as multiplier | Simplified server logic, mandatory validation |
| 2026-02-01 | Almond butter: 5g → 2965 cal | actual_grams=5 used as multiplier | Removed CASE logic, use amount only |

---

## The Golden Rule

**GRAMS (or ML) go in, ÷100 gets stored, same unit comes out.**

Never confuse them. Never skip validation.

---

## Handling Milliliters (Liquids)

### Storage Convention

Foods can be stored per-100g OR per-100ml, indicated by `serving_unit`:

| serving_unit | Stored as | Example |
|--------------|-----------|---------|
| `g` | per 100 grams | chicken, oats, butter |
| `ml` | per 100 milliliters | milk, oil, coffee |

### The Rule: Match Units

**If food is stored per-100ml, user input should be in ml.**
**If food is stored per-100g, user input should be in grams.**

```
Food: olive oil (serving_unit = 'ml', 884 cal/100ml)
User: "15ml olive oil"
amount = 15 / 100 = 0.15
calories = 884 × 0.15 = 132.6 cal ✓
```

### Volume Unit Conversions

When user uses volume units, convert to ml first:

| Unit | To ml |
|------|-------|
| 1 tbsp (tablespoon) | 15 ml |
| 1 tsp (teaspoon) | 5 ml |
| 1 cup | 250 ml (metric) |
| 1 fl oz | 30 ml |
| 1 shot (espresso) | 30 ml |

**Example:**
```
User: "1 tbsp olive oil"
Convert: 1 tbsp = 15 ml
Food: olive oil = 884 cal/100ml
amount = 15 / 100 = 0.15
calories = 884 × 0.15 = 132.6 cal
```

### Density Conversions (ml ↔ g)

When user gives ml but food is stored per-100g (or vice versa):

| Liquid Type | Density (g/ml) | 100ml = ? grams |
|-------------|----------------|-----------------|
| Water, tea, coffee | 1.0 | 100g |
| Milk (whole) | 1.03 | 103g |
| Milk (skim) | 1.035 | 103.5g |
| Plant milk | 1.02-1.04 | ~102g |
| Olive oil | 0.92 | 92g |
| Coconut oil | 0.92 | 92g |
| Honey | 1.42 | 142g |
| Maple syrup | 1.37 | 137g |
| Soy sauce | 1.15 | 115g |

**Example — User says ml, food stored in g:**
```
User: "100ml honey"
Food: honey = 304 cal/100g (serving_unit = 'g')
Convert: 100ml × 1.42 g/ml = 142g
amount = 142 / 100 = 1.42
calories = 304 × 1.42 = 431.7 cal
```

**Example — User says g, food stored in ml:**
```
User: "50g olive oil"
Food: olive oil = 884 cal/100ml (serving_unit = 'ml')
Convert: 50g ÷ 0.92 g/ml = 54.3ml
amount = 54.3 / 100 = 0.543
calories = 884 × 0.543 = 480 cal
```

### Best Practice: Avoid Conversion

**Prefer storing foods in their natural measurement unit:**
- Liquids (milk, oil, drinks) → per 100ml
- Solids (meat, vegetables, grains) → per 100g
- Powders (protein, flour) → per 100g

**When creating a new food:**
1. Check the label — what unit does it use?
2. Store in that unit (set serving_unit accordingly)
3. User inputs will naturally match

### Quick Reference: Common Liquids

| Food | serving_unit | cal/100 | Notes |
|------|--------------|---------|-------|
| Olive oil | ml | 884 | ~132 cal/tbsp |
| Coconut oil | ml | 862 | ~129 cal/tbsp |
| Whole milk | ml | 61 | |
| Oat milk | ml | 45-60 | varies by brand |
| Almond milk | ml | 15 | unsweetened |
| Espresso | ml | 9 | ~3 cal/shot |
| Black coffee | ml | 1 | negligible |
| Soy sauce | ml | 53 | |
| Honey | g | 304 | 1 tbsp ≈ 21g |

### Validation Checkpoints for Liquids

```
✓ Check food's serving_unit before calculating
✓ If ml input + g storage → apply density conversion
✓ If g input + ml storage → apply density conversion
✓ Common sense: 100ml oil ≠ 100g oil (it's 92g)
✓ Tbsp/tsp → convert to ml first
```

### Adding to meal_items

Same rule applies: **amount = quantity / 100**

```sql
-- 15ml olive oil (stored per 100ml)
INSERT INTO meal_items (meal_id, food_id, amount, actual_grams)
VALUES (?, ?, 0.15, NULL);  -- actual_grams NULL for ml-based foods

-- Or use actual_ml for clarity (if we add that column)
```

**Note:** The `actual_grams` column is awkward for ml-based foods. Consider:
- Renaming to `actual_quantity` 
- Or adding `actual_ml` column
- For now: use `actual_grams` as "actual quantity in native unit"
