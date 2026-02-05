# DIQQ — Data Integrity & Quality Query Queue

**Role:** Ensures nutritional data completeness. Enriches foods from USDA database.

**Named after:** "Dicky" - the data detective who checks everything is complete.

---

## Core Responsibility

DIQQ focuses on **data quality**, not system health (that's HAYDEN's job).

1. Identify foods with missing micronutrient data
2. Search USDA FoodData Central for matches
3. Enrich local food entries with complete nutrition
4. Flag foods that can't be auto-enriched
5. Report on database completeness

---

## Quality Metrics Tracked

| Metric | Description |
|--------|-------------|
| **Completeness Score** | % of nutrition fields populated |
| **USDA Match Rate** | % of foods successfully matched to USDA |
| **Orphan Foods** | Foods logged but never used in meals |
| **Duplicate Detection** | Similar food names that might be duplicates |

### Completeness Tiers

| Tier | Fields Required | Badge |
|------|-----------------|-------|
| **Basic** | calories, protein, fat, carbs | 🥉 |
| **Standard** | + fiber, sugar, sodium | 🥈 |
| **Complete** | + all vitamins & minerals | 🥇 |
| **Premium** | + amino acids, omega-3/6 | 💎 |

---

## USDA Integration

### Search Strategy
1. Exact name match
2. Fuzzy name match (Levenshtein distance)
3. Keyword extraction ("grilled chicken breast" → "chicken breast")
4. Brand search if brand field populated

### USDA FoodData Central
- API: `https://api.nal.usda.gov/fdc/v1/`
- Rate limit: 3600 requests/hour (1/second safe)
- Requires API key (free at fdc.nal.usda.gov)

---

## Enrichment Process

```
1. SELECT foods WHERE completeness_score < 0.8
2. For each food:
   a. Search USDA API
   b. If match found with >80% confidence:
      - Map USDA nutrients to our schema
      - UPDATE food with new values
      - Log enrichment
   c. If no match:
      - Flag for manual review
      - Add to manual_review_queue
3. Report summary
```

---

## DIQQ Scan Output

```
🔍 DIQQ Quality Scan — <Date today>

📊 Database Overview:
• Total foods: 156
• Completeness: 78% average
• USDA linked: 142 (91%)

🔄 This Scan:
• Scanned: 14 foods needing enrichment
• Enriched: 12 foods
• Failed: 2 foods (no USDA match)

⚠️ Manual Review Needed:
• "Grandma's Special Sauce" — custom recipe, no USDA equivalent
• "Local Bakery Sourdough" — brand not in database

📈 Improvement: 78% → 85% completeness
```

---

## Tools

| Endpoint | Purpose |
|----------|---------|
| `GET /api/diqq/status` | Overview of data quality |
| `POST /api/diqq/scan` | Run enrichment scan |
| `GET /api/diqq/queue` | Foods pending manual review |
| `POST /api/diqq/enrich/:id` | Manually trigger enrichment for one food |

---

## Integration with LOGOS

When LOGOS creates a new food:
1. LOGOS saves basic info (name, calories, macros)
2. LOGOS calls DIQQ: "enrich this food"
3. DIQQ searches USDA
4. If found: enriches with micros
5. If not found: queues for review, but doesn't block logging

---

## Cron Setup

### Add to crontab

```bash
crontab -e
```

Add this entry (adjust path as needed):

```cron
# DIQQ — Data quality scan (every 3 hours)
0 */3 * * * curl -s -X POST http://localhost:3456/api/diqq/scan >> /path/to/fuel-public/logs/diqq.log 2>&1
```

### Verify

```bash
# Trigger manual scan
curl -X POST http://localhost:3456/api/diqq/scan

# Check status
curl http://localhost:3456/api/diqq/status

# Check reports
curl http://localhost:3456/api/reports/pending?agent=diqq
```

---

## Reporting to Personal Assistant

After each scan, DIQQ reports results to the PA via `POST /api/reports`:

```json
{
  "agent": "diqq",
  "severity": "info",           // or "medium" if failures
  "category": "data_quality",
  "summary": "Enriched 12 foods",
  "details": {
    "total_scanned": 14,
    "enriched_count": 12,
    "failed_count": 2,
    "skipped_count": 0,
    "failed_foods": [
      { "name": "Grandma's Sauce", "reason": "no match" }
    ]
  },
  "for_human": 0                // 1 if failures need review
}
```

The PA decides whether to mention enrichment results to the human (typically only if there are failures needing manual review).

---

## Manual Review Queue

Foods that DIQQ can't auto-enrich go to the review queue:

```json
{
  "food_id": 45,
  "food_name": "Grandma's Special Sauce",
  "reason": "no_usda_match",
  "suggested_matches": [
    { "usda_id": 123456, "name": "Tomato pasta sauce", "confidence": 0.65 }
  ],
  "added_at": "2026-01-29T10:00:00Z"
}
```

User can:
- Accept a suggested match
- Enter nutrition manually
- Mark as "custom recipe" (skip USDA)

---

## Pipeline Integration

DIQQ is called by the pipeline (`lib/pipeline.js`) when a food can't be matched locally:

### Exported Functions (via `diqq.js`)

| Function | Purpose |
|----------|---------|
| `enrichFood(db, food)` | Full fallback chain: USDA → Open Food Facts → local similar → Nutritionix |
| `matchFoodToDatabase(db, name)` | Fuzzy match food name against local DB |
| `createFoodFromUSDA(db, name)` | Create food entry from USDA FoodData Central |

### Pipeline Flow

1. `pipeline.process()` calls `normalize.fuzzyMatchFood()` first (deterministic)
2. If no local match: pipeline calls `diqq.enrichFood()` to create from USDA
3. If DIQQ finds it: food is created with `confidence_pct=0.7`, pipeline continues
4. If DIQQ can't find it: pipeline returns `incomplete: true` with unresolved foods
5. Decision logged to `decision_log` with `agent='diqq'`

### USDA Portion Import

DIQQ also populates the `unit_weights` table from USDA portion data, enabling deterministic unit-to-gram conversion for future lookups (e.g., "1 large egg = 50g").

---

## Voice

DIQQ is:
- **Thorough** — Checks everything
- **Non-blocking** — Never stops a log because data is incomplete
- **Informative** — Explains what's missing and why
- **Proactive** — Suggests improvements without being asked
