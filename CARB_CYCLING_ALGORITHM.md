# FUEL Carb Cycling Algorithm

## Overview

FUEL implements a **cycle-based nutrition system** that dynamically adjusts calorie and macro targets based on the user's current phase. The system creates smooth daily curves — no flat lines.

**Works for everyone:** Any cycle length (7, 14, 21, 28+ days). The principles of strategic carb manipulation, fasting, and keto phases benefit all users.

---

## Input Parameters

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `weight_kg` | number | 40-150 | Body weight in kilograms |
| `height_cm` | number | 140-220 | Height in centimeters |
| `age` | number | 18-80 | Age in years |
| `sex` | string | male/female | For BMR calculation |
| `activity_mult` | number | 1.1-1.9 | Activity multiplier |
| `cycle_length` | number | 7-60 | Total days in cycle |
| `buffer_days` | number | 0-14 | High-carb buffer days (split start/end) |
| `fasting_duration` | number | 0-7 | Number of fasting days |
| `keto_strictness` | number | 0-100 | 0 = strict (20g), 100 = relaxed (50g) |
| `cycle_start_date` | Date | - | Start date of current cycle |
| `protein_per_kg` | number | 1.2-2.2 | Protein target per kg bodyweight |
| `max_cheat_sugar` | number | 20-100 | Max sugar on buffer days |

---

## Metabolic Calculations

### Basal Metabolic Rate (BMR)

Using the **Mifflin-St Jeor Equation**:

```
Female: BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) - 161
Male:   BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) + 5
```

### Total Daily Energy Expenditure (TDEE)

```
TDEE = BMR × activity_mult
```

Activity multipliers:
- 1.1 = Sedentary
- 1.2 = Lightly active
- 1.375 = Moderately active
- 1.55 = Very active
- 1.9 = Athlete

---

## 6-Phase System

```
Buffer → Pre-Fast → Fasting → Keto → Reintro → Refuel → Buffer (repeat)
```

| Phase | Calories | Carbs | Description |
|-------|----------|-------|-------------|
| **Buffer** | 105-115% | Peak (~180g) | Indulgence days, high carbs |
| **Pre-Fast** | 60% | ~60g | Transition into fasting |
| **Fasting** | 0% | 0g | Complete fast |
| **Keto** | 50-95% | Floor→Roof | Low carb, high fat |
| **Reintro** | 90-95% | Gradual ↑ | Gentle carb return |
| **Refuel** | 95-105% | Building ↑ | Ramping toward buffer |

---

## Phase Boundaries

For a 28-day cycle with 4 buffer days and 2 fasting days:

| Phase | Days | Duration |
|-------|------|----------|
| Buffer (start) | 1-2 | 2 days |
| Pre-Fast | 3 | 1 day |
| Fasting | 4-5 | 2 days |
| Keto | 6-14 | 9 days |
| Reintro | 15-20 | 6 days |
| Refuel | 21-26 | 6 days |
| Buffer (end) | 27-28 | 2 days |

### Buffer Day Distribution

Buffer days split between cycle start and end. If odd number, extra day goes to end:

```
startBufferDays = floor(bufferDays / 2)
endBufferDays = ceil(bufferDays / 2)
```

---

## Keto Strictness

The `keto_strictness` parameter (0-100) determines the carb floor during keto:

```
ketoFloor = 20 + (keto_strictness / 100) × 30
ketoRoof = ketoFloor + 20
```

| keto_strictness | Label | Carb Floor |
|-----------------|-------|------------|
| 0-24 | Very Strict | 20-27g |
| 25-49 | Strict | 27-35g |
| 50-74 | Moderate | 35-42g |
| 75-100 | Relaxed | 42-50g |

---

## Macro Distribution

### Protein
- Fasting: 0g
- Pre-Fast: 70% of target
- All others: Full target (`weight_kg × protein_per_kg`)

### Carbs
- Fasting: 0g
- Pre-Fast: ~60g
- Keto: ketoFloor → ketoRoof (gradual increase)
- Buffer: Peak (~180g)
- Reintro/Refuel: Gradual increase between keto and buffer

### Fat
Calculated as remainder:
```
fat_g = (calories - protein_g×4 - carbs_g×4) / 9
```
Naturally high during keto, lower during buffer.

### Fiber
- Fasting: 0g
- Keto: Starts at ketoFloor/2, gradually increases
- Others: ~14g per 1000 cal

### Sugar
- Fasting/Keto: 0g
- Buffer: Peak (`max_cheat_sugar` setting)
- Others: Gradual curve between 5g and 50% of max

---

## Flexibility by Cycle Length

| Cycle | Buffer | Typical Use |
|-------|--------|-------------|
| 7 days | 1 day | Weekly reset |
| 14 days | 2 days | Bi-weekly |
| 21 days | 3 days | 3-week blocks |
| 28 days | 4 days | Monthly cycle |

---

## Edge Cases

### No Buffer (buffer_days = 0)
- Cycle: Fasting → Keto → Reintro → Refuel → repeat
- No pre-fast (straight to fasting)

### No Fasting (fasting_duration = 0)
- Cycle: Buffer → Keto → Reintro → Refuel → Buffer
- No pre-fast phase

### Both Zero
- Cycle: Keto → Reintro → Refuel → repeat
- Continuous low-moderate carb cycling

---

## API Response

```json
{
  "date": "2026-02-02",
  "cycle": {
    "cycleDay": 24,
    "cycleLength": 28,
    "phase": "refuel",
    "phaseName": "Refuel",
    "phaseEmoji": "⚡"
  },
  "targets": {
    "calories": 2100,
    "protein_g": 95,
    "fat_g": 90,
    "carbs_g": 120,
    "fiber_g": 28,
    "sugar_g": 15
  }
}
```

---

## References

- **Mifflin-St Jeor Equation**: Mifflin MD, St Jeor ST, et al. (1990). *American Journal of Clinical Nutrition*
- **Metabolic Flexibility**: Goodpaster BH, Sparks LM. (2017). *Cell Metabolism*
- **Intermittent Fasting**: Patterson RE, Sears DD. (2017). *Annual Review of Nutrition*
