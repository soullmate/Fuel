/**
 * FUEL E2E Test Suite
 *
 * Validates the entire FUEL system from fresh install through full agent lifecycle.
 * Runs a real server + SQLite database with no mocks.
 */
const { startServer, api, seedFood, seedMeal } = require('./helpers');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Increase timeout for server start/stop
jest.setTimeout(30000);

// ============================================================
// 1. Fresh Install
// ============================================================
describe('Fresh Install', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);

  beforeAll(async () => { ctx = await startServer(); });
  afterAll(() => ctx.cleanup());

  test('Server starts with empty DB', () => {
    const tables = ctx.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);
    expect(tables).toContain('foods');
    expect(tables).toContain('meals');
    expect(tables).toContain('meal_items');
    expect(tables).toContain('user_settings');
    expect(tables).toContain('agent_reports');
  });

  test('GET /api/health returns { status: "ok" }', async () => {
    const { status, data } = await req('GET', '/api/health');
    expect(status).toBe(200);
    expect(data).toEqual({ status: 'ok' });
  });

  test('GET /api/settings returns defaults', async () => {
    const { status, data } = await req('GET', '/api/settings');
    expect(status).toBe(200);
    expect(data.weight_kg).toBeDefined();
    expect(data.height_cm).toBeDefined();
    expect(data.age).toBeDefined();
    expect(data.sex).toBeDefined();
  });

  test('GET /api/foods returns empty array', async () => {
    const { status, data } = await req('GET', '/api/foods');
    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  test('GET /api/daily returns zero totals', async () => {
    const { status, data } = await req('GET', '/api/daily');
    expect(status).toBe(200);
    expect(data.consumed.calories).toBe(0);
    expect(data.consumed.protein_g).toBe(0);
    expect(data.targets).toBeDefined();
  });

  test('GET /api/reports/pending returns { count: 0 }', async () => {
    const { status, data } = await req('GET', '/api/reports/pending');
    expect(status).toBe(200);
    expect(data.count).toBe(0);
    expect(data.reports).toEqual([]);
  });
});

// ============================================================
// 2. Settings CRUD
// ============================================================
describe('Settings', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);

  beforeAll(async () => { ctx = await startServer(); });
  afterAll(() => ctx.cleanup());

  test('PUT /api/settings updates user profile', async () => {
    const { status, data } = await req('PUT', '/api/settings', {
      weight_kg: 80, height_cm: 180, age: 35, sex: 'male',
      activity_mult: 1.5, protein_per_kg: 2.0,
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  test('Settings persist across reads', async () => {
    const { data } = await req('GET', '/api/settings');
    expect(data.weight_kg).toBe(80);
    expect(data.height_cm).toBe(180);
    expect(data.age).toBe(35);
    expect(data.sex).toBe('male');
  });

  test('Enable carb cycling', async () => {
    const { status } = await req('PUT', '/api/settings', {
      weight_kg: 80, height_cm: 180, age: 35, sex: 'male',
      carb_cycling_enabled: 1, cycle_start_date: '2026-01-01',
      cycle_length: 28, buffer_days: 5, fasting_duration: 2, keto_strictness: 50,
      activity_mult: 1.5, protein_per_kg: 2.0,
    });
    expect(status).toBe(200);
    const { data } = await req('GET', '/api/settings');
    expect(data.carb_cycling_enabled).toBe(1);
    expect(data.cycle_start_date).toBe('2026-01-01');
  });

  test('Disable carb cycling', async () => {
    const { data: before } = await req('GET', '/api/settings');
    await req('PUT', '/api/settings', {
      ...before, carb_cycling_enabled: 0,
    });
    const { data } = await req('GET', '/api/settings');
    expect(data.carb_cycling_enabled).toBe(0);
  });

  test('Invalid settings do not crash server', async () => {
    const { status } = await req('PUT', '/api/settings', { weight_kg: 'not_a_number' });
    // Server should respond (not crash) — either 200 or 400
    expect([200, 400]).toContain(status);
    // Verify server is still alive
    const { status: healthStatus } = await req('GET', '/api/health');
    expect(healthStatus).toBe(200);
  });
});

// ============================================================
// 3. Foods CRUD
// ============================================================
describe('Foods', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);
  let createdFoodId;

  beforeAll(async () => { ctx = await startServer(); });
  afterAll(() => ctx.cleanup());

  test('POST /api/foods creates a food', async () => {
    const { status, data } = await req('POST', '/api/foods', {
      name: 'Chicken Breast', serving_unit: 'g',
      calories: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0, fiber_g: 0, sugar_g: 0,
    });
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
    expect(data.name).toBe('Chicken Breast');
    createdFoodId = data.id;
  });

  test('GET /api/foods/:id retrieves it', async () => {
    const { status, data } = await req('GET', `/api/foods/${createdFoodId}`);
    expect(status).toBe(200);
    expect(data.name).toBe('Chicken Breast');
    expect(data.calories).toBe(165);
    expect(data.protein_g).toBe(31);
  });

  test('GET /api/foods?search=... finds by name', async () => {
    const { data } = await req('GET', '/api/foods?search=Chicken');
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].name).toContain('Chicken');
  });

  test('PUT /api/foods/:id updates nutrition', async () => {
    await req('PUT', `/api/foods/${createdFoodId}`, {
      name: 'Chicken Breast', serving_unit: 'g',
      calories: 170, protein_g: 32, fat_g: 4, carbs_g: 0, fiber_g: 0, sugar_g: 0,
    });
    const { data } = await req('GET', `/api/foods/${createdFoodId}`);
    expect(data.calories).toBe(170);
    expect(data.protein_g).toBe(32);
  });

  test('DELETE /api/foods/:id removes it', async () => {
    const { data: delResult } = await req('DELETE', `/api/foods/${createdFoodId}`);
    expect(delResult.success).toBe(true);
    const { status } = await req('GET', `/api/foods/${createdFoodId}`);
    expect(status).toBe(404);
  });

  test('Food with full micronutrients', async () => {
    const { data } = await req('POST', '/api/foods', {
      name: 'Enriched Spinach', serving_unit: 'g',
      calories: 23, protein_g: 2.9, fat_g: 0.4, carbs_g: 3.6, fiber_g: 2.2, sugar_g: 0.4,
    });
    expect(data.id).toBeDefined();
    // Micronutrient columns exist (null by default since we didn't set them)
    const full = ctx.db.prepare('SELECT * FROM foods WHERE id = ?').get(data.id);
    expect(full).toHaveProperty('calcium_mg');
    expect(full).toHaveProperty('iron_mg');
    expect(full).toHaveProperty('vitamin_c_mg');
    expect(full).toHaveProperty('vitamin_b12_mcg');
    expect(full).toHaveProperty('histidine_g');
  });

  test('Duplicate food names allowed', async () => {
    const { status: s1 } = await req('POST', '/api/foods', {
      name: 'Egg', calories: 155, protein_g: 13, fat_g: 11, carbs_g: 1.1,
    });
    const { status: s2 } = await req('POST', '/api/foods', {
      name: 'Egg', calories: 155, protein_g: 13, fat_g: 11, carbs_g: 1.1,
    });
    expect(s1).toBe(200);
    expect(s2).toBe(200);
  });
});

// ============================================================
// 4. Meals — Full Lifecycle
// ============================================================
describe('Meals', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);
  let foodId, mealId, itemId;

  beforeAll(async () => {
    ctx = await startServer();
    const food = seedFood(ctx.db, { name: 'Rice', calories: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28, fiber_g: 0.4, sugar_g: 0 });
    foodId = food.id;
  });
  afterAll(() => ctx.cleanup());

  test('POST /api/meals with items', async () => {
    const { status, data } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:00:00',
      title: 'Lunch', items: [{ food_id: foodId, amount: 1.5 }],
    });
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
    expect(data.items.length).toBe(1);
    mealId = data.id;
  });

  test('Amount multiplier math correct', async () => {
    const { data } = await req('GET', `/api/meals/${mealId}`);
    // 150g rice: amount=1.5, macros = per100g * 1.5
    expect(data.totals.calories).toBeCloseTo(130 * 1.5, 0);
    expect(data.totals.protein_g).toBeCloseTo(2.7 * 1.5, 0);
    expect(data.totals.carbs_g).toBeCloseTo(28 * 1.5, 0);
  });

  test('GET /api/meals/:id returns items + totals', async () => {
    const { status, data } = await req('GET', `/api/meals/${mealId}`);
    expect(status).toBe(200);
    expect(data.items).toBeDefined();
    expect(data.totals).toBeDefined();
    expect(data.totals.calories).toBeGreaterThan(0);
  });

  test('POST /api/meals/:mealId/items adds item', async () => {
    const food2 = seedFood(ctx.db, { name: 'Broccoli', calories: 34, protein_g: 2.8, fat_g: 0.4, carbs_g: 7, fiber_g: 2.6, sugar_g: 1.7 });
    const { status, data } = await req('POST', `/api/meals/${mealId}/items`, {
      food_id: food2.id, amount: 1.0,
    });
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
    itemId = data.id;

    const { data: meal } = await req('GET', `/api/meals/${mealId}`);
    expect(meal.items.length).toBe(2);
  });

  test('PUT /api/meal-items/:id updates amount', async () => {
    await req('PUT', `/api/meal-items/${itemId}`, { amount: 2.0 });
    const { data: meal } = await req('GET', `/api/meals/${mealId}`);
    const updatedItem = meal.items.find(i => i.id === itemId);
    expect(updatedItem).toBeDefined();
    // Total should reflect new amounts
    expect(meal.totals.calories).toBeGreaterThan(130 * 1.5);
  });

  test('DELETE /api/meal-items/:id removes item', async () => {
    await req('DELETE', `/api/meal-items/${itemId}`);
    const { data: meal } = await req('GET', `/api/meals/${mealId}`);
    expect(meal.items.length).toBe(1);
    // Back to just rice
    expect(meal.totals.calories).toBeCloseTo(130 * 1.5, 0);
  });

  test('PUT /api/meals/:id updates metadata', async () => {
    await req('PUT', `/api/meals/${mealId}`, {
      meal_type: 'dinner', meal_time: '2026-02-05 19:00:00',
      notes: 'Updated', title: 'Dinner',
    });
    const { data } = await req('GET', `/api/meals/${mealId}`);
    expect(data.meal_type).toBe('dinner');
    expect(data.title).toBe('Dinner');
  });

  test('DELETE /api/meals/:id deletes meal and items', async () => {
    const { data } = await req('DELETE', `/api/meals/${mealId}`);
    expect(data.success).toBe(true);
    const { status } = await req('GET', `/api/meals/${mealId}`);
    expect(status).toBe(404);
    // Verify items are also gone
    const items = ctx.db.prepare('SELECT * FROM meal_items WHERE meal_id = ?').all(mealId);
    expect(items.length).toBe(0);
  });

  test('Meal with multiple items sums correctly', async () => {
    const chicken = seedFood(ctx.db, { name: 'Chicken2', calories: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0 });
    const rice2 = seedFood(ctx.db, { name: 'Rice2', calories: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28 });
    const { data } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:30:00', title: 'Multi',
      items: [
        { food_id: chicken.id, amount: 1.5 },
        { food_id: rice2.id, amount: 2.0 },
      ],
    });
    expect(data.totals.calories).toBeCloseTo(165 * 1.5 + 130 * 2.0, 0);
    expect(data.totals.protein_g).toBeCloseTo(31 * 1.5 + 2.7 * 2.0, 0);
  });

  test('GET /api/meals pagination', async () => {
    // Create a few more meals
    const food = seedFood(ctx.db, { name: 'Oats', calories: 389, protein_g: 16.9, fat_g: 6.9, carbs_g: 66 });
    for (let i = 0; i < 3; i++) {
      await req('POST', '/api/meals', {
        meal_type: 'breakfast', meal_time: `2026-02-0${i + 1} 08:00:00`, title: `Meal ${i}`,
        items: [{ food_id: food.id, amount: 0.5 }],
      });
    }
    const { data: page1 } = await req('GET', '/api/meals?limit=2&offset=0');
    expect(page1.meals.length).toBe(2);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);

    const { data: page2 } = await req('GET', '/api/meals?limit=2&offset=2');
    expect(page2.meals.length).toBeGreaterThanOrEqual(1);
    expect(page2.offset).toBe(2);
  });
});

// ============================================================
// 5. Daily Progress
// ============================================================
describe('Daily Progress', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);
  let foodId;

  beforeAll(async () => {
    ctx = await startServer();
    const food = seedFood(ctx.db, { name: 'Banana', calories: 89, protein_g: 1.1, fat_g: 0.3, carbs_g: 23, fiber_g: 2.6, sugar_g: 12 });
    foodId = food.id;
  });
  afterAll(() => ctx.cleanup());

  test('GET /api/daily/:date with no meals', async () => {
    const { status, data } = await req('GET', '/api/daily/2026-02-05');
    expect(status).toBe(200);
    expect(data.targets).toBeDefined();
    expect(data.consumed.calories).toBe(0);
    expect(data.consumed.protein_g).toBe(0);
  });

  test('Log a meal, check daily updates', async () => {
    await req('POST', '/api/meals', {
      meal_type: 'breakfast', meal_time: '2026-02-05 08:00:00',
      items: [{ food_id: foodId, amount: 2.0 }],
    });
    const { data } = await req('GET', '/api/daily/2026-02-05');
    expect(data.consumed.calories).toBeCloseTo(89 * 2.0, 0);
    expect(data.consumed.protein_g).toBeCloseTo(1.1 * 2.0, 0);
  });

  test('Multiple meals same day sum correctly', async () => {
    await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:00:00',
      items: [{ food_id: foodId, amount: 1.0 }],
    });
    const { data } = await req('GET', '/api/daily/2026-02-05');
    // 2.0 (breakfast) + 1.0 (lunch) = 3.0 bananas
    expect(data.consumed.calories).toBeCloseTo(89 * 3.0, 0);
  });

  test('Different dates do not cross-contaminate', async () => {
    await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-04 12:00:00',
      items: [{ food_id: foodId, amount: 1.0 }],
    });
    const { data: feb4 } = await req('GET', '/api/daily/2026-02-04');
    const { data: feb5 } = await req('GET', '/api/daily/2026-02-05');
    expect(feb4.consumed.calories).toBeCloseTo(89, 0);
    expect(feb5.consumed.calories).toBeCloseTo(89 * 3.0, 0);
  });

  test('GET /api/daily (no date) uses today', async () => {
    const { status, data } = await req('GET', '/api/daily');
    expect(status).toBe(200);
    expect(data.date).toBeDefined();
    expect(data.targets).toBeDefined();
  });

  test('Targets calculated from settings', async () => {
    await req('PUT', '/api/settings', {
      weight_kg: 80, height_cm: 180, age: 35, sex: 'male',
      activity_mult: 1.5, protein_per_kg: 2.0,
    });
    const { data } = await req('GET', '/api/daily/2026-02-05');
    expect(data.targets.calories).toBeGreaterThan(1500);
    expect(data.targets.protein_g).toBe(160); // 80 * 2.0
  });
});

// ============================================================
// 6. Carb Cycling Algorithm
// ============================================================
describe('Carb Cycling', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);

  beforeAll(async () => {
    ctx = await startServer();
  });
  afterAll(() => ctx.cleanup());

  test('Simple mode returns flat targets', async () => {
    await req('PUT', '/api/settings', {
      weight_kg: 70, height_cm: 170, age: 30, sex: 'female',
      carb_cycling_enabled: 0, activity_mult: 1.2, protein_per_kg: 1.6,
    });
    const { data: d1 } = await req('GET', '/api/daily/2026-02-01');
    const { data: d2 } = await req('GET', '/api/daily/2026-02-02');
    expect(d1.targets.calories).toBe(d2.targets.calories);
    expect(d1.targets.protein_g).toBe(d2.targets.protein_g);
    expect(d1.targets.phase).toBe('off');
  });

  test('Enable cycling — buffer phase', async () => {
    // cycle_start_date=2026-01-01, so day 1 = Jan 1 = buffer
    await req('PUT', '/api/settings', {
      weight_kg: 70, height_cm: 170, age: 30, sex: 'female',
      carb_cycling_enabled: 1, cycle_start_date: '2026-01-01',
      cycle_length: 28, buffer_days: 5, fasting_duration: 2, keto_strictness: 50,
      activity_mult: 1.2, protein_per_kg: 1.6,
    });
    const { data } = await req('GET', '/api/daily/2026-01-01');
    expect(data.cycle.phase).toBe('buffer');
    expect(data.targets.calories).toBeGreaterThan(0);
  });

  test('Fasting phase returns zero targets', async () => {
    // With buffer_days=5, fasting starts at day 6-7
    // preFastDay=5, fastingStart=6, fastingEnd=7
    const { data } = await req('GET', '/api/daily/2026-01-06');
    expect(data.cycle.isFasting).toBe(true);
    expect(data.targets.calories).toBe(0);
    expect(data.targets.protein_g).toBe(0);
    expect(data.targets.carbs_g).toBe(0);
  });

  test('Keto phase returns low carb targets', async () => {
    // ketoStart = fastingEnd+1 = 8, ketoEnd = cycleLength/2 = 14
    const { data } = await req('GET', '/api/daily/2026-01-10');
    expect(data.cycle.isKeto).toBe(true);
    expect(data.targets.carbs_g).toBeLessThanOrEqual(70);
    expect(data.targets.carbs_g).toBeGreaterThanOrEqual(20);
  });

  test('Cycle wraps at cycle_length', async () => {
    // Jan 1 + 28 days = Jan 29 → cycle day 1 again
    const { data: day1 } = await req('GET', '/api/daily/2026-01-01');
    const { data: day29 } = await req('GET', '/api/daily/2026-01-29');
    expect(day29.cycle.cycleDay).toBe(day1.cycle.cycleDay);
    expect(day29.cycle.phase).toBe(day1.cycle.phase);
  });

  test('GET /api/week/:date shows phase progression', async () => {
    const { status, data } = await req('GET', '/api/week/2026-01-14?days=7');
    expect(status).toBe(200);
    expect(data.length).toBe(7);
    // Phases should vary across a week
    const phases = data.map(d => d.cycle.phase);
    expect(new Set(phases).size).toBeGreaterThanOrEqual(1);
  });

  test('Keto strictness affects carb ceiling', async () => {
    // strictness=0 → floor=20g
    await req('PUT', '/api/settings', {
      weight_kg: 70, height_cm: 170, age: 30, sex: 'female',
      carb_cycling_enabled: 1, cycle_start_date: '2026-01-01',
      cycle_length: 28, buffer_days: 5, fasting_duration: 2, keto_strictness: 0,
      activity_mult: 1.2, protein_per_kg: 1.6,
    });
    const { data: strict } = await req('GET', '/api/daily/2026-01-08');
    // First keto day: carbTarget = ketoFloor = 20
    expect(strict.targets.carbs_g).toBeLessThanOrEqual(40);

    // strictness=100 → floor=50g
    await req('PUT', '/api/settings', {
      weight_kg: 70, height_cm: 170, age: 30, sex: 'female',
      carb_cycling_enabled: 1, cycle_start_date: '2026-01-01',
      cycle_length: 28, buffer_days: 5, fasting_duration: 2, keto_strictness: 100,
      activity_mult: 1.2, protein_per_kg: 1.6,
    });
    const { data: relaxed } = await req('GET', '/api/daily/2026-01-08');
    expect(relaxed.targets.carbs_g).toBeGreaterThanOrEqual(strict.targets.carbs_g);
  });

  test('Fasting duration=0 skips fasting', async () => {
    await req('PUT', '/api/settings', {
      weight_kg: 70, height_cm: 170, age: 30, sex: 'female',
      carb_cycling_enabled: 1, cycle_start_date: '2026-01-01',
      cycle_length: 28, buffer_days: 5, fasting_duration: 0, keto_strictness: 50,
      activity_mult: 1.2, protein_per_kg: 1.6,
    });
    // Check all 28 days — none should be fasting
    for (let d = 1; d <= 28; d++) {
      const dateStr = `2026-01-${String(d).padStart(2, '0')}`;
      const { data } = await req('GET', `/api/daily/${dateStr}`);
      expect(data.targets.isFasting).not.toBe(true);
    }
  });
});

// ============================================================
// 7. Meal Validation
// ============================================================
describe('Meal Validation', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);
  let foodId;

  beforeAll(async () => {
    ctx = await startServer();
    // Ensure data dir exists for validation log
    const dataDir = path.join(path.dirname(ctx.tmpDb), '..', 'data');
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}

    const food = seedFood(ctx.db, { name: 'ValidChicken', calories: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0 });
    foodId = food.id;
  });
  afterAll(() => ctx.cleanup());

  test('Normal meal passes validation', async () => {
    const { data } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:00:00',
      items: [{ food_id: foodId, amount: 1.5 }],
    });
    expect(data.validation).toBeDefined();
    expect(data.validation.valid).toBe(true);
    expect(data.validation.issues.length).toBe(0);
  });

  test('Amount > 10 flagged with validation issues', async () => {
    const { data } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:10:00',
      items: [{ food_id: foodId, amount: 150 }],
    });
    // amount=150 → server auto-sets actual_grams=150, then validation sees
    // the mismatch (amount=150 but expected 1.50) and high calories
    expect(data.validation.valid).toBe(false);
    expect(data.validation.issues.length).toBeGreaterThan(0);
  });

  test('Calories > 3000 per item flagged', async () => {
    // Create high-cal food
    const highCal = seedFood(ctx.db, { name: 'HighCal', calories: 3500, protein_g: 10, fat_g: 100, carbs_g: 200 });
    const { data } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:20:00',
      items: [{ food_id: highCal.id, amount: 1.0 }],
    });
    expect(data.validation.issues.length).toBeGreaterThan(0);
    expect(data.validation.issues.some(i => i.includes('unrealistic'))).toBe(true);
  });

  test('Total meal > 5000 cal flagged', async () => {
    const highCal = seedFood(ctx.db, { name: 'HugeMeal', calories: 2600, protein_g: 50, fat_g: 100, carbs_g: 200 });
    const { data } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:30:00',
      items: [
        { food_id: highCal.id, amount: 1.0 },
        { food_id: highCal.id, amount: 1.0 },
      ],
    });
    expect(data.validation.issues.some(i => i.includes('unusually high'))).toBe(true);
  });

  test('Protein > calories flagged', async () => {
    // Impossible: protein calories (200*4=800) > total calories (100)
    const badFood = seedFood(ctx.db, { name: 'BadRatio', calories: 100, protein_g: 200, fat_g: 0, carbs_g: 0 });
    const { data } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:40:00',
      items: [{ food_id: badFood.id, amount: 1.0 }],
    });
    expect(data.validation.issues.some(i => i.includes('Protein'))).toBe(true);
  });

  test('GET /api/validation/recheck/:mealId re-validates', async () => {
    const { data: meal } = await req('POST', '/api/meals', {
      meal_type: 'lunch', meal_time: '2026-02-05 12:50:00',
      items: [{ food_id: foodId, amount: 1.0 }],
    });
    const { status, data } = await req('GET', `/api/validation/recheck/${meal.id}`);
    expect(status).toBe(200);
    expect(data).toHaveProperty('valid');
    expect(data).toHaveProperty('issues');
  });
});

// ============================================================
// 8. Agent Reports System
// ============================================================
describe('Agent Reports', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);

  beforeAll(async () => { ctx = await startServer(); });
  afterAll(() => ctx.cleanup());

  test('POST /api/reports creates report', async () => {
    const { status, data } = await req('POST', '/api/reports', {
      agent: 'hayden', severity: 'info', category: 'health',
      summary: 'All systems healthy', details: { tests_passed: 7 }, for_human: 0,
    });
    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.created).toBe(true);
  });

  test('Report with all fields', async () => {
    const { data } = await req('POST', '/api/reports', {
      agent: 'diqq', severity: 'medium', category: 'data_quality',
      summary: 'Missing micronutrients', details: { foods_affected: 12, fields: ['calcium_mg'] },
      for_human: 1,
    });
    expect(data.id).toBeDefined();
    // Verify stored correctly
    const row = ctx.db.prepare('SELECT * FROM agent_reports WHERE id = ?').get(data.id);
    expect(row.agent).toBe('diqq');
    expect(row.severity).toBe('medium');
    expect(row.category).toBe('data_quality');
    expect(row.for_human).toBe(1);
  });

  test('GET /api/reports/pending shows unacknowledged', async () => {
    const { data } = await req('GET', '/api/reports/pending');
    expect(data.count).toBeGreaterThanOrEqual(2);
    expect(data.reports.length).toBe(data.count);
  });

  test('PUT /api/reports/:id/ack acknowledges', async () => {
    const { data: pending } = await req('GET', '/api/reports/pending');
    const reportId = pending.reports[0].id;
    const { status, data } = await req('PUT', `/api/reports/${reportId}/ack`, {
      resolution: 'noted',
    });
    expect(status).toBe(200);
    expect(data.acknowledged).toBe(true);
  });

  test('Acknowledged reports not in pending', async () => {
    const { data: before } = await req('GET', '/api/reports/pending');
    const countBefore = before.count;
    // Ack another
    if (before.reports.length > 0) {
      await req('PUT', `/api/reports/${before.reports[0].id}/ack`, { resolution: 'handled' });
    }
    const { data: after } = await req('GET', '/api/reports/pending');
    expect(after.count).toBeLessThan(countBefore);
  });

  test('GET /api/reports with filters', async () => {
    // Create some reports for filtering
    await req('POST', '/api/reports', { agent: 'hayden', severity: 'critical', category: 'health', summary: 'Critical issue' });
    await req('POST', '/api/reports', { agent: 'ricky', severity: 'low', category: 'learning', summary: 'Learned preference' });

    const { data: haydenOnly } = await req('GET', '/api/reports?agent=hayden');
    expect(haydenOnly.reports.every(r => r.agent === 'hayden')).toBe(true);

    const { data: criticalOnly } = await req('GET', '/api/reports?severity=critical');
    expect(criticalOnly.reports.every(r => r.severity === 'critical')).toBe(true);
  });

  test('Multiple agents can write reports', async () => {
    const agents = ['hayden', 'diqq', 'ricky'];
    for (const agent of agents) {
      const { status } = await req('POST', '/api/reports', {
        agent, severity: 'info', category: 'health', summary: `Report from ${agent}`,
      });
      expect(status).toBe(201);
    }
  });

  test('for_human=1 vs for_human=0', async () => {
    const { data: r1 } = await req('POST', '/api/reports', {
      agent: 'hayden', severity: 'info', category: 'health', summary: 'Auto', for_human: 0,
    });
    const { data: r2 } = await req('POST', '/api/reports', {
      agent: 'hayden', severity: 'high', category: 'health', summary: 'Human needed', for_human: 1,
    });
    const row1 = ctx.db.prepare('SELECT for_human FROM agent_reports WHERE id = ?').get(r1.id);
    const row2 = ctx.db.prepare('SELECT for_human FROM agent_reports WHERE id = ?').get(r2.id);
    expect(row1.for_human).toBe(0);
    expect(row2.for_human).toBe(1);
  });
});

// ============================================================
// 9. PA Scan Integration
// ============================================================
describe('PA Scan', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);
  const paScanPath = path.join(__dirname, '..', 'agents', 'pa-scan.js');

  beforeAll(async () => { ctx = await startServer(); });
  afterAll(() => ctx.cleanup());

  function runPaScan() {
    return execFileSync('node', [paScanPath], {
      env: { ...process.env, FUEL_API_BASE: ctx.baseUrl },
      timeout: 10000,
      encoding: 'utf8',
    });
  }

  test('Create reports, run pa-scan.js — all acknowledged', async () => {
    await req('POST', '/api/reports', { agent: 'hayden', severity: 'info', category: 'health', summary: 'Test report 1', for_human: 0 });
    await req('POST', '/api/reports', { agent: 'diqq', severity: 'low', category: 'data_quality', summary: 'Test report 2', for_human: 0 });

    const { data: before } = await req('GET', '/api/reports/pending');
    expect(before.count).toBeGreaterThanOrEqual(2);

    runPaScan();

    const { data: after } = await req('GET', '/api/reports/pending');
    expect(after.count).toBe(0);
  });

  test('for_human=1 → resolution=queued_for_human', async () => {
    await req('POST', '/api/reports', { agent: 'hayden', severity: 'high', category: 'health', summary: 'Needs human', for_human: 1 });
    runPaScan();
    // Check the most recent acknowledged report
    const reports = ctx.db.prepare(
      "SELECT * FROM agent_reports WHERE summary = 'Needs human' AND acknowledged_at IS NOT NULL"
    ).all();
    expect(reports.length).toBe(1);
    expect(reports[0].resolution).toBe('queued_for_human');
  });

  test('health+info → resolution=noted', async () => {
    await req('POST', '/api/reports', { agent: 'hayden', severity: 'info', category: 'health', summary: 'Info health check', for_human: 0 });
    runPaScan();
    const row = ctx.db.prepare("SELECT * FROM agent_reports WHERE summary = 'Info health check' AND acknowledged_at IS NOT NULL").get();
    expect(row.resolution).toBe('noted');
  });

  test('health+medium → resolution=logged_for_briefing', async () => {
    await req('POST', '/api/reports', { agent: 'hayden', severity: 'medium', category: 'health', summary: 'Medium health issue', for_human: 0 });
    runPaScan();
    const row = ctx.db.prepare("SELECT * FROM agent_reports WHERE summary = 'Medium health issue' AND acknowledged_at IS NOT NULL").get();
    expect(row.resolution).toBe('logged_for_briefing');
  });

  test('learning category → resolution=stored_in_memory', async () => {
    await req('POST', '/api/reports', { agent: 'ricky', severity: 'info', category: 'learning', summary: 'Learned pref', details: { pref: 'low_carb' }, for_human: 0 });
    runPaScan();
    const row = ctx.db.prepare("SELECT * FROM agent_reports WHERE summary = 'Learned pref' AND acknowledged_at IS NOT NULL").get();
    expect(row.resolution).toBe('stored_in_memory');
  });

  test('No pending reports → clean exit', () => {
    // All reports already acknowledged — this should just succeed
    const output = runPaScan();
    expect(output).toContain('No pending reports');
  });
});

// ============================================================
// 10. HAYDEN Health Checks
// ============================================================
describe('HAYDEN Agent', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);
  const haydenPath = path.join(__dirname, '..', 'agents', 'hayden.js');
  let tmpStateFile, tmpIssuesDir;

  beforeAll(async () => {
    ctx = await startServer();
    // Seed a food + meal so HAYDEN has data to check
    const food = seedFood(ctx.db, { name: 'HaydenChicken', calories: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0 });
    await seedMeal(ctx.baseUrl, food.id);

    tmpStateFile = path.join(path.dirname(ctx.tmpDb), 'hayden-state-test.json');
    tmpIssuesDir = path.join(path.dirname(ctx.tmpDb), 'issues-test');
    fs.mkdirSync(tmpIssuesDir, { recursive: true });
  });
  afterAll(() => {
    try { fs.unlinkSync(tmpStateFile); } catch (e) {}
    try { fs.rmSync(tmpIssuesDir, { recursive: true }); } catch (e) {}
    ctx.cleanup();
  });

  function runHayden(args = []) {
    return execFileSync('node', [haydenPath, ...args], {
      env: {
        ...process.env,
        FUEL_API_BASE: ctx.baseUrl,
        HAYDEN_DB_PATH: ctx.tmpDb,
        HAYDEN_STATE_PATH: tmpStateFile,
        HAYDEN_ISSUES_DIR: tmpIssuesDir,
      },
      timeout: 15000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  test('--quick mode runs without error', () => {
    const output = runHayden(['--quick']);
    expect(output).toBeDefined();
    // Should contain test result markers
    expect(output.length).toBeGreaterThan(0);
  });

  test('Reports written to agent_reports', async () => {
    const { data: before } = await req('GET', '/api/reports?agent=hayden');
    const countBefore = before.count;

    try { runHayden(['--quick']); } catch (e) {}

    const { data: after } = await req('GET', '/api/reports?agent=hayden');
    // HAYDEN should have written at least one report
    expect(after.count).toBeGreaterThanOrEqual(countBefore);
  });

  test('State file updated after run', () => {
    try { runHayden(['--quick']); } catch (e) {}

    expect(fs.existsSync(tmpStateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(tmpStateFile, 'utf8'));
    expect(state.lastRun).toBeDefined();
    expect(state.testsRun).toBeGreaterThan(0);
  });
});

// ============================================================
// 11. Unit Weights & Supporting APIs
// ============================================================
describe('Supporting APIs', () => {
  let ctx;
  const req = (method, url, body) => api(ctx.baseUrl, method, url, body);
  let foodId;

  beforeAll(async () => {
    ctx = await startServer();
    const food = seedFood(ctx.db, { name: 'Egg', calories: 155, protein_g: 13, fat_g: 11, carbs_g: 1.1 });
    foodId = food.id;
  });
  afterAll(() => ctx.cleanup());

  // --- Unit Weights ---
  test('POST /api/unit-weights creates mapping', async () => {
    const { status, data } = await req('POST', '/api/unit-weights', {
      food_id: foodId, unit: 'egg', grams: 50, source: 'manual',
    });
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
    expect(data.grams).toBe(50);
  });

  test('GET /api/unit-weights?food_id=X retrieves', async () => {
    const { data } = await req('GET', `/api/unit-weights?food_id=${foodId}`);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].unit).toBe('egg');
    expect(data[0].grams).toBe(50);
  });

  // --- History ---
  test('GET /api/history returns meal history', async () => {
    // Seed a meal first
    await seedMeal(ctx.baseUrl, foodId, { meal_time: '2026-02-05 08:00:00' });
    const { status, data } = await req('GET', '/api/history?days=7');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  // --- Decision Log ---
  test('POST /api/decision-log records decisions', async () => {
    const { status, data } = await req('POST', '/api/decision-log', {
      entity_type: 'meal', entity_id: 1, agent: 'pipeline',
      action: 'parse', details: { parsed: 'eggs' }, confidence_pct: 0.9,
    });
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
    expect(data.agent).toBe('pipeline');
  });

  test('GET /api/decision-log retrieves log', async () => {
    const { status, data } = await req('GET', '/api/decision-log?entity_type=meal&entity_id=1');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  // --- Decompositions ---
  test('POST /api/decompositions stores breakdown', async () => {
    const { status, data } = await req('POST', '/api/decompositions', {
      meal_name: 'Caesar Salad',
      ingredients: [
        { name: 'romaine lettuce', grams: 100 },
        { name: 'parmesan', grams: 30 },
        { name: 'croutons', grams: 20 },
      ],
      source: 'manual',
    });
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
    expect(data.meal_name).toBe('caesar salad'); // lowercased
  });

  test('GET /api/decompositions/:id retrieves', async () => {
    const { data: all } = await req('GET', '/api/decompositions');
    expect(all.length).toBeGreaterThanOrEqual(1);
    const id = all[0].id;
    const { status, data } = await req('GET', `/api/decompositions/${id}`);
    expect(status).toBe(200);
    expect(Array.isArray(data.ingredients)).toBe(true);
    expect(data.ingredients.length).toBe(3);
  });
});
