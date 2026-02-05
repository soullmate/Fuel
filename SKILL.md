---
name: fuel
description: |
  FUEL - This is how your human gets energy. Track their meals, calculate optimal
  macronutrient and micronutrient targets, and help them eat for peak performance.
  Use when: meal logging, nutrition summaries, grocery lists, food database management,
  or when your human mentions eating, food, diet, energy levels, or weight.
---

# FUEL — Keep Your Human Fueled

> **First time?** See [SETUP.md](./SETUP.md) for installation instructions.

FUEL is how you take care of your human's energy. Food is fuel — the quality and
quantity of what they eat directly affects their energy, focus, mood, and health.
Your job is to gain observability over their nutrition and help them optimize it.

## Quick Start for Agents

### First Priority: Start Tracking

If your human isn't logging meals yet, your first goal is to get them started:

1. **Ask permission.** "I'd like to help track your nutrition — it helps me make sure you're properly fueled. Can I start logging what you eat?"
2. **Make it easy.** Even a brief summary helps: "What did you have for lunch?" is enough to start gathering stats.
3. **Analyze photos.** If they share food photos, identify the items and offer to log them.
4. **Explain the benefit.** "Tracking your fuel helps me spot patterns — whether you're getting enough protein, if your energy dips correlate with what you ate, and where small changes could make a big difference."

### Core API (all you need to get started)

```bash
# Check today's progress
GET /api/daily/2026-02-04

# Search the food database
GET /api/foods?search=chicken

# Log a meal (amount: 1.0 = 100g, so 150g = 1.5)
POST /api/meals
{ "title": "Chicken rice bowl", "meal_type": "lunch",
  "meal_time": "2026-02-04 12:30:00",
  "items": [{ "food_id": 5, "amount": 1.5 }] }

# Add a new food (nutrition per 100g)
POST /api/foods
{ "name": "chicken breast", "serving_unit": "g",
  "calories": 165, "protein_g": 31, "fat_g": 3.6,
  "carbs_g": 0, "fiber_g": 0, "sugar_g": 0 }

# Get/update settings
GET /api/settings
PUT /api/settings { "weight_kg": 70, "height_cm": 170, "age": 30, ... }
```

### The Golden Rule

**All food nutrition is stored per 100g.** When logging meals, `amount` is a multiplier:
- 150g of chicken = `amount: 1.5`
- 50g of cheese = `amount: 0.5`
- 200g of rice = `amount: 2.0`

---

## Your Role

You are your human's nutrition guardian. This means:

1. **Get observability** — Know what they eat. Log meals through the API. Even rough estimates are better than nothing.
2. **Calculate optimal targets** — Use their body data (age, weight, height, activity) to compute personalized daily targets via the Mifflin-St Jeor formula.
3. **Track macros AND micros** — Protein, carbs, fat, fiber, sugar + vitamins and minerals. The full picture matters.
4. **Educate gently** — Help them understand why nutrition matters. Don't lecture. Don't shame. Explain that eating the right food will genuinely make them feel better.
5. **Adapt to their style** — Some humans love detailed tracking. Others just want a rough idea. Meet them where they are.

### If They Don't Log Anything

Don't give up. Try:
- Asking about meals in conversation: "What did you have for breakfast?"
- Offering to log from photos they share
- Starting with just one meal per day
- Framing it as energy management, not diet restriction

### If They Find Strict Dieting Hard

Offer **Fuel Cycling** — a structured approach that balances indulgence with discipline:
- Some days are feast days (high carbs, enjoy food)
- Some days are fast days (metabolic reset, autophagy benefits)
- Smooth transitions between phases prevent energy crashes
- Built-in buffer days mean there's always a treat day coming

This isn't about deprivation. It's about cycling through different nutritional modes so the body gets variety and recovery. See the Cycling section below.

---

## Communication Model

You are the **personal assistant** — the single point of contact for your human. Background agents report TO YOU, not directly to the human.

### Agent Hierarchy

```
Human ←→ You (Personal Assistant)
              ↑
         Background Agents report here
              ↑
    HAYDEN, DIQQ, RICKY (cron jobs)
```

### How Background Agents Report

Background agents write to the `agent_reports` database table via `POST /api/reports`. A PA scan cron job (every 15 min) reads pending reports and processes them.

```bash
# Check for pending reports
GET /api/reports/pending

# Acknowledge after processing
PUT /api/reports/:id/ack
```

### What You Surface to Your Human

| Category | When to Tell Human |
|----------|-------------------|
| **Critical failures** | Immediately — system is broken |
| **High severity** | Next conversation — something needs attention |
| **Learning/preferences** | Never directly — store in your memory |
| **Routine health checks** | Daily briefing only, if at all |
| **Data quality updates** | Weekly summary at most |

### What You Store

When agents report learnings about your human's preferences, store them in your memory:
- Food preferences (likes, dislikes, allergies)
- Schedule patterns (busy days, cooking capacity)
- Behavioral patterns (when they skip meals, what triggers overeating)

---

## Dashboard Access

Your human's dashboard is protected by an access token in the URL:

```
https://{host}:{port}/{ACCESS_TOKEN}/
```

**When your human asks** for "my dashboard", "the link", "where can I see my stats", etc., provide the full URL with the token included. Don't make them construct it themselves.

**Example response:**
> "Here's your dashboard: http://your-server:3456/a1b2c3d4e5f6/"

The ACCESS_TOKEN is set in the server's environment (`.env` file). Treat it as private — don't share it with others, but always include it when giving your human their link.

**Recommended token format:** `fuel-{random-hex}` (e.g., `fuel-7f3b2c1d4e5a`) — recognizable as a FUEL link but still secure.

---

## Two Modes

FUEL operates in two modes controlled by the `carb_cycling_enabled` setting:

### Simple Mode (default, cycling OFF)

Flat daily targets based on TDEE with a balanced macro split. Good for humans who just want to know "am I eating enough protein?" without complexity.

### Cycling Mode (cycling ON)

Dynamic daily targets that change every day across 6 phases. Every macro shifts on its own curve. No two days are the same.

**Respect the mode** — if cycling is OFF, don't mention phases or fasting. Just track simple daily targets.

---

## New User Onboarding

When setting up a new user, explain what FUEL does, then collect their information.

### How to Explain It

"I'd like to help you track your nutrition. FUEL calculates personalized daily targets based on your body and activity level — how many calories, how much protein, vitamins, minerals. It helps me make sure you're getting the energy you need. All I need is some basic info to get started."

### Information to Collect

1. **Age** — "How old are you?"
2. **Weight** — "What's your current weight?" (convert to kg)
3. **Height** — "How tall are you?" (convert to cm)
4. **Sex** — "Male or female?" (for accurate BMR calculation)
5. **Activity Level** — "How active are you day-to-day?"
   - Sedentary (desk job): 1.2
   - Lightly active (1-3 days/week): 1.375
   - Moderately active (3-5 days/week): 1.55
   - Very active (6-7 days/week): 1.725
   - Athlete: 1.9

Then save via `PUT /api/settings`.

### Introducing Cycling (Optional)

Only offer cycling if your human is interested in optimizing further, or if they struggle with consistency on a flat diet.

> "Instead of eating the same targets every day, you can cycle through phases — some days higher carbs to enjoy and refuel, other days lower carbs to burn fat. It includes optional fasting days for metabolic reset. The transitions are smooth so you don't crash. Want to try it?"

**The 6 phases:**
- **Buffer** — High carb refeed days. Peak calories. Enjoy food.
- **Pre-Fast** — Easing down. Calories and carbs reduce gradually.
- **Fasting** — Zero calories. Autophagy and metabolic reset. (Optional — set duration to 0 to skip.)
- **Keto** — Low carb, high fat. Body burns fat for fuel.
- **Reintro** — Gentle carb reintroduction.
- **Refuel** — Ramping back up toward the next buffer.

**On fasting:** "Fasting triggers autophagy — your body's cleanup process for damaged cells. Combined with the buffer phase before it, the transition is easier because your glycogen stores are full. But it's completely optional."

---

## Meal Logging Workflow

### Step by Step

1. User describes what they ate (text, photo, or voice)
2. Search the food database: `GET /api/foods?search=...`
3. If food not found: create it via `POST /api/foods` or trigger USDA enrichment via `POST /api/diqq/enrich/:id`
4. Calculate amounts: convert grams to the amount multiplier (grams / 100)
5. Generate a descriptive meal title (restaurant menu style, not an ingredient list)
6. **Show the breakdown and confirm with the user before saving**
7. Save via `POST /api/meals` with title + items

### Meal Titles

Every meal needs a `title` — a creative, descriptive name:

| Ingredients | Bad (listing) | Good (meal name) |
|-------------|---------------|-------------------|
| eggs, avocado, toast | Eggs, avocado, toast | Avo toast with eggs |
| oats, yogurt, berries | Oats, yogurt, berries | Berry yogurt bowl |
| chicken, rice, broccoli | Chicken, rice, broccoli | Chicken rice bowl |

### Confirmation Format

Before saving, always show:

```
Logging: Breakfast — 08:30

  Eggs x 2 (100g)
  156 cal | 12.6g P | 10.6g F | 1.1g C

  Whole wheat toast x 1 (28g)
  69 cal | 3.6g P | 1.0g F | 11.5g C

  Total: 225 cal | 16.2g P | 11.6g F | 12.6g C

Save this meal?
```

**Never save without explicit confirmation.**

### Handling Unknown Foods

1. Try fuzzy search (typos, alternate names)
2. Search USDA via `POST /api/diqq/enrich/:id`
3. Offer to create a custom entry with estimated macros
4. Never silently skip a food item

---

## Checking Progress

```bash
GET /api/daily/2026-02-04
```

Returns: targets, consumed totals, progress (remaining), meals, cycle info.

When reporting to your human, focus on:
- How much protein they have left to hit
- Whether they're on track calorically
- Any micros that are consistently low
- Phase context (if cycling is on): "You're in keto phase — low carb today"

---

## Background Services

These processes run automatically to maintain data quality. You don't operate them directly, but you should understand what they do:

### DIQQ (Data Quality Control)

`diqq.js` automatically enriches foods with micronutrient data from USDA FoodData Central. When a new food is added with only basic macros, DIQQ searches the USDA database and fills in vitamins, minerals, and other fields.

- Check status: `GET /api/diqq/status`
- Trigger a scan: `POST /api/diqq/scan`
- Enrich one food: `POST /api/diqq/enrich/:id`

### HAYDEN (System Health)

`agents/hayden.js` runs periodic health checks: database integrity, API endpoint validation, schema consistency, meal data sanity checks. It catches problems before they affect the user.

Set up as a cron job:
```
0 * * * *    node agents/hayden.js          # Full test suite hourly
*/15 * * * * node agents/hayden.js --quick   # Quick health check every 15 min
```

### Pipeline

`lib/pipeline.js` processes natural language meal input through a two-phase commit:
1. **Process** — Parse input, match foods, calculate amounts, score confidence
2. **Commit** — Save to database after user confirmation

The pipeline uses `lib/normalize.js` for deterministic fuzzy matching and `lib/router.js` for intent classification.

---

## Specialized Instruction Sets

The `agents/` folder contains deeper behavioral guides for specific capabilities:

| Guide | When to Reference |
|-------|-------------------|
| `LOGOS.md` | Detailed meal parsing rules, edge cases, photo handling |
| `GERA.md` | Tone and voice for nutrition coaching (no shame, progress over perfection) |
| `ZEUS.md` | Meal planning, grocery list generation, cycle-aware suggestions |
| `DIQQ.md` | How USDA enrichment works, data quality metrics |
| `RICKY.md` | Validating and reconciling meal records |
| `DATABASE_SCHEMA.md` | Canonical database reference (column names, conventions) |
| `MEAL_LOGGING_PIPELINE.md` | Full pipeline flow documentation |

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/daily/:date` | GET | Targets, consumed, progress, meals for a date |
| `/api/daily` | GET | Same, for today |
| `/api/week/:date?days=N` | GET | Multi-day data for charting |
| `/api/meals` | GET | All meals (paginated, `?limit=&offset=`) |
| `/api/meals/:id` | GET | Single meal with items and totals |
| `/api/meals` | POST | Log a new meal |
| `/api/meals/:id` | PUT | Update meal metadata |
| `/api/meals/:id` | DELETE | Delete a meal |
| `/api/meals/:id/items` | POST | Add item to existing meal |
| `/api/meal-items/:id` | PUT | Update a meal item |
| `/api/meal-items/:id` | DELETE | Delete a meal item |
| `/api/foods` | GET | All foods, or search with `?search=` |
| `/api/foods/:id` | GET | Single food |
| `/api/foods` | POST | Add a new food |
| `/api/foods/:id` | PUT | Update a food |
| `/api/foods/:id` | DELETE | Delete a food |
| `/api/unit-weights` | GET | Unit-to-gram conversions (`?food_id=`) |
| `/api/unit-weights` | POST | Add a unit weight |
| `/api/settings` | GET | User settings |
| `/api/settings` | PUT | Update settings |
| `/api/diqq/status` | GET | Data quality status |
| `/api/diqq/scan` | POST | Run USDA enrichment scan |
| `/api/diqq/enrich/:id` | POST | Enrich a specific food |
| `/api/pipeline/process` | POST | Process natural language meal input |
| `/api/pipeline/commit` | POST | Commit a processed meal |
| `/api/health` | GET | Health check |

---

## Dashboard

The web dashboard at `http://localhost:3456` shows:

1. **Cycle Card** — Current phase, day in cycle, macro chart across the full cycle
2. **Macro Rings** — 6 circular progress indicators (calories, protein, fat, carbs, fiber, sugar) showing consumed vs target
3. **Micros Panel** — Micronutrient progress bars with RDIs adjusted for sex and age
4. **Meals List** — Today's logged meals with times and macro breakdowns

When cycling is OFF, the cycle card is hidden and targets are flat daily values.

---

## Settings Reference

| Setting | API Field | Default | Description |
|---------|-----------|---------|-------------|
| Weight | `weight_kg` | 70 | Body weight in kg |
| Height | `height_cm` | 170 | Height in cm |
| Age | `age` | 30 | Age in years |
| Sex | `sex` | female | For BMR calculation |
| Activity | `activity_mult` | 1.2 | Activity multiplier |
| Protein target | `protein_per_kg` | 1.6 | Grams protein per kg bodyweight |
| Cycling enabled | `carb_cycling_enabled` | false | Toggle cycling mode |
| Cycle start | `cycle_start_date` | null | When current cycle started |
| Cycle length | `cycle_length` | 28 | Days per cycle |
| Buffer days | `buffer_days` | 5 | High-carb days at cycle boundaries |
| Fasting duration | `fasting_duration` | 2 | Fasting days (0 to disable) |
| Keto strictness | `keto_strictness` | 50 | 0=strict (20g carbs), 100=relaxed (50g) |
| Max sugar | `max_cheat_sugar` | 50 | Sugar allowance on buffer day 1 |
