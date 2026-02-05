# FUEL Modes Architecture

## Current State

FUEL has two hardcoded modes:
- **Simple** — flat TDEE targets, balanced macros
- **Carb Cycling** — 6-phase dynamic targets

But the system should be extensible for advanced data sources.

## Vision: Modular Modes

Each "mode" is an **input modifier** that adjusts daily targets based on external data:

```
Base TDEE ──→ [ Mode Stack ] ──→ Final Daily Targets
              ┌─────────────┐
              │ Carb Cycling │  Phase-based multipliers
              │ Wearable     │  Activity-adjusted TDEE  
              │ CGM          │  Glucose-reactive carbs
              │ Ketone       │  Keto depth validation
              │ Workout      │  Training day vs rest day
              └─────────────┘
```

### Mode Types

| Mode | Input | Effect on Targets |
|------|-------|-------------------|
| **Carb Cycling** | Cycle day (from start date) | Multiplies calories, shifts carb/fat ratio per phase |
| **Wearable Sync** | Steps, HRV, sleep, recovery | Adjusts activity multiplier dynamically |
| **CGM (Glucose)** | Real-time blood glucose | Reduces carbs when glucose is high, increases when low |
| **Ketone Monitor** | Blood/breath ketone level | Validates keto phase depth, adjusts carb ceiling |
| **Workout Sync** | Training type, duration, intensity | Adds training calories on workout days, removes on rest |
| **Sleep Mode** | Sleep quality/duration | Reduces targets on poor sleep days |

### How Modes Stack

Modes are **composable** — you can enable multiple:

1. **Base**: TDEE from body stats (always on)
2. **Cycle layer** (optional): Adjusts base by phase multiplier
3. **Activity layer** (optional): Overrides activity multiplier from wearable
4. **Glucose layer** (optional): Clamps carbs based on CGM reading
5. **Training layer** (optional): Adds/removes training calories based on actual workout

Example: Carb Cycling + Wearable + CGM
- Day 15, Keto phase → base says 40g carbs
- Garmin says 12,000 steps → activity mult bumps from 1.2 to 1.35
- CGM says glucose 5.2 mmol → no adjustment (normal range)
- Final: higher calories (more active), still 40g carbs (keto + glucose OK)

### Database Schema

```sql
-- Modes enabled per user
CREATE TABLE IF NOT EXISTS user_modes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode_name TEXT NOT NULL UNIQUE,   -- 'carb_cycling', 'wearable', 'cgm', 'ketone', 'workout'
    enabled INTEGER DEFAULT 0,
    config TEXT,                       -- JSON config specific to this mode
    priority INTEGER DEFAULT 0,       -- Stacking order
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- External data points (from any source)
CREATE TABLE IF NOT EXISTS mode_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode_name TEXT NOT NULL,
    data_type TEXT NOT NULL,           -- 'glucose', 'ketone', 'steps', 'hrv', 'sleep_score', 'workout'
    value REAL NOT NULL,
    unit TEXT,                         -- 'mmol/L', 'mg/dL', 'steps', 'ms', 'minutes'
    recorded_at DATETIME NOT NULL,
    source TEXT,                       -- 'dexcom', 'libre', 'garmin', 'oura', 'whoop', 'manual'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Settings UI Pattern

```
⚙️ Settings
  👤 Body
  🏃 Activity & Goals
  
  🔌 Modes
    🔄 Fuel Cycling          [toggle] [?]
       → Cycle config (when on)
    ⌚ Wearable Sync          [toggle] [?]  
       → Connect device (when on)
    📈 Glucose Monitor        [toggle] [?]
       → CGM config (when on)
    🧪 Ketone Monitor         [toggle] [?]
       → Device config (when on)
    💪 Workout Sync           [toggle] [?]
       → Source config (when on)
  
  📊 Calculated Daily Targets
```

### Server Architecture

```javascript
// Each mode is a function that takes base targets and returns modified targets
const modes = {
  carb_cycling: (baseTargets, settings, date) => { /* current algorithm */ },
  wearable:     (baseTargets, settings, date) => { /* adjust activity from wearable */ },
  cgm:          (baseTargets, settings, date) => { /* clamp carbs from glucose */ },
  ketone:       (baseTargets, settings, date) => { /* validate keto depth */ },
  workout:      (baseTargets, settings, date) => { /* add/remove training cal */ },
};

function getDailyTargets(settings, date) {
  let targets = getBaseTargets(settings);  // TDEE + balanced macros
  
  const enabledModes = getEnabledModes(settings);
  for (const mode of enabledModes) {
    targets = modes[mode.name](targets, mode.config, date);
  }
  
  return targets;
}
```

### API for External Data

```
POST /api/modes/data
{
  "mode": "cgm",
  "type": "glucose",
  "value": 5.8,
  "unit": "mmol/L",
  "recorded_at": "2026-02-04T21:30:00",
  "source": "libre"
}

GET /api/modes/data?mode=cgm&date=2026-02-04
→ All glucose readings for the day

GET /api/modes
→ List all modes with enabled status

PUT /api/modes/carb_cycling
{ "enabled": true, "config": { "cycle_length": 28, ... } }
```

### Wearable Integration Options

| Platform | Data Available | Integration |
|----------|---------------|-------------|
| **Garmin** | Steps, HR, HRV, sleep, workouts, calories | Garmin Connect API or Health API |
| **Oura** | Sleep, HRV, readiness, activity | Oura Cloud API |
| **Whoop** | Strain, recovery, sleep, HRV | WHOOP API |
| **Apple Health** | Everything | HealthKit (needs iOS app) |
| **Terra API** | Unified wrapper for 200+ devices | Single integration, many sources |
| **Fitbit** | Steps, HR, sleep, workouts | Web API |

**Recommendation:** Start with **Terra API** — single integration covers Garmin, Oura, Whoop, Fitbit, Apple Health, Samsung, etc.

### CGM Integration Options

| Device | Data | Integration |
|--------|------|-------------|
| **Dexcom** | 5-min glucose readings | Dexcom Share API |
| **FreeStyle Libre** | 1-min glucose + scans | LibreLink Up API |
| **Levels** | Glucose + metabolic score | Levels API |

### Phase 1 (Now)
- [x] Carb cycling toggle
- [ ] Refactor carb cycling into mode function
- [ ] Create `user_modes` table
- [ ] Move cycling config from `user_settings` to `user_modes.config`

### Phase 2 (Workout Sync)
- [ ] Manual workout logging (type, duration, intensity)
- [ ] Auto-detect rest day vs training day
- [ ] Adjust training_cal dynamically

### Phase 3 (Wearable)
- [ ] Terra API integration
- [ ] Auto-adjust activity multiplier from actual steps/activity
- [ ] Sleep-based target adjustment

### Phase 4 (CGM/Ketone)
- [ ] Dexcom or Libre integration
- [ ] Real-time carb ceiling based on glucose
- [ ] Keto validation from ketone readings
