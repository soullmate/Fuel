/**
 * DIQQ - Data Ingestion Quality Control
 * Ensures all foods have complete macro and micro nutritional data
 * 
 * Fallback chain:
 * 1. USDA FoodData Central (exact search)
 * 2. USDA with simplified name (remove "raw", "cooked", parentheses)
 * 3. Local database (find similar food)
 * 4. Open Food Facts (free API, no key needed)
 * 5. Nutritionix (via web scrape)
 */

require('dotenv').config();

const USDA_API_KEY = process.env.USDA_API_KEY;
const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';
const PA_REPORT_URL = process.env.FUEL_API_BASE || 'http://localhost:3456';

if (!USDA_API_KEY) {
  console.warn('DIQQ: Warning - USDA_API_KEY not set. Copy .env.example to .env and add your key.');
}

/**
 * Report to Personal Assistant via agent_reports table
 */
async function reportToPA(severity, summary, details, forHuman = false) {
  try {
    const response = await fetch(`${PA_REPORT_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'diqq',
        severity,
        category: 'data_quality',
        summary,
        details,
        for_human: forHuman ? 1 : 0
      })
    });
    if (!response.ok) {
      console.log(`   ⚠️  Could not report to PA: ${await response.text()}`);
    }
  } catch (err) {
    // Don't fail enrichment if reporting fails
    console.log(`   ⚠️  Could not report to PA: ${err.message}`);
  }
}

// Nutrient IDs from USDA FoodData Central
const NUTRIENT_MAP = {
  1008: 'calories',
  1003: 'protein_g',
  1004: 'fat_g',
  1005: 'carbs_g',
  1079: 'fiber_g',
  2000: 'sugar_g',
  1093: 'sodium_mg',
  1092: 'potassium_mg',
  1087: 'calcium_mg',
  1089: 'iron_mg',
  1106: 'vitamin_a_mcg',
  1162: 'vitamin_c_mg',
  1114: 'vitamin_d_mcg',
  1178: 'vitamin_b12_mcg',
  1090: 'magnesium_mg',
  1095: 'zinc_mg',
  1292: 'omega_3_g',
  // Amino acids (detail endpoint uses 1210+ IDs)
  1221: 'histidine_g',
  1212: 'isoleucine_g',
  1213: 'leucine_g',
  1214: 'lysine_g',
  1215: 'methionine_g',
  1217: 'phenylalanine_g',
  1211: 'threonine_g',
  1210: 'tryptophan_g',
  1219: 'valine_g',
};

const FIELDS_TO_CHECK = [
  'calories', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sugar_g',
  'sodium_mg', 'potassium_mg', 'calcium_mg', 'iron_mg',
  'vitamin_a_mcg', 'vitamin_c_mg', 'vitamin_d_mcg', 'vitamin_b12_mcg',
  'magnesium_mg', 'zinc_mg', 'omega_3_g',
  'histidine_g', 'isoleucine_g', 'leucine_g', 'lysine_g', 'methionine_g',
  'phenylalanine_g', 'threonine_g', 'tryptophan_g', 'valine_g'
];

/**
 * Food name synonyms (regional/alternate names -> USDA standard)
 */
const FOOD_SYNONYMS = {
  'capsicum': 'bell pepper',
  'aubergine': 'eggplant',
  'courgette': 'zucchini',
  'coriander': 'cilantro',
  'rocket': 'arugula',
  'spring onion': 'green onion',
  'mince': 'ground beef',
  'prawns': 'shrimp',
  'chips': 'french fries',
  'crisps': 'potato chips',
  'biscuits': 'cookies',
  'porridge': 'oatmeal',
  'treacle': 'molasses',
};

/**
 * Convert regional food name to USDA-friendly name
 */
function toUSDAName(name) {
  let result = name.toLowerCase();
  for (const [regional, usda] of Object.entries(FOOD_SYNONYMS)) {
    result = result.replace(new RegExp(`\\b${regional}\\b`, 'gi'), usda);
  }
  return result;
}

/**
 * Simplify food name for better search matching
 * "lentils (cooked)" -> "lentils"
 * "swiss brown mushrooms (raw)" -> "brown mushrooms"
 */
function simplifyFoodName(name) {
  let simplified = name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // Remove parentheses and contents
    .replace(/\b(raw|cooked|fresh|frozen|canned|dried|organic)\b/gi, '')
    .replace(/\b(swiss|australian|american|italian|french)\b/gi, '')  // Remove origin words
    .replace(/\s+/g, ' ')
    .trim();
  
  // Convert to USDA name
  return toUSDAName(simplified);
}

/**
 * Extract base food word for local matching
 * "swiss brown mushrooms" -> "mushroom"
 */
function getBaseFoodWord(name) {
  const simplified = simplifyFoodName(name);
  const words = simplified.split(' ');
  // Return last word (usually the main food) in singular form
  let base = words[words.length - 1];
  if (base.endsWith('es')) base = base.slice(0, -2);
  else if (base.endsWith('s')) base = base.slice(0, -1);
  return base;
}

/**
 * Check if USDA match is appropriate (not oil when searching for whole food)
 */
function isGoodMatch(searchTerm, matchDescription) {
  const search = searchTerm.toLowerCase();
  const match = matchDescription.toLowerCase();
  const searchBase = getBaseFoodWord(search);
  
  // If searching for oil, make sure it's the right oil
  const isSearchingForOil = search.includes('oil');
  const matchIsOil = match.startsWith('oil,') || match.includes(' oil,') || match.includes(' oil ');
  
  if (isSearchingForOil) {
    // Get the oil type (word before "oil")
    const oilTypeMatch = search.match(/(\w+)\s+oil/);
    const oilType = oilTypeMatch ? oilTypeMatch[1] : '';
    
    if (oilType) {
      // Reject blends - if match contains multiple oil types or "and", it's a blend
      if (match.includes(' and ') || match.includes(',')) {
        // Check if it's primarily our oil type (should start with "oil, <type>")
        const expectedPattern = `oil, ${oilType}`;
        if (!match.startsWith(expectedPattern)) {
          return false; // It's a blend, reject
        }
      }
      // Must contain our oil type
      if (!match.includes(oilType)) {
        return false;
      }
    }
    return true;
  }
  
  // If searching for whole food but got oil, reject
  if (matchIsOil) {
    return false;
  }
  
  // For eggs, allow egg-related matches
  if (searchBase === 'egg') {
    return match.includes('egg');
  }
  
  // If searching for whole food but got powder/flour/extract, be cautious
  const processedTerms = ['powder', 'flour', 'extract', 'juice', 'concentrate'];
  const searchHasProcessed = processedTerms.some(t => search.includes(t));
  const matchHasProcessed = processedTerms.some(t => match.includes(t));
  
  if (!searchHasProcessed && matchHasProcessed) {
    // Allow if the base food matches well
    if (!match.includes(searchBase)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Food state modifiers - grouped by category
 */
const FOOD_MODIFIERS = {
  // Concentrated forms (per 100g nutrients are very different)
  concentrated: ['powder', 'dried', 'dehydrated', 'freeze-dried', 'concentrate', 'extract', 'paste'],
  
  // Cooking methods (affects some vitamins)
  cooked: ['cooked', 'boiled', 'steamed', 'fried', 'baked', 'roasted', 'grilled', 'sauteed', 
           'braised', 'poached', 'stir-fried', 'microwaved', 'smoked', 'toasted'],
  
  // Preservation methods
  preserved: ['canned', 'pickled', 'preserved', 'fermented', 'cured', 'frozen'],
  
  // Liquid forms
  liquid: ['juice', 'puree', 'mashed', 'blended', 'smoothie'],
  
  // Nut/seed states
  nutState: ['shelled', 'unshelled', 'in-shell', 'blanched', 'dry-roasted', 'salted', 'unsalted'],
  
  // Fruit/veg states
  produceState: ['peeled', 'unpeeled', 'skin-on', 'skinless', 'pitted', 'seeded', 'seedless', 'ripe'],
  
  // Meat states
  meatState: ['lean', 'extra-lean', 'fatty', 'boneless', 'bone-in', 'ground', 'minced', 'fillet', 'steak'],
  
  // Dairy fat content
  dairyState: ['whole', 'skim', 'low-fat', 'non-fat', 'full-fat', 'reduced-fat'],
  
  // Fresh/raw (preferred default)
  fresh: ['raw', 'fresh', 'uncooked'],
};

/**
 * Find which modifier category a term belongs to
 */
function findModifierCategory(term) {
  for (const [category, terms] of Object.entries(FOOD_MODIFIERS)) {
    if (terms.some(t => term.includes(t))) {
      return { category, term: terms.find(t => term.includes(t)) };
    }
  }
  return null;
}

/**
 * Score a USDA match - higher is better
 */
function scoreUSDAMatch(searchTerm, matchDescription) {
  const search = searchTerm.toLowerCase();
  const match = matchDescription.toLowerCase();
  let score = 100; // Base score
  
  // Find what modifiers are in search and match
  const searchMod = findModifierCategory(search);
  const matchMod = findModifierCategory(match);
  
  // === MODIFIER MATCHING ===
  
  if (searchMod) {
    // User specified a modifier - try to match it
    if (matchMod && matchMod.category === searchMod.category) {
      if (matchMod.term === searchMod.term) {
        score += 50; // Exact modifier match
      } else {
        score += 20; // Same category at least
      }
    } else if (!matchMod && searchMod.category !== 'fresh') {
      score -= 30; // Wanted specific state but got generic
    }
  } else {
    // User didn't specify - prefer fresh/raw, penalize processed
    if (matchMod) {
      if (matchMod.category === 'fresh') {
        score += 30; // Raw/fresh is good default
      } else if (matchMod.category === 'concentrated') {
        score -= 50; // Powder/dried has very different nutrition
      } else if (matchMod.category === 'liquid') {
        score -= 40; // Juice is different from whole
      } else if (matchMod.category === 'cooked') {
        score += 5; // Cooked is acceptable
      } else if (matchMod.category === 'preserved') {
        score -= 20; // Canned/pickled is less preferred
      }
    }
  }
  
  // === OTHER PENALTIES ===
  
  // Oil penalty (unless searching for oil)
  if (!search.includes('oil') && (match.startsWith('oil,') || match.includes(' oil'))) {
    score -= 80;
  }
  
  // Spice/seasoning penalty for fresh vegetables
  if (!search.includes('spice') && !search.includes('seasoning')) {
    if (match.includes('spice') || match.includes('seasoning')) {
      score -= 40;
    }
  }
  
  // Baby food penalty (unless searching for baby food)
  if (!search.includes('baby') && match.includes('baby food')) {
    score -= 30;
  }
  
  // === BONUSES ===
  
  // Bonus if the match starts with our search term
  const searchBase = getBaseFoodWord(search);
  if (match.startsWith(searchBase) || match.startsWith(search)) {
    score += 25;
  }
  
  // Bonus for exact food name match
  if (match.includes(search) || search.includes(match.split(',')[0])) {
    score += 15;
  }
  
  return score;
}

/**
 * Find best USDA match from results, using scoring system
 */
function findBestUSDAMatch(searchTerm, results) {
  if (results.length === 0) return null;
  
  // Score all results
  const scored = results.map(r => ({
    ...r,
    score: scoreUSDAMatch(searchTerm, r.description)
  }));
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  // Log for debugging
  console.log(`DIQQ: Match scores for "${searchTerm}":`);
  scored.slice(0, 3).forEach(s => {
    console.log(`  ${s.score}: ${s.description}`);
  });
  
  // Return best match if it passes quality threshold
  const best = scored[0];
  if (best.score >= 50 && isGoodMatch(searchTerm, best.description)) {
    return best;
  }
  
  return null; // No good match found
}

/**
 * Search USDA database for a food
 */
async function searchUSDA(query) {
  if (!USDA_API_KEY) return [];
  try {
    const url = `${USDA_BASE_URL}/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=5&dataType=Foundation,SR Legacy`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`USDA API error: ${response.status}`);
    const data = await response.json();
    return data.foods || [];
  } catch (err) {
    console.error('DIQQ: USDA search failed:', err.message);
    return [];
  }
}

/**
 * Get detailed nutrients for a food by FDC ID
 */
async function getFoodDetails(fdcId) {
  try {
    const url = `${USDA_BASE_URL}/food/${fdcId}?api_key=${USDA_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`USDA API error: ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error('DIQQ: USDA details failed:', err.message);
    return null;
  }
}

/**
 * Extract nutrients from USDA food data (per 100g)
 */
function extractNutrients(usdaFood) {
  const nutrients = {};
  const foodNutrients = usdaFood.foodNutrients || [];
  
  for (const fn of foodNutrients) {
    const nutrientId = fn.nutrient?.id || fn.nutrientId;
    const fieldName = NUTRIENT_MAP[nutrientId];
    if (fieldName) {
      nutrients[fieldName] = fn.amount || fn.value || 0;
    }
  }
  return nutrients;
}

/**
 * Search Open Food Facts (free, no API key)
 */
async function searchOpenFoodFacts(query) {
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'DIQQ-FoodTracker/1.0' }
    });
    if (!response.ok) throw new Error(`OFF API error: ${response.status}`);
    const data = await response.json();
    return data.products || [];
  } catch (err) {
    console.error('DIQQ: Open Food Facts search failed:', err.message);
    return [];
  }
}

/**
 * Extract nutrients from Open Food Facts product (per 100g)
 */
function extractNutrientsFromOFF(product) {
  const n = product.nutriments || {};
  return {
    calories: n['energy-kcal_100g'] || n['energy-kcal'] || 0,
    protein_g: n.proteins_100g || n.proteins || 0,
    fat_g: n.fat_100g || n.fat || 0,
    carbs_g: n.carbohydrates_100g || n.carbohydrates || 0,
    fiber_g: n.fiber_100g || n.fiber || 0,
    sugar_g: n.sugars_100g || n.sugars || 0,
    sodium_mg: (n.sodium_100g || n.sodium || 0) * 1000, // Convert g to mg
    potassium_mg: (n.potassium_100g || n.potassium || 0) * 1000,
    calcium_mg: (n.calcium_100g || n.calcium || 0) * 1000,
    iron_mg: (n.iron_100g || n.iron || 0) * 1000,
    vitamin_a_mcg: (n['vitamin-a_100g'] || 0) * 1000000, // Convert g to mcg
    vitamin_c_mg: (n['vitamin-c_100g'] || 0) * 1000,
    vitamin_d_mcg: (n['vitamin-d_100g'] || 0) * 1000000,
    magnesium_mg: (n.magnesium_100g || 0) * 1000,
    zinc_mg: (n.zinc_100g || 0) * 1000,
  };
}

/**
 * Search Nutritionix via web (scrapes public search)
 */
async function searchNutritionix(query) {
  try {
    // Use the free search endpoint
    const url = `https://www.nutritionix.com/food/${encodeURIComponent(query.replace(/\s+/g, '-'))}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DIQQ/1.0)' }
    });
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Try to extract JSON-LD nutrition data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        if (data.nutrition) {
          return {
            name: data.name,
            calories: parseFloat(data.nutrition.calories) || 0,
            protein_g: parseFloat(data.nutrition.proteinContent) || 0,
            fat_g: parseFloat(data.nutrition.fatContent) || 0,
            carbs_g: parseFloat(data.nutrition.carbohydrateContent) || 0,
            fiber_g: parseFloat(data.nutrition.fiberContent) || 0,
            sugar_g: parseFloat(data.nutrition.sugarContent) || 0,
            sodium_mg: parseFloat(data.nutrition.sodiumContent) || 0,
            potassium_mg: parseFloat(data.nutrition.potassiumContent) || 0,
            calcium_mg: parseFloat(data.nutrition.calciumContent) || 0,
            iron_mg: parseFloat(data.nutrition.ironContent) || 0,
          };
        }
      } catch (e) {}
    }
    return null;
  } catch (err) {
    console.error('DIQQ: Nutritionix scrape failed:', err.message);
    return null;
  }
}

/**
 * Find similar food in local database
 */
function findSimilarInDatabase(db, foodName) {
  const baseWord = getBaseFoodWord(foodName);
  const simplified = simplifyFoodName(foodName);
  
  // Try to find a food with complete data that matches
  const similar = db.prepare(`
    SELECT * FROM foods 
    WHERE (name LIKE ? OR name LIKE ?)
      AND calcium_mg IS NOT NULL AND calcium_mg > 0
      AND iron_mg IS NOT NULL AND iron_mg > 0
    ORDER BY 
      CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
      LENGTH(name)
    LIMIT 1
  `).get(`%${baseWord}%`, `%${simplified}%`, `%${simplified}%`);
  
  return similar;
}

/**
 * Copy nutrients from one food to another (only missing fields)
 */
function copyNutrientsFromSimilar(db, targetFood, sourceFood) {
  const updates = [];
  const values = [];
  
  for (const field of FIELDS_TO_CHECK) {
    // Only update NULL fields; allow copying 0 values
    if (targetFood[field] === null && sourceFood[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(sourceFood[field]);
    }
  }
  
  if (updates.length === 0) return { success: true, updated: 0 };
  
  values.push(targetFood.id);
  const sql = `UPDATE foods SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`;
  
  try {
    db.prepare(sql).run(...values);
    return { success: true, updated: updates.length, fields: updates.map(u => u.split(' ')[0]) };
  } catch (err) {
    return { success: false, reason: 'update_failed', error: err.message };
  }
}

/**
 * Update food with nutrients (only missing fields)
 */
function updateFoodNutrients(db, food, nutrients) {
  const updates = [];
  const values = [];
  
  for (const field of FIELDS_TO_CHECK) {
    // Only update NULL fields (0 is a valid value)
    // Check nutrients[field] !== undefined to allow 0 values from USDA
    if (food[field] === null && nutrients[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(nutrients[field]);
    }
  }
  
  if (updates.length === 0) return { success: true, reason: 'already_complete', updated: 0 };
  
  values.push(food.id);
  const sql = `UPDATE foods SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`;
  
  try {
    db.prepare(sql).run(...values);
    return { success: true, updated: updates.length, fields: updates.map(u => u.split(' ')[0]) };
  } catch (err) {
    return { success: false, reason: 'update_failed', error: err.message };
  }
}

/**
 * Mark a food as having been checked against USDA (skip on future scans).
 */
function markUSDAEnriched(db, foodId, fdcId) {
  try {
    if (fdcId) {
      db.prepare('UPDATE foods SET usda_enriched = 1, usda_fdc_id = ?, data_source = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(fdcId, 'usda', foodId);
    } else {
      db.prepare('UPDATE foods SET usda_enriched = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(foodId);
    }
  } catch (err) {
    console.error(`DIQQ: Failed to mark usda_enriched for food ${foodId}:`, err.message);
  }
}

/**
 * Enrich a single food using fallback chain:
 * 1. USDA exact search
 * 2. USDA simplified search
 * 3. USDA base word search
 * 4. Open Food Facts
 * 5. Local database similar food
 * 6. Nutritionix web scrape
 */
async function enrichFood(db, food) {
  // Skip USDA steps if already checked
  if (food.usda_enriched) {
    console.log(`DIQQ: "${food.name}" already USDA-checked, skipping to fallbacks...`);
    return await enrichFromFallbacks(db, food);
  }

  console.log(`DIQQ: Enriching "${food.name}"...`);
  
  const simplified = simplifyFoodName(food.name);
  const baseWord = getBaseFoodWord(food.name);
  
  // === STEP 1: Try USDA with exact name ===
  let results = await searchUSDA(food.name);
  
  // === STEP 2: Try USDA with simplified name (includes synonym conversion) ===
  if (results.length === 0 && simplified !== food.name.toLowerCase()) {
    console.log(`DIQQ: Trying simplified: "${simplified}"`);
    results = await searchUSDA(simplified);
  }
  
  // === STEP 2.5: Try with "raw" suffix for fresh foods ===
  if (results.length === 0 || (results.length > 0 && !results.some(r => r.description.toLowerCase().includes('raw')))) {
    const rawSearch = `${simplified} raw`;
    console.log(`DIQQ: Trying raw search: "${rawSearch}"`);
    const rawResults = await searchUSDA(rawSearch);
    if (rawResults.length > 0) {
      results = rawResults.concat(results); // Prioritize raw results
    }
  }
  
  // === STEP 3: Try USDA with just base word ===
  if (results.length === 0 && baseWord.length > 2) {
    console.log(`DIQQ: Trying base word: "${baseWord}"`);
    results = await searchUSDA(baseWord);
  }
  
  // If USDA found something, filter for good matches
  if (results.length > 0) {
    const bestMatch = findBestUSDAMatch(simplified || food.name, results);

    if (bestMatch) {
      console.log(`DIQQ: Found USDA match: "${bestMatch.description}" (FDC ID: ${bestMatch.fdcId})`);

      const details = await getFoodDetails(bestMatch.fdcId);
      if (details) {
        const nutrients = extractNutrients(details);
        const result = updateFoodNutrients(db, food, nutrients);
        // Mark as USDA-checked regardless of update count
        markUSDAEnriched(db, food.id, bestMatch.fdcId);
        if (result.success && result.updated > 0) {
          console.log(`DIQQ: Updated "${food.name}" with ${result.updated} fields from USDA`);
          return { ...result, source: 'usda', matchedFood: bestMatch.description };
        }
        if (result.updated === 0 && result.reason !== 'already_complete') {
          // USDA matched but had no useful data, continue to fallbacks
        } else {
          return result;
        }
      }
    } else {
      console.log(`DIQQ: USDA results rejected (oil/extract matches for whole food)`);
    }
  }

  // Mark as USDA-checked even if no match found (don't re-query next scan)
  markUSDAEnriched(db, food.id, null);
  
  // === STEP 4-6: Non-USDA fallbacks ===
  return await enrichFromFallbacks(db, food);
}

/**
 * Non-USDA fallback chain (Open Food Facts → local DB → Nutritionix).
 * Called directly when usda_enriched=1, or after USDA steps fail.
 */
async function enrichFromFallbacks(db, food) {
  const simplified = simplifyFoodName(food.name);

  // === Try Open Food Facts ===
  console.log(`DIQQ: Trying Open Food Facts for "${simplified}"...`);
  const offResults = await searchOpenFoodFacts(simplified);

  if (offResults.length > 0) {
    const bestOff = offResults.reduce((best, p) => {
      const score = Object.keys(p.nutriments || {}).length;
      return score > (best.score || 0) ? { ...p, score } : best;
    }, { score: 0 });

    if (bestOff.product_name) {
      console.log(`DIQQ: Found OFF match: "${bestOff.product_name}"`);
      const nutrients = extractNutrientsFromOFF(bestOff);
      const result = updateFoodNutrients(db, food, nutrients);
      if (result.success && result.updated > 0) {
        console.log(`DIQQ: Updated "${food.name}" with ${result.updated} fields from Open Food Facts`);
        return { ...result, source: 'open_food_facts', matchedFood: bestOff.product_name };
      }
    }
  }

  // === Try local database for similar food ===
  console.log(`DIQQ: Checking local database for similar food...`);
  const similar = findSimilarInDatabase(db, food.name);

  if (similar && similar.id !== food.id) {
    console.log(`DIQQ: Found similar in DB: "${similar.name}"`);
    const result = copyNutrientsFromSimilar(db, food, similar);
    if (result.success && result.updated > 0) {
      console.log(`DIQQ: Updated "${food.name}" with ${result.updated} fields from "${similar.name}"`);
      return { ...result, source: 'local_db', matchedFood: similar.name };
    }
  }

  // === Try Nutritionix web scrape ===
  console.log(`DIQQ: Trying Nutritionix for "${simplified}"...`);
  const nxData = await searchNutritionix(simplified);

  if (nxData && nxData.calories) {
    console.log(`DIQQ: Found Nutritionix data for "${nxData.name || simplified}"`);
    const result = updateFoodNutrients(db, food, nxData);
    if (result.success && result.updated > 0) {
      console.log(`DIQQ: Updated "${food.name}" with ${result.updated} fields from Nutritionix`);
      return { ...result, source: 'nutritionix', matchedFood: nxData.name || simplified };
    }
  }

  // === All fallbacks exhausted ===
  console.log(`DIQQ: No match found for "${food.name}" after all fallbacks`);
  return {
    success: false,
    reason: 'no_match',
    tried: food.usda_enriched ? ['open_food_facts', 'local_db', 'nutritionix'] : ['usda', 'open_food_facts', 'local_db', 'nutritionix']
  };
}

/**
 * Scan all foods and enrich those with missing data
 */
async function qualityControlScan(db) {
  console.log('\n🔍 DIQQ: Starting quality control scan...');
  
  // Only flag NULL as missing - 0 is a valid value (e.g., olive oil has 0 calcium)
  // Note: usda_enriched guard lives in enrichFood(), not here — scan should
  // still find partially-enriched foods so fallbacks get another chance.
  const foods = db.prepare(`
    SELECT * FROM foods
    WHERE calcium_mg IS NULL
       OR iron_mg IS NULL
       OR potassium_mg IS NULL
       OR vitamin_c_mg IS NULL
    ORDER BY updated_at DESC
  `).all();
  
  console.log(`DIQQ: Found ${foods.length} foods needing enrichment`);
  
  const results = {
    total: foods.length,
    enriched: 0,
    failed: 0,
    skipped: 0,
    details: []
  };
  
  for (const food of foods) {
    await new Promise(r => setTimeout(r, 1000)); // Rate limit
    
    const result = await enrichFood(db, food);
    results.details.push({ name: food.name, ...result });
    
    if (result.success && result.updated > 0) results.enriched++;
    else if (!result.success) results.failed++;
    else results.skipped++;
  }
  
  console.log(`\n✅ DIQQ: Scan complete!`);
  console.log(`   Enriched: ${results.enriched}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Already complete: ${results.skipped}`);

  // Report to PA
  const failedFoods = results.details.filter(d => !d.success);
  await reportToPA(
    failedFoods.length > 0 ? 'medium' : 'info',
    `Enriched ${results.enriched} foods${failedFoods.length > 0 ? `, ${failedFoods.length} need manual review` : ''}`,
    {
      total_scanned: results.total,
      enriched_count: results.enriched,
      failed_count: results.failed,
      skipped_count: results.skipped,
      failed_foods: failedFoods.map(f => ({ name: f.name, reason: f.error || 'no match' }))
    },
    failedFoods.length > 0  // for_human if there are failures
  );

  return results;
}

/**
 * Enrich a newly added food (called on insert)
 */
async function onFoodAdded(db, foodId) {
  const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(foodId);
  if (!food) return;
  
  console.log(`\n🔔 DIQQ: New food detected - "${food.name}"`);
  return await enrichFood(db, food);
}

module.exports = {
  searchUSDA,
  searchOpenFoodFacts,
  searchNutritionix,
  getFoodDetails,
  enrichFood,
  qualityControlScan,
  onFoodAdded,
  simplifyFoodName,
  findSimilarInDatabase
};
