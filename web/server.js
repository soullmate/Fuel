require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const USER_TIMEZONE = process.env.USER_TIMEZONE || 'UTC';

// Secret URL prefix authentication
// All requests must go through /<token>/... — strips prefix before routing
const cookieParser = require('cookie-parser');
app.use(cookieParser());

if (ACCESS_TOKEN) {
  const prefix = `/${ACCESS_TOKEN}`;
  const COOKIE_NAME = 'fuel_token';
  
  app.use((req, res, next) => {
    // Allow health check endpoint always
    if (req.path === '/health') return next();
    
    // Check if request is truly internal (not proxied from outside)
    // Caddy/nginx set X-Forwarded-For for proxied requests
    const forwarded = req.headers['x-forwarded-for'];
    const isProxied = !!forwarded;
    const isLocalDirect = !isProxied && (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1');
    
    // Only bypass token for direct localhost calls (crons, internal agents)
    if (isLocalDirect) return next();
    
    // Check token in URL path
    if (req.path.startsWith(prefix)) {
      // Set auth cookie so subsequent requests (API calls from JS) work
      res.cookie(COOKIE_NAME, ACCESS_TOKEN, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
      // Strip the token prefix so routes work normally
      req.url = req.url.slice(prefix.length) || '/';
      return next();
    }
    
    // Check auth cookie (set when user first visits with token URL)
    if (req.cookies && req.cookies[COOKIE_NAME] === ACCESS_TOKEN) {
      return next();
    }
    
    // No token or wrong token — 404 (don't reveal the app exists)
    res.status(404).send('Not found');
  });
  console.log(`🔒 Access token enabled — app at /${ACCESS_TOKEN.slice(0,6)}...`);
}

// Database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'food_tracker.db');
const isNewDb = !require('fs').existsSync(dbPath);
const db = new Database(dbPath);

// Auto-apply schema on first run
if (isNewDb) {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  if (require('fs').existsSync(schemaPath)) {
    db.exec(require('fs').readFileSync(schemaPath, 'utf8'));
    console.log('📦 Database initialized from schema.sql');
  }
}
// Apply migrations if available
const migrationsDir = path.join(__dirname, '..', 'migrations');
if (require('fs').existsSync(migrationsDir)) {
  const migrationFiles = require('fs').readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    try {
      db.exec(require('fs').readFileSync(path.join(migrationsDir, file), 'utf8'));
    } catch (e) {
      // Migration likely already applied — skip silently
    }
  }
}

// DIQQ - Data Ingestion Quality Control
let diqq;
try {
  diqq = require('../diqq.js');
  console.log('🔍 DIQQ loaded - Food quality control active');
} catch (e) {
  console.log('⚠️ DIQQ not available:', e.message);
}

// ============== MEAL SANITY VALIDATION ==============
const fs = require('fs');
const VALIDATION_LOG = path.join(__dirname, '..', 'data', 'meal_validation.log');

/**
 * Validate a meal after save - checks for common logging errors
 * @param {number} mealId - The saved meal ID
 * @returns {object} - { valid: boolean, issues: string[], autoFixed: string[] }
 */
function validateMealSanity(mealId) {
  const issues = [];
  const autoFixed = [];
  
  // Get meal with items
  const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(mealId);
  if (!meal) return { valid: false, issues: ['Meal not found'], autoFixed: [] };
  
  const items = db.prepare(`
    SELECT mi.*, f.name as food_name, f.calories as cal_per_100g, f.serving_size
    FROM meal_items mi 
    JOIN foods f ON mi.food_id = f.id 
    WHERE mi.meal_id = ?
  `).all(mealId);
  
  for (const item of items) {
    // Calculate effective multiplier (same logic as getMealMacros)
    // Smart detection: if amount ≈ actual_grams, it's old convention (both are multipliers)
    // If amount ≈ actual_grams/100, it's new convention (actual_grams is real grams)
    let multiplier;
    if (item.actual_grams === null) {
      multiplier = item.amount;
    } else if (Math.abs(item.amount - item.actual_grams) < 0.01) {
      // Old convention: amount = actual_grams (both are multipliers)
      multiplier = item.amount;
    } else if (Math.abs(item.amount - item.actual_grams / 100.0) < 0.01) {
      // New convention: actual_grams is real grams
      multiplier = item.actual_grams / 100.0;
    } else {
      // Mismatch - prefer actual_grams / 100 for new entries
      multiplier = item.actual_grams / 100.0;
    }
    
    const calcCal = item.cal_per_100g * multiplier;
    
    // Check 1: Amount looks like raw grams instead of multiplier
    if (item.amount > 10 && item.actual_grams === null) {
      issues.push(`⚠️ ${item.food_name}: amount=${item.amount} looks like raw grams (should be ${(item.amount/100).toFixed(2)}?)`);
      
      // Auto-fix: set actual_grams so server fallback kicks in
      db.prepare('UPDATE meal_items SET actual_grams = ? WHERE id = ?').run(item.amount, item.id);
      autoFixed.push(`Set actual_grams=${item.amount} for ${item.food_name} (server will divide by 100)`);
    }
    
    // Check 2: Impossibly high calories for single item (>3000 cal)
    if (calcCal > 3000) {
      issues.push(`🚨 ${item.food_name}: ${Math.round(calcCal)} cal is unrealistic for single item`);
    }
    
    // Check 3: Amount is suspiciously small (<0.01 = less than 1g)
    if (multiplier > 0 && multiplier < 0.01) {
      issues.push(`⚠️ ${item.food_name}: amount=${multiplier} = ${multiplier*100}g seems very small`);
    }
    
    // Check 4: actual_grams doesn't match amount (if both set)
    if (item.actual_grams !== null && item.actual_grams > 0 && item.amount > 0) {
      const expectedAmount = item.actual_grams / 100.0;
      if (Math.abs(item.amount - expectedAmount) > 0.01 && item.amount !== 1) {
        // Only flag if amount isn't the default 1.0
        issues.push(`⚠️ ${item.food_name}: amount=${item.amount} but actual_grams=${item.actual_grams} (expected amount=${expectedAmount.toFixed(2)})`);
      }
    }
  }
  
  // Check 5: Total meal calories sanity
  const totals = getMealMacros(mealId);
  if (totals.calories > 5000) {
    issues.push(`🚨 Total meal: ${Math.round(totals.calories)} cal is unusually high`);
  }
  
  // Check 6: Protein > calories (impossible)
  if (totals.protein_g * 4 > totals.calories * 1.1) {
    issues.push(`🚨 Protein (${Math.round(totals.protein_g)}g = ${Math.round(totals.protein_g*4)} cal) exceeds total calories (${Math.round(totals.calories)})`);
  }
  
  // Log issues if any
  if (issues.length > 0 || autoFixed.length > 0) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      mealId,
      title: meal.title,
      meal_time: meal.meal_time,
      issues,
      autoFixed,
      totals: {
        calories: Math.round(totals.calories),
        protein: Math.round(totals.protein_g),
        fat: Math.round(totals.fat_g),
        carbs: Math.round(totals.carbs_g)
      }
    };
    
    // Append to validation log
    try {
      fs.appendFileSync(VALIDATION_LOG, JSON.stringify(logEntry) + '\n');
    } catch (e) {
      console.error('Failed to write validation log:', e.message);
    }
    
    console.log(`🔍 Meal #${mealId} validation:`, issues.length ? issues : 'OK', autoFixed.length ? `(auto-fixed: ${autoFixed.length})` : '');
  }
  
  return { 
    valid: issues.length === 0, 
    issues, 
    autoFixed,
    totals
  };
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve meal photos
app.use('/photos', express.static(path.join(__dirname, '..', 'photos')));

// Helper: Get today in user timezone
function getTodayInUserTimezone() {
  return new Date().toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
}

// Helper: Calculate meal macros from items
function getMealMacros(mealId) {
  return db.prepare(`
    SELECT 
      COALESCE(SUM(f.calories * mi.amount), 0) as calories,
      COALESCE(SUM(f.protein_g * mi.amount), 0) as protein_g,
      COALESCE(SUM(f.fat_g * mi.amount), 0) as fat_g,
      COALESCE(SUM(f.carbs_g * mi.amount), 0) as carbs_g,
      COALESCE(SUM(f.fiber_g * mi.amount), 0) as fiber_g,
      COALESCE(SUM(f.sugar_g * mi.amount), 0) as sugar_g
    FROM meal_items mi
    JOIN foods f ON mi.food_id = f.id
    WHERE mi.meal_id = ?
  `).get(mealId);
}

// Helper: Get daily consumed totals
function getDayTotals(dateStr) {
  return db.prepare(`
    SELECT 
      COALESCE(SUM(f.calories * mi.amount), 0) as calories,
      COALESCE(SUM(f.protein_g * mi.amount), 0) as protein_g,
      COALESCE(SUM(f.fat_g * mi.amount), 0) as fat_g,
      COALESCE(SUM(f.carbs_g * mi.amount), 0) as carbs_g,
      COALESCE(SUM(f.fiber_g * mi.amount), 0) as fiber_g,
      COALESCE(SUM(f.sugar_g * mi.amount), 0) as sugar_g,
      COALESCE(SUM(f.sodium_mg * mi.amount), 0) as sodium_mg,
      COALESCE(SUM(f.potassium_mg * mi.amount), 0) as potassium_mg,
      COALESCE(SUM(f.calcium_mg * mi.amount), 0) as calcium_mg,
      COALESCE(SUM(f.iron_mg * mi.amount), 0) as iron_mg,
      COALESCE(SUM(f.vitamin_c_mg * mi.amount), 0) as vitamin_c_mg,
      COALESCE(SUM(f.vitamin_d_mcg * mi.amount), 0) as vitamin_d_mcg,
      COALESCE(SUM(f.vitamin_b12_mcg * mi.amount), 0) as vitamin_b12_mcg,
      COALESCE(SUM(f.magnesium_mg * mi.amount), 0) as magnesium_mg,
      COALESCE(SUM(f.zinc_mg * mi.amount), 0) as zinc_mg,
      COALESCE(SUM(f.omega_3_g * mi.amount), 0) as omega_3_g,
      COALESCE(SUM(f.histidine_g * mi.amount), 0) as histidine_g,
      COALESCE(SUM(f.isoleucine_g * mi.amount), 0) as isoleucine_g,
      COALESCE(SUM(f.leucine_g * mi.amount), 0) as leucine_g,
      COALESCE(SUM(f.lysine_g * mi.amount), 0) as lysine_g,
      COALESCE(SUM(f.methionine_g * mi.amount), 0) as methionine_g,
      COALESCE(SUM(f.phenylalanine_g * mi.amount), 0) as phenylalanine_g,
      COALESCE(SUM(f.threonine_g * mi.amount), 0) as threonine_g,
      COALESCE(SUM(f.tryptophan_g * mi.amount), 0) as tryptophan_g,
      COALESCE(SUM(f.valine_g * mi.amount), 0) as valine_g
    FROM meals m
    JOIN meal_items mi ON m.id = mi.meal_id
    JOIN foods f ON mi.food_id = f.id
    WHERE SUBSTR(m.meal_time, 1, 10) = ?
  `).get(dateStr) || { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, potassium_mg: 0, calcium_mg: 0, iron_mg: 0, vitamin_c_mg: 0, vitamin_d_mcg: 0, vitamin_b12_mcg: 0, magnesium_mg: 0, zinc_mg: 0, omega_3_g: 0, histidine_g: 0, isoleucine_g: 0, leucine_g: 0, lysine_g: 0, methionine_g: 0, phenylalanine_g: 0, threonine_g: 0, tryptophan_g: 0, valine_g: 0 };
}

// Cycle phase calculation - Full algorithm with fasting/keto/normal phases
function getCycleInfo(dateStr, settings) {
  if (!settings || !settings.carb_cycling_enabled || !settings.cycle_start_date) {
    return { cycleDay: null, phase: 'off', phaseName: 'Simple', isFasting: false, isPreFast: false, isKeto: false, ketoProgress: 0 };
  }
  
  const cycleStart = new Date(settings.cycle_start_date);
  const currentDate = new Date(dateStr);
  const diffDays = Math.floor((currentDate - cycleStart) / (1000 * 60 * 60 * 24));
  const cycleLength = settings.cycle_length || 28;
  const cycleDay = ((diffDays % cycleLength) + cycleLength) % cycleLength + 1;
  
  const bufferDayCount = settings.buffer_days ?? 5;
  const fastingDuration = settings.fasting_duration ?? 2;

  const hasBuffer = bufferDayCount > 0;
  const hasFasting = fastingDuration > 0;
  const hasPrefast = hasBuffer && hasFasting;

  // Phase boundaries — Buffer, Pre-Fast, Fasting, Keto, Intro, Refuel, Buffer
  // Pre-fast only exists when both buffer AND fasting are enabled
  const startBufferEnd = Math.floor(bufferDayCount / 2);       // Start buffer days
  const endBufferDays = Math.ceil(bufferDayCount / 2);          // End buffer days
  const preFastDay = hasPrefast ? bufferDayCount : startBufferEnd;  // Collapse prefast when no fasting
  const fastingStart = preFastDay + 1;
  const fastingEnd = hasFasting ? preFastDay + fastingDuration : preFastDay;
  const ketoStart = fastingEnd + 1;
  const ketoEnd = Math.floor(cycleLength / 2);                // Midpoint
  const normalStart = ketoEnd + 1;
  const endBufferStart = hasBuffer ? cycleLength - endBufferDays + 1 : cycleLength + 1;
  const introEnd = normalStart + Math.floor((endBufferStart - 1 - normalStart) / 2);  // Split normal into intro/refuel

  let phase, phaseName, phaseEmoji;
  let isFasting = false, isPreFast = false, isKeto = false;
  let ketoProgress = 0;

  if (hasBuffer && cycleDay >= 1 && cycleDay <= startBufferEnd) {
    // Start buffer (high carb refeed)
    phase = 'buffer';
    phaseName = 'Buffer';
    phaseEmoji = '🍫';
  } else if (hasPrefast && cycleDay > startBufferEnd && cycleDay <= preFastDay) {
    // Pre-fast (winding down) — only when fasting is enabled
    phase = 'prefast';
    phaseName = 'Pre-Fast';
    phaseEmoji = '🌙';
    isPreFast = true;
  } else if (hasFasting && cycleDay >= fastingStart && cycleDay <= fastingEnd) {
    // Fasting
    phase = 'fasting';
    phaseName = 'Fasting';
    phaseEmoji = '✨';
    isFasting = true;
  } else if (cycleDay >= ketoStart && cycleDay <= ketoEnd) {
    // Keto
    phase = 'keto';
    phaseName = 'Keto';
    phaseEmoji = '🥑';
    isKeto = true;
    const ketoLength = ketoEnd - ketoStart;
    ketoProgress = ketoLength > 0 ? (cycleDay - ketoStart) / ketoLength : 0;
  } else if (cycleDay >= normalStart && cycleDay <= introEnd) {
    // Intro (gentle carb reintroduction)
    phase = 'intro';
    phaseName = 'Intro';
    phaseEmoji = '🌿';
  } else if (cycleDay > introEnd && cycleDay < endBufferStart) {
    // Refuel (ramping up)
    phase = 'refuel';
    phaseName = 'Refuel';
    phaseEmoji = '⚡';
  } else {
    // End buffer (high carb refeed)
    phase = 'buffer';
    phaseName = 'Buffer';
    phaseEmoji = '🍫';
  }
  
  return { 
    cycleDay, 
    cycleLength,
    phase, 
    phaseName, 
    phaseEmoji, 
    isFasting, 
    isPreFast,
    isKeto,
    ketoProgress,
    // Phase boundaries for reference
    boundaries: {
      startBufferEnd,
      preFastDay,
      fastingStart,
      fastingEnd,
      ketoStart,
      ketoEnd,
      normalStart,
      introEnd,
      endBufferStart
    }
  };
}

// ============== MODES SYSTEM ==============
// Base targets + pluggable mode functions applied in sequence
// Each mode transforms targets based on its own logic

// Calculate base daily targets (flat TDEE-based, no cycling)
// Always returns balanced macro split based on settings
function getBaseTargets(settings) {
  const weight = settings?.weight_kg || 70;
  const height = settings?.height_cm || 170;
  const age = settings?.age || 30;
  const sex = settings?.sex || 'female';
  const proteinPerKg = settings?.protein_per_kg || 1.6;
  const activityMult = settings?.activity_mult || 1.2;

  // Mifflin-St Jeor formula
  const bmrOffset = sex === 'male' ? 5 : -161;
  const bmr = 10 * weight + 6.25 * height - 5 * age + bmrOffset;
  const tdee = bmr * activityMult;
  const baseTarget = tdee;
  
  // Protein is consistent
  const baseProtein = Math.round(weight * proteinPerKg);
  
  // Fat floor: minimum for health (0.8g/kg)
  const fatFloor = Math.round(weight * 0.8);
  
  const calories = Math.round(baseTarget);
  const protein_g = baseProtein;
  // Standard macro split: ~40% carbs, protein as set, fat fills remainder
  const carbCalories = Math.round(calories * 0.40);
  const carbs_g = Math.round(carbCalories / 4);
  const fatCalories = calories - (protein_g * 4) - (carbs_g * 4);
  const fat_g = Math.round(Math.max(fatFloor, fatCalories / 9));
  const actualCalories = protein_g * 4 + carbs_g * 4 + fat_g * 9;
  const fiber_g = Math.max(Math.round(weight * 0.4), 25);
  const sugar_g = Math.round(actualCalories / 1000 * 12); // ~12g per 1000cal
  
  return {
    calories: actualCalories,
    protein_g,
    fat_g,
    carbs_g,
    fiber_g,
    sugar_g,
    isFasting: false,
    isPreFast: false,
    phase: 'off',
    baseTarget: Math.round(baseTarget),
    multiplier: 1.0
  };
}

// Mode: Carb Cycling — applies cycling multipliers on top of base targets
// Replaces targets based on cycle phase (fasting, keto, buffer, etc.)
// Every day is different - no flat lines
// Peak: Day 1 (cycle start) | Trough: Fasting days
// Fat is always calculated as remainder after protein and carbs
function applyMode_carbCycling(baseTargets, settings, dateStr) {
  const cycleInfo = getCycleInfo(dateStr, settings);
  if (cycleInfo.phase === 'off') return baseTargets;
  
  const weight = settings?.weight_kg || 70;
  const height = settings?.height_cm || 170;
  const age = settings?.age || 30;
  const sex = settings?.sex || 'female';
  const proteinPerKg = settings?.protein_per_kg || 1.6;
  const activityMult = settings?.activity_mult || 1.2;

  const ketoStrictness = settings?.keto_strictness ?? 50;
  const maxCheatSugar = settings?.max_cheat_sugar || 50;
  
  // Mifflin-St Jeor formula
  const bmrOffset = sex === 'male' ? 5 : -161;
  const bmr = 10 * weight + 6.25 * height - 5 * age + bmrOffset;
  const tdee = bmr * activityMult;
  const baseTarget = tdee;
  const baseProtein = Math.round(weight * proteinPerKg);
  const fatFloor = Math.round(weight * 0.8);

  // Get curve values for this cycle day
  const { calorieMultiplier, carbTarget } = calculateCurvesForDay(cycleInfo, ketoStrictness, tdee);
  
  // Fasting: 0 everything
  if (cycleInfo.isFasting) {
    return { 
      calories: 0, 
      protein_g: 0, 
      fat_g: 0, 
      carbs_g: 0, 
      fiber_g: 0, 
      sugar_g: 0, 
      isFasting: true,
      phase: cycleInfo.phase,
      baseTarget: Math.round(baseTarget),
      multiplier: 0
    };
  }
  
  // Pre-fast: 50% calories, reduced protein, moderate carbs (easing into fast)
  if (cycleInfo.isPreFast) {
    const calories = Math.round(baseTarget * 0.5);
    const protein_g = Math.round(baseProtein * 0.7);
    const carbs_g = 50;  // Moderate carbs to prepare for fast
    const fatCalories = calories - (protein_g * 4) - (carbs_g * 4);
    const fat_g = Math.round(Math.max(fatFloor, fatCalories / 9));
    const sugar_g = calculateSugarTarget(cycleInfo, maxCheatSugar);
    
    return {
      calories: protein_g * 4 + carbs_g * 4 + fat_g * 9,
      protein_g,
      fat_g,
      carbs_g,
      fiber_g: 20,
      sugar_g,
      isPreFast: true,
      phase: cycleInfo.phase,
      baseTarget: Math.round(baseTarget),
      multiplier: 0.5
    };
  }
  
  // All other days: use smooth curves
  const calories = Math.round(baseTarget * calorieMultiplier);
  const protein_g = baseProtein;
  let carbs_g = carbTarget;
  
  // Fat fills remaining calories after protein and carbs
  let fatCalories = calories - (protein_g * 4) - (carbs_g * 4);
  let fat_g = Math.round(Math.max(0, fatCalories / 9));
  
  // Fat floor enforcement: if fat is below minimum, reduce carbs to make room
  if (fat_g < fatFloor) {
    fat_g = fatFloor;
    const remainingForCarbs = calories - (protein_g * 4) - (fat_g * 9);
    carbs_g = Math.max(0, Math.round(remainingForCarbs / 4));
  }
  
  // Recalculate actual calories after adjustments
  const actualCalories = protein_g * 4 + carbs_g * 4 + fat_g * 9;
  
  // Fiber: during keto all carbs = fiber, otherwise ~0.4g/kg or 14g per 1000 cal
  // Smooth blend in second half of keto to avoid a sharp drop at keto→intro boundary
  let fiber_g;
  const normalFiber = Math.max(Math.round(weight * 0.4), Math.round(actualCalories / 1000 * 14), 25);
  if (cycleInfo.isKeto) {
    const ketoFiber = carbs_g;  // Net carbs = 0 during strict keto
    const progress = cycleInfo.ketoProgress;  // 0 at start, 1 at end
    if (progress <= 0.5) {
      fiber_g = ketoFiber;
    } else {
      // Blend from ketoFiber toward normalFiber in second half
      const blend = (progress - 0.5) / 0.5;  // 0→1 over second half
      fiber_g = Math.round(ketoFiber + blend * (normalFiber - ketoFiber));
    }
  } else {
    fiber_g = normalFiber;
  }
  
  // Sugar: 0 during keto, peaks on day 1, gradual curve
  let sugar_g = calculateSugarTarget(cycleInfo, maxCheatSugar);
  
  return {
    calories: actualCalories,
    protein_g,
    fat_g,
    carbs_g,
    fiber_g,
    sugar_g,
    isFasting: false,
    isPreFast: false,
    phase: cycleInfo.phase,
    baseTarget: Math.round(baseTarget),
    multiplier: calorieMultiplier
  };
}

// Orchestrator: calculate daily targets by applying all enabled modes in sequence
// Starts with flat TDEE base, then each mode transforms the targets
function getDailyTargets(settings, dateStr) {
  let targets = getBaseTargets(settings);
  
  // Mode: Carb Cycling
  if (settings?.carb_cycling_enabled && settings?.cycle_start_date) {
    targets = applyMode_carbCycling(targets, settings, dateStr);
  }
  
  // Future modes applied here in sequence:
  // if (settings?.wearable_sync_enabled) targets = applyMode_wearableSync(targets, settings, dateStr);
  // if (settings?.glucose_monitor_enabled) targets = applyMode_glucoseMonitor(targets, settings, dateStr);
  // if (settings?.ketone_monitor_enabled) targets = applyMode_ketoneMonitor(targets, settings, dateStr);
  // if (settings?.workout_sync_enabled) targets = applyMode_workoutSync(targets, settings, dateStr);
  
  return targets;
}

// Calculate sugar target: 0 during fasting/keto, peaks during buffer
function calculateSugarTarget(cycleInfo, maxCheatSugar) {
  const { cycleDay, cycleLength, phase, boundaries } = cycleInfo;
  const { ketoEnd, endBufferStart } = boundaries;
  
  // Fasting & Keto: 0 sugar
  if (cycleInfo.isFasting || cycleInfo.isKeto) return 0;
  
  // Pre-fast: declining toward 0
  if (phase === 'prefast') {
    const prefastLength = boundaries.preFastDay - boundaries.startBufferEnd;
    const dayIn = cycleDay - boundaries.startBufferEnd - 1;
    const progress = dayIn / Math.max(1, prefastLength - 1);
    return Math.round(5 * (1 - progress));  // 5 → 0
  }
  
  // Buffer (start): day 1 = peak, then declining
  if (phase === 'buffer' && cycleDay <= boundaries.startBufferEnd) {
    if (cycleDay === 1) return maxCheatSugar;
    const progress = (cycleDay - 1) / Math.max(1, boundaries.startBufferEnd - 1);
    return Math.round(maxCheatSugar * (1 - progress * 0.7));
  }
  
  // Buffer (end): ramping up to peak
  if (phase === 'buffer' && cycleDay >= endBufferStart) {
    const daysInEnd = cycleLength - endBufferStart + 1;
    const dayIn = cycleDay - endBufferStart;
    const progress = daysInEnd > 1 ? dayIn / (daysInEnd - 1) : 1;
    return Math.round(maxCheatSugar * 0.5 + (progress * maxCheatSugar * 0.5));
  }
  
  // Intro: minimal, gradually increasing (5 → 10)
  if (phase === 'intro') {
    const introLength = boundaries.introEnd - boundaries.normalStart + 1;
    const dayIn = cycleDay - boundaries.normalStart;
    const progress = dayIn / Math.max(1, introLength - 1);
    return Math.round(5 + (progress * 5));
  }
  
  // Refuel: building up toward buffer (10 → 50% of max)
  if (phase === 'refuel') {
    const refuelLength = endBufferStart - boundaries.introEnd - 1;
    const dayIn = cycleDay - boundaries.introEnd - 1;
    const progress = dayIn / Math.max(1, refuelLength - 1);
    return Math.round(10 + (progress * (maxCheatSugar * 0.5 - 10)));
  }
  
  return 5;  // fallback
}

// Calculate smooth curves for calories and carbs
// Peak at day 1, trough at fasting, gradual transitions everywhere
// peakCarbs derived from TDEE + training (not hardcoded)
function calculateCurvesForDay(cycleInfo, ketoStrictness, tdee) {
  const { cycleDay, cycleLength, boundaries } = cycleInfo;
  const { preFastDay, fastingStart, fastingEnd, ketoStart, ketoEnd } = boundaries;
  
  // Keto carb floor based on strictness (0=strict 20g, 100=relaxed 50g)
  const ketoFloor = 20 + (ketoStrictness / 100) * 30;  // 20-50g
  const ketoRoof = ketoFloor + 20;  // +20g by end of keto
  
  // Peak carbs derived from TDEE + training intensity
  // 45-55% of TDEE as carbs, scaled by training calories
  const carbPct = Math.min(0.55, 0.45);
  const peakCarbs = Math.round((tdee * carbPct) / 4);
  
  let calorieMultiplier, carbTarget;
  
  // === PRE-KETO PHASE (days 1 to ketoStart-1) ===
  // Day 1 = peak, then gradually decreasing toward keto
  // Pre-fast and fasting days are handled separately in applyMode_carbCycling
  if (cycleDay >= 1 && cycleDay < ketoStart) {
    const bufferPhaseLen = ketoStart - 1;
    const dayInBuffer = cycleDay - 1;  // 0-indexed
    const progress = dayInBuffer / Math.max(1, bufferPhaseLen - 1);  // 0 at day 1, 1 at last day
    
    // Calories: peak (115%) → declining toward pre-fast
    calorieMultiplier = 1.15 - (progress * 0.30);  // 115% → 85%
    
    // Carbs: peak → declining
    carbTarget = Math.round(peakCarbs - (progress * (peakCarbs - 60)));
  }
  
  // === KETO PHASE (ketoStart to ketoEnd) ===
  else if (cycleDay >= ketoStart && cycleDay <= ketoEnd) {
    const ketoLength = ketoEnd - ketoStart + 1;  // Include both endpoints
    const dayInKeto = cycleDay - ketoStart;  // 0-indexed
    
    if (dayInKeto === 0) {
      // First day after fasting: gentle 50%
      calorieMultiplier = 0.50;
      carbTarget = Math.round(ketoFloor);
    } else if (dayInKeto === 1) {
      // Second day: jump to 80%
      calorieMultiplier = 0.80;
      carbTarget = Math.round(ketoFloor + 3);
    } else {
      // Rest of keto: gradual increase from 80% → 95%
      const ketoProgress = Math.min(1, (dayInKeto - 1) / Math.max(1, ketoLength - 2));
      calorieMultiplier = 0.80 + (ketoProgress * 0.15);  // 80% → 95%
      
      // Carbs gradually increase from day 9 level to ketoRoof
      const carbStart = ketoFloor + 3;
      carbTarget = Math.round(carbStart + (ketoProgress * (ketoRoof - carbStart)));
    }
  }
  
  // === NORMAL PHASE (ketoEnd+1 to cycleLength) ===
  else if (cycleDay > ketoEnd) {
    const normalLength = cycleLength - ketoEnd;
    const dayInNormal = cycleDay - ketoEnd - 1;  // 0-indexed from day after ketoEnd
    const progress = Math.min(1, dayInNormal / Math.max(1, normalLength - 1));
    
    // Calories: continue climbing from 95% → 115% (approaching day 1 peak)
    calorieMultiplier = 0.95 + (progress * 0.20);  // 95% → 115%
    
    // Carbs: ramp up from keto roof toward peak
    carbTarget = Math.round(ketoRoof + (progress * (peakCarbs - ketoRoof)));
  }
  
  // Fallback (shouldn't hit this)
  else {
    calorieMultiplier = 1.0;
    carbTarget = 100;
  }
  
  return { calorieMultiplier, carbTarget };
}

// ============== SETTINGS ==============

app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM user_settings WHERE id = 1').get();
  res.json(settings || {});
});

app.put('/api/settings', (req, res) => {
  const { 
    weight_kg, height_cm, age, sex, goal, activity_level, carb_cycling_enabled, cycle_start_date, cycle_length,
    buffer_days, fasting_duration, activity_mult, training_cal, keto_strictness, protein_per_kg, max_cheat_sugar
  } = req.body;
  db.prepare(`
    INSERT OR REPLACE INTO user_settings (
      id, weight_kg, height_cm, age, sex, goal, activity_level, carb_cycling_enabled, cycle_start_date, cycle_length,
      buffer_days, fasting_duration, activity_mult, training_cal, keto_strictness, protein_per_kg, max_cheat_sugar, updated_at
    )
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    weight_kg, height_cm, age, sex || 'female', goal, activity_level, carb_cycling_enabled ? 1 : 0, cycle_start_date, cycle_length,
    buffer_days ?? 5, fasting_duration ?? 2, activity_mult || 1.2, training_cal || 0, keto_strictness ?? 50, protein_per_kg || 1.6, max_cheat_sugar || 50
  );
  res.json({ success: true });
});

// ============== DAILY VIEW ==============

function handleDaily(req, res) {
  const dateStr = req.params.date || req.query.date || getTodayInUserTimezone();
  
  const settings = db.prepare('SELECT * FROM user_settings WHERE id = 1').get();
  const cycleInfo = getCycleInfo(dateStr, settings);
  const targets = getDailyTargets(settings, dateStr);
  const consumed = getDayTotals(dateStr);
  
  // Get meals for this day
  const meals = db.prepare(`
    SELECT m.id, m.meal_type, m.meal_time, m.notes, m.photo_url, m.title, m.confidence_pct
    FROM meals m WHERE SUBSTR(m.meal_time, 1, 10) = ? ORDER BY m.meal_time DESC
  `).all(dateStr);

  for (const meal of meals) {
    meal.items = db.prepare(`
      SELECT mi.id, mi.amount, mi.notes as item_notes, mi.confidence_pct,
             f.id as food_id, f.name as food_name, f.serving_unit,
             f.calories, f.protein_g, f.fat_g, f.carbs_g, f.fiber_g, f.sugar_g,
             (f.calories * mi.amount) as item_calories,
             (f.protein_g * mi.amount) as item_protein,
             (f.fat_g * mi.amount) as item_fat,
             (f.carbs_g * mi.amount) as item_carbs
      FROM meal_items mi JOIN foods f ON mi.food_id = f.id WHERE mi.meal_id = ?
    `).all(meal.id);
    meal.totals = getMealMacros(meal.id);
  }

  // Calculate daily composite confidence (weighted average by calories)
  let totalWeightedConfidence = 0;
  let totalCalories = 0;
  for (const meal of meals) {
    const mealCal = meal.totals?.calories || 0;
    const mealConf = meal.confidence_pct ?? 0.5;
    totalWeightedConfidence += mealCal * mealConf;
    totalCalories += mealCal;
  }
  const dailyConfidence = totalCalories > 0 ? totalWeightedConfidence / totalCalories : null;
  
  const progress = {
    calories: { consumed: consumed.calories, target: targets.calories, remaining: targets.calories - consumed.calories },
    protein: { consumed: consumed.protein_g, target: targets.protein_g, remaining: targets.protein_g - consumed.protein_g },
    fat: { consumed: consumed.fat_g, target: targets.fat_g, remaining: targets.fat_g - consumed.fat_g },
    carbs: { consumed: consumed.carbs_g, target: targets.carbs_g, remaining: targets.carbs_g - consumed.carbs_g },
    fiber: { consumed: consumed.fiber_g, target: targets.fiber_g, remaining: targets.fiber_g - consumed.fiber_g },
    sugar: { consumed: consumed.sugar_g, target: targets.sugar_g, remaining: targets.sugar_g - consumed.sugar_g }
  };
  
  res.json({ date: dateStr, cycle: cycleInfo, targets, consumed, progress, meals, settings, dailyConfidence });
}

app.get('/api/daily/:date', handleDaily);
app.get('/api/daily', handleDaily);

// ============== WEEK VIEW ==============

function handleWeek(req, res) {
  const dateStr = req.params.date || req.query.date || getTodayInUserTimezone();
  const days = parseInt(req.query.days) || 7;
  const settings = db.prepare('SELECT * FROM user_settings WHERE id = 1').get();
  
  const data = [];
  const baseDate = new Date(dateStr + 'T12:00:00Z');
  
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split('T')[0];
    
    const cycleInfo = getCycleInfo(dayStr, settings);
    const targets = getDailyTargets(settings, dayStr);
    const consumed = getDayTotals(dayStr);
    
    data.push({
      date: dayStr,
      cycle: cycleInfo,
      targets,
      consumed,
      isToday: dayStr === getTodayInUserTimezone()
    });
  }
  
  res.json(data);
}

app.get('/api/week/:date', handleWeek);
app.get('/api/week', handleWeek);

// ============== FOODS ==============

app.get('/api/foods', (req, res) => {
  const search = req.query.search;
  let foods;
  if (search) {
    foods = db.prepare('SELECT * FROM foods WHERE name LIKE ? ORDER BY name').all(`%${search}%`);
  } else {
    foods = db.prepare('SELECT * FROM foods ORDER BY name').all();
  }
  res.json(foods);
});

app.get('/api/foods/:id', (req, res) => {
  const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id);
  if (!food) return res.status(404).json({ error: 'Food not found' });
  res.json(food);
});

app.post('/api/foods', (req, res) => {
  const { name, serving_unit, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  
  try {
    const result = db.prepare(`
      INSERT INTO foods (name, serving_unit, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, serving_unit || 'g', calories || 0, protein_g || 0, fat_g || 0, carbs_g || 0, fiber_g || 0, sugar_g || 0);
    
    const newFood = db.prepare('SELECT * FROM foods WHERE id = ?').get(result.lastInsertRowid);
    
    // DIQQ: Enrich new food with micronutrient data (async, non-blocking)
    if (diqq) {
      diqq.onFoodAdded(db, result.lastInsertRowid).catch(err => {
        console.error('DIQQ enrichment error:', err);
      });
    }
    
    res.json(newFood);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Food already exists' });
    throw e;
  }
});

app.put('/api/foods/:id', (req, res) => {
  const { name, serving_unit, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g } = req.body;
  db.prepare(`
    UPDATE foods SET name=?, serving_unit=?, calories=?, protein_g=?, fat_g=?, carbs_g=?, fiber_g=?, sugar_g=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, serving_unit, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g, req.params.id);
  res.json(db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id));
});

app.delete('/api/foods/:id', (req, res) => {
  db.prepare('DELETE FROM foods WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============== MEALS ==============

app.get('/api/meals', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const offset = parseInt(req.query.offset) || 0;
  
  const meals = db.prepare(`
    SELECT m.id, m.meal_type, m.meal_time, m.notes, m.photo_url, m.created_at, m.title
    FROM meals m ORDER BY m.meal_time DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  
  for (const meal of meals) {
    meal.items = db.prepare(`
      SELECT mi.id, mi.amount, f.id as food_id, f.name as food_name
      FROM meal_items mi JOIN foods f ON mi.food_id = f.id WHERE mi.meal_id = ?
    `).all(meal.id);
    meal.totals = getMealMacros(meal.id);
  }
  
  const total = db.prepare('SELECT COUNT(*) as count FROM meals').get();
  res.json({ meals, total: total.count, limit, offset });
});

app.get('/api/meals/:id', (req, res) => {
  const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id);
  if (!meal) return res.status(404).json({ error: 'Meal not found' });
  
  meal.items = db.prepare(`
    SELECT mi.id, mi.amount, mi.notes as item_notes,
           f.id as food_id, f.name as food_name, f.serving_unit,
           f.calories, f.protein_g, f.fat_g, f.carbs_g, f.fiber_g, f.sugar_g
    FROM meal_items mi JOIN foods f ON mi.food_id = f.id WHERE mi.meal_id = ?
  `).all(meal.id);
  meal.totals = getMealMacros(meal.id);
  res.json(meal);
});

app.post('/api/meals', (req, res) => {
  const { meal_type, meal_time, notes, items, title } = req.body;
  if (!meal_type || !meal_time) return res.status(400).json({ error: 'meal_type and meal_time required' });
  
  // Validate meal_time includes a date (not just time like "12:50")
  // Valid formats: "2026-02-02 12:50:00", "2026-02-02T12:50", "2026-02-02 12:50"
  const datePattern = /^\d{4}-\d{2}-\d{2}[\sT]/;
  if (!datePattern.test(meal_time)) {
    return res.status(400).json({ 
      error: 'meal_time must include a date', 
      hint: 'Expected format: YYYY-MM-DD HH:MM (e.g., "2026-02-02 12:50")',
      received: meal_time
    });
  }
  
  // Normalize meal_time: strip timezone offsets, replace T with space, ensure consistent format
  const normalized_meal_time = meal_time
    .replace(/T/, ' ')                    // 2026-02-05T14:00 → 2026-02-05 14:00
    .replace(/[+-]\d{2}:\d{2}$/, '')      // strip +11:00 or -05:00
    .replace(/Z$/, '')                     // strip Z
    .replace(/\.\d+$/, '')                 // strip .000
    .trim();
  
  const result = db.prepare('INSERT INTO meals (meal_type, meal_time, notes, title) VALUES (?, ?, ?, ?)').run(meal_type, normalized_meal_time, notes, title);
  const mealId = result.lastInsertRowid;
  
  if (items && Array.isArray(items)) {
    const ins = db.prepare('INSERT INTO meal_items (meal_id, food_id, amount, actual_grams, notes) VALUES (?, ?, ?, ?, ?)');
    for (const item of items) {
      const amount = item.amount || 1;
      const actualGrams = item.actual_grams || (amount > 10 ? amount : null); // Auto-set if amount looks like grams
      ins.run(mealId, item.food_id, amount, actualGrams, item.notes);
    }
  }
  
  // 🔍 Post-save sanity validation
  const validation = validateMealSanity(mealId);
  
  const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(mealId);
  meal.items = db.prepare('SELECT mi.*, f.name as food_name FROM meal_items mi JOIN foods f ON mi.food_id = f.id WHERE mi.meal_id = ?').all(mealId);
  meal.totals = getMealMacros(mealId);
  meal.validation = validation; // Include validation results in response
  
  res.json(meal);
});

app.put('/api/meals/:id', (req, res) => {
  const { meal_type, meal_time, notes, title } = req.body;
  const norm_time = meal_time ? meal_time.replace(/T/, ' ').replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '').replace(/\.\d+$/, '').trim() : meal_time;
  db.prepare('UPDATE meals SET meal_type=?, meal_time=?, notes=?, title=? WHERE id=?').run(meal_type, norm_time, notes, title, req.params.id);
  res.json(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id));
});

app.delete('/api/meals/:id', (req, res) => {
  db.prepare('DELETE FROM meal_items WHERE meal_id = ?').run(req.params.id);
  db.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============== MEAL ITEMS ==============

app.post('/api/meals/:mealId/items', (req, res) => {
  const { food_id, amount, actual_grams, notes } = req.body;
  if (!food_id) return res.status(400).json({ error: 'food_id required' });
  
  const amt = amount || 1;
  const grams = actual_grams || (amt > 10 ? amt : null); // Auto-set if amount looks like grams
  
  const result = db.prepare('INSERT INTO meal_items (meal_id, food_id, amount, actual_grams, notes) VALUES (?, ?, ?, ?, ?)').run(req.params.mealId, food_id, amt, grams, notes);
  
  // 🔍 Post-save sanity validation
  const validation = validateMealSanity(parseInt(req.params.mealId));
  
  const item = db.prepare('SELECT mi.*, f.name as food_name FROM meal_items mi JOIN foods f ON mi.food_id = f.id WHERE mi.id = ?').get(result.lastInsertRowid);
  item.validation = validation;
  res.json(item);
});

app.put('/api/meal-items/:id', (req, res) => {
  const { amount, notes } = req.body;
  db.prepare('UPDATE meal_items SET amount=?, notes=? WHERE id=?').run(amount, notes, req.params.id);
  res.json(db.prepare('SELECT mi.*, f.name as food_name FROM meal_items mi JOIN foods f ON mi.food_id = f.id WHERE mi.id = ?').get(req.params.id));
});

app.delete('/api/meal-items/:id', (req, res) => {
  db.prepare('DELETE FROM meal_items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============== HISTORY ==============

app.get('/api/history', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const data = db.prepare(`
    SELECT SUBSTR(m.meal_time, 1, 10) as period, COUNT(DISTINCT m.id) as meal_count,
      COALESCE(SUM(f.calories * mi.amount), 0) as calories,
      COALESCE(SUM(f.protein_g * mi.amount), 0) as protein_g,
      COALESCE(SUM(f.fat_g * mi.amount), 0) as fat_g,
      COALESCE(SUM(f.carbs_g * mi.amount), 0) as carbs_g,
      COALESCE(SUM(f.fiber_g * mi.amount), 0) as fiber_g,
      COALESCE(SUM(f.sugar_g * mi.amount), 0) as sugar_g
    FROM meals m
    LEFT JOIN meal_items mi ON m.id = mi.meal_id
    LEFT JOIN foods f ON mi.food_id = f.id
    WHERE SUBSTR(m.meal_time, 1, 10) >= DATE('now', '-' || ? || ' days')
    GROUP BY SUBSTR(m.meal_time, 1, 10) ORDER BY period DESC
  `).all(days);
  res.json(data);
});

// ============== AUDIT (stub) ==============
app.get('/api/audit', (req, res) => res.json({ total_issues: 0, issues: [] }));

// ============== DIQQ - Data Quality Control ==============
app.get('/api/diqq/status', (req, res) => {
  // Only flag NULL as missing - 0 is a valid value (e.g., olive oil has 0 calcium)
  const incomplete = db.prepare(`
    SELECT COUNT(*) as count FROM foods 
    WHERE calcium_mg IS NULL
       OR iron_mg IS NULL
       OR potassium_mg IS NULL
       OR vitamin_c_mg IS NULL
  `).get();
  res.json({ 
    active: !!diqq, 
    foods_needing_enrichment: incomplete.count 
  });
});

app.post('/api/diqq/scan', async (req, res) => {
  if (!diqq) return res.status(503).json({ error: 'DIQQ not available' });
  try {
    const results = await diqq.qualityControlScan(db);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/diqq/enrich/:id', async (req, res) => {
  if (!diqq) return res.status(503).json({ error: 'DIQQ not available' });
  const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id);
  if (!food) return res.status(404).json({ error: 'Food not found' });
  try {
    const result = await diqq.enrichFood(db, food);
    const updated = db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id);
    res.json({ ...result, food: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============== MEAL VALIDATION LOG ==============
app.get('/api/validation/log', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  try {
    if (!fs.existsSync(VALIDATION_LOG)) {
      return res.json({ entries: [], total: 0 });
    }
    
    const content = fs.readFileSync(VALIDATION_LOG, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);
    const entries = lines.slice(-limit).map(line => {
      try { return JSON.parse(line); } 
      catch { return null; }
    }).filter(e => e);
    
    // Filter to only entries with issues
    const issuesOnly = req.query.issues === 'true';
    const filtered = issuesOnly 
      ? entries.filter(e => e.issues && e.issues.length > 0)
      : entries;
    
    res.json({ 
      entries: filtered.reverse(), 
      total: lines.length,
      withIssues: entries.filter(e => e.issues && e.issues.length > 0).length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/validation/recheck/:mealId', (req, res) => {
  const mealId = parseInt(req.params.mealId);
  const validation = validateMealSanity(mealId);
  res.json(validation);
});

// ============== UNIT WEIGHTS ==============

app.get('/api/unit-weights', (req, res) => {
  const foodId = req.query.food_id;
  if (foodId) {
    const rows = db.prepare(`
      SELECT uw.*, f.name as food_name
      FROM unit_weights uw JOIN foods f ON uw.food_id = f.id
      WHERE uw.food_id = ? ORDER BY uw.unit
    `).all(foodId);
    return res.json(rows);
  }
  const rows = db.prepare(`
    SELECT uw.*, f.name as food_name
    FROM unit_weights uw JOIN foods f ON uw.food_id = f.id
    ORDER BY f.name, uw.unit
  `).all();
  res.json(rows);
});

app.get('/api/unit-weights/:foodId', (req, res) => {
  const rows = db.prepare(`
    SELECT uw.*, f.name as food_name
    FROM unit_weights uw JOIN foods f ON uw.food_id = f.id
    WHERE uw.food_id = ? ORDER BY uw.unit
  `).all(req.params.foodId);
  res.json(rows);
});

app.post('/api/unit-weights', (req, res) => {
  const { food_id, unit, grams, source } = req.body;
  if (!food_id || !unit || grams == null) {
    return res.status(400).json({ error: 'food_id, unit, and grams required' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO unit_weights (food_id, unit, grams, source) VALUES (?, ?, ?, ?)'
    ).run(food_id, unit.toLowerCase(), grams, source || 'manual');
    res.json(db.prepare('SELECT * FROM unit_weights WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Unit weight already exists for this food+unit' });
    }
    throw e;
  }
});

app.put('/api/unit-weights/:id', (req, res) => {
  const { grams, source } = req.body;
  db.prepare('UPDATE unit_weights SET grams=?, source=? WHERE id=?')
    .run(grams, source, req.params.id);
  const row = db.prepare('SELECT * FROM unit_weights WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.delete('/api/unit-weights/:id', (req, res) => {
  db.prepare('DELETE FROM unit_weights WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============== DECISION LOG ==============

app.get('/api/decision-log', (req, res) => {
  const { entity_type, entity_id, agent, limit: lim } = req.query;
  const limit = Math.min(parseInt(lim) || 100, 500);
  let sql = 'SELECT * FROM decision_log WHERE 1=1';
  const params = [];

  if (entity_type) { sql += ' AND entity_type = ?'; params.push(entity_type); }
  if (entity_id) { sql += ' AND entity_id = ?'; params.push(entity_id); }
  if (agent) { sql += ' AND agent = ?'; params.push(agent); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  res.json(db.prepare(sql).all(...params));
});

app.get('/api/decision-log/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM decision_log WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/decision-log', (req, res) => {
  const { entity_type, entity_id, agent, action, details, model_used, confidence_pct } = req.body;
  if (!entity_type || !agent || !action) {
    return res.status(400).json({ error: 'entity_type, agent, and action required' });
  }
  const result = db.prepare(`
    INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used, confidence_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entity_type, entity_id || 0, agent, action,
    typeof details === 'object' ? JSON.stringify(details) : details,
    model_used, confidence_pct
  );
  res.json(db.prepare('SELECT * FROM decision_log WHERE id = ?').get(result.lastInsertRowid));
});

// ============== KNOWN DECOMPOSITIONS ==============

app.get('/api/decompositions', (req, res) => {
  const search = req.query.search;
  if (search) {
    const rows = db.prepare(
      'SELECT * FROM known_decompositions WHERE meal_name LIKE ? ORDER BY meal_name'
    ).all(`%${search}%`);
    return res.json(rows);
  }
  res.json(db.prepare('SELECT * FROM known_decompositions ORDER BY meal_name').all());
});

app.get('/api/decompositions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM known_decompositions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  row.ingredients = JSON.parse(row.ingredients);
  res.json(row);
});

app.post('/api/decompositions', (req, res) => {
  const { meal_name, ingredients, source } = req.body;
  if (!meal_name || !ingredients) {
    return res.status(400).json({ error: 'meal_name and ingredients required' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO known_decompositions (meal_name, ingredients, source) VALUES (?, ?, ?)'
    ).run(
      meal_name.toLowerCase(),
      typeof ingredients === 'object' ? JSON.stringify(ingredients) : ingredients,
      source || 'manual'
    );
    res.json(db.prepare('SELECT * FROM known_decompositions WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Decomposition already exists for this meal name' });
    }
    throw e;
  }
});

app.put('/api/decompositions/:id', (req, res) => {
  const { meal_name, ingredients, source } = req.body;
  db.prepare(
    'UPDATE known_decompositions SET meal_name=?, ingredients=?, source=? WHERE id=?'
  ).run(
    meal_name?.toLowerCase(),
    typeof ingredients === 'object' ? JSON.stringify(ingredients) : ingredients,
    source,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM known_decompositions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.delete('/api/decompositions/:id', (req, res) => {
  db.prepare('DELETE FROM known_decompositions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============== PIPELINE ==============

app.post('/api/pipeline/process', async (req, res) => {
  const { input, context } = req.body;
  if (!input) return res.status(400).json({ error: 'input required' });

  try {
    const Pipeline = require('../lib/pipeline');
    const pipeline = new Pipeline(db);
    const result = await pipeline.process(input, context || {});
    res.json(result);
  } catch (err) {
    console.error('Pipeline error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pipeline/commit', async (req, res) => {
  const { processedMeal } = req.body;
  if (!processedMeal) return res.status(400).json({ error: 'processedMeal required' });

  try {
    const Pipeline = require('../lib/pipeline');
    const pipeline = new Pipeline(db);
    const result = await pipeline.commit(processedMeal);
    res.json(result);
  } catch (err) {
    console.error('Pipeline commit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload a photo and attach it to a meal
app.post('/api/meals/:mealId/photo', express.raw({ type: 'image/*', limit: '10mb' }), (req, res) => {
  try {
    const mealId = parseInt(req.params.mealId);
    const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(mealId);
    if (!meal) return res.status(404).json({ error: 'Meal not found' });

    const photos = require('../lib/photos');
    const contentType = req.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    const photoUrl = photos.savePhotoFromBuffer(req.body, ext, { mealId: String(mealId) });

    db.prepare('UPDATE meals SET photo_url = ? WHERE id = ?').run(photoUrl, mealId);
    res.json({ photo_url: photoUrl });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Attach a photo by file path (internal use — e.g., from bot downloads)
app.post('/api/meals/:mealId/photo-from-path', (req, res) => {
  try {
    const mealId = parseInt(req.params.mealId);
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });

    const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(mealId);
    if (!meal) return res.status(404).json({ error: 'Meal not found' });

    const photos = require('../lib/photos');
    const photoUrl = photos.savePhoto(filePath, { mealId: String(mealId) });
    if (!photoUrl) return res.status(400).json({ error: 'Could not save photo — file not found' });

    db.prepare('UPDATE meals SET photo_url = ? WHERE id = ?').run(photoUrl, mealId);
    res.json({ photo_url: photoUrl });
  } catch (err) {
    console.error('Photo from path error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pipeline/status/:mealId', (req, res) => {
  const mealId = parseInt(req.params.mealId);
  const decisions = db.prepare(
    'SELECT * FROM decision_log WHERE entity_id = ? ORDER BY created_at ASC'
  ).all(mealId);

  const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(mealId);
  if (!meal) return res.status(404).json({ error: 'Meal not found' });

  const items = db.prepare(`
    SELECT mi.*, f.name as food_name
    FROM meal_items mi JOIN foods f ON mi.food_id = f.id
    WHERE mi.meal_id = ?
  `).all(mealId);

  res.json({
    meal,
    items,
    decisions,
    composite_confidence: meal.confidence_pct,
    item_confidences: items.map(i => ({
      food: i.food_name,
      confidence: i.confidence_pct,
      parsing_source: i.parsing_source
    }))
  });
});

// ============== PIPELINE REQUESTS (audit trail) ==============

// List all pipeline requests (with filters)
app.get('/api/pipeline/requests', (req, res) => {
  const { status, limit = 50 } = req.query;
  let sql = 'SELECT * FROM pipeline_requests';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  res.json(db.prepare(sql).all(...params));
});

// Get pipeline request stats
app.get('/api/pipeline/requests/stats', (req, res) => {
  const days = parseInt(req.query.days || 7);
  const Pipeline = require('../lib/pipeline');
  const pipeline = new Pipeline(db);
  res.json(pipeline.getRequestStats(days));
});

// Sweep: find stale unconfirmed requests
app.get('/api/pipeline/sweep/stale', (req, res) => {
  const minutes = parseInt(req.query.minutes || 30);
  const Pipeline = require('../lib/pipeline');
  const pipeline = new Pipeline(db);
  res.json(pipeline.sweepStaleRequests(minutes));
});

// Sweep: find committed meals needing audit
app.get('/api/pipeline/sweep/audit', (req, res) => {
  const threshold = parseFloat(req.query.threshold || 0.6);
  const Pipeline = require('../lib/pipeline');
  const pipeline = new Pipeline(db);
  res.json(pipeline.sweepForAudit(threshold));
});

// Mark a request as followed up
app.post('/api/pipeline/requests/:id/followup', (req, res) => {
  const Pipeline = require('../lib/pipeline');
  const pipeline = new Pipeline(db);
  pipeline.markFollowedUp(parseInt(req.params.id));
  res.json({ ok: true });
});

// Mark a request as abandoned
app.post('/api/pipeline/requests/:id/abandon', (req, res) => {
  const Pipeline = require('../lib/pipeline');
  const pipeline = new Pipeline(db);
  pipeline.markAbandoned(parseInt(req.params.id));
  res.json({ ok: true });
});

// Expire all over-followed requests
app.post('/api/pipeline/sweep/expire', (req, res) => {
  const Pipeline = require('../lib/pipeline');
  const pipeline = new Pipeline(db);
  const expired = pipeline.expireStaleRequests();
  res.json({ expired });
});

// ============== PIGEONS (audit workers) ==============

// Audit a single meal
app.post('/api/pigeon/audit/:mealId', (req, res) => {
  const Pigeon = require('../lib/pigeon');
  const pigeon = new Pigeon(db);
  const report = pigeon.audit(parseInt(req.params.mealId));
  res.json(report);
});

// Chase a stale request
app.post('/api/pigeon/chase/:requestId', (req, res) => {
  const Pigeon = require('../lib/pigeon');
  const pigeon = new Pigeon(db);
  const result = pigeon.chase(parseInt(req.params.requestId));
  res.json(result);
});

// Flock: batch audit sweep (HAYDEN calls this)
app.post('/api/pigeon/flock', (req, res) => {
  const Pigeon = require('../lib/pigeon');
  const pigeon = new Pigeon(db);
  const options = req.body || {};
  const result = pigeon.flock(options);
  res.json(result);
});

// ============== AGENT REPORTS ==============
// Communication channel from background agents to PA

// POST /api/reports — Agents write reports here
app.post('/api/reports', (req, res) => {
  const { agent, severity = 'info', category, summary, details, for_human = 0 } = req.body;

  if (!agent || !summary) {
    return res.status(400).json({ error: 'agent and summary are required' });
  }

  const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];
  if (!validSeverities.includes(severity)) {
    return res.status(400).json({ error: `severity must be one of: ${validSeverities.join(', ')}` });
  }

  const result = db.prepare(`
    INSERT INTO agent_reports (agent, severity, category, summary, details, for_human)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(agent, severity, category, summary, JSON.stringify(details), for_human ? 1 : 0);

  res.status(201).json({ id: result.lastInsertRowid, created: true });
});

// GET /api/reports/pending — PA fetches unacknowledged reports
app.get('/api/reports/pending', (req, res) => {
  const { severity, agent, limit = 50 } = req.query;

  let sql = 'SELECT * FROM agent_reports WHERE acknowledged_at IS NULL';
  const params = [];

  if (severity) {
    sql += ' AND severity = ?';
    params.push(severity);
  }
  if (agent) {
    sql += ' AND agent = ?';
    params.push(agent);
  }

  sql += " ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, created_at ASC";
  sql += ' LIMIT ?';
  params.push(parseInt(limit));

  const reports = db.prepare(sql).all(...params);

  // Parse JSON details
  reports.forEach(r => {
    if (r.details) try { r.details = JSON.parse(r.details); } catch (e) {}
  });

  res.json({ count: reports.length, reports });
});

// PUT /api/reports/:id/ack — PA acknowledges after processing
app.put('/api/reports/:id/ack', (req, res) => {
  const { resolution } = req.body || {};

  const result = db.prepare(`
    UPDATE agent_reports
    SET acknowledged_at = datetime('now'), resolution = ?
    WHERE id = ? AND acknowledged_at IS NULL
  `).run(resolution || null, req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Report not found or already acknowledged' });
  }

  res.json({ acknowledged: true });
});

// GET /api/reports — List all reports (with filters)
app.get('/api/reports', (req, res) => {
  const { agent, severity, acknowledged, days = 7, limit = 100 } = req.query;

  let sql = "SELECT * FROM agent_reports WHERE created_at > datetime('now', ?)";
  const params = [`-${days} days`];

  if (agent) { sql += ' AND agent = ?'; params.push(agent); }
  if (severity) { sql += ' AND severity = ?'; params.push(severity); }
  if (acknowledged === 'true') { sql += ' AND acknowledged_at IS NOT NULL'; }
  if (acknowledged === 'false') { sql += ' AND acknowledged_at IS NULL'; }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const reports = db.prepare(sql).all(...params);
  reports.forEach(r => { if (r.details) try { r.details = JSON.parse(r.details); } catch (e) {} });

  res.json({ count: reports.length, reports });
});

// ============== HEALTH ==============
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// SPA fallback
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`🔥 FUEL v3 running on http://${HOST}:${PORT}`));
