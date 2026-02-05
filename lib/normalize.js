// Deterministic pre-processing and post-processing for the FUEL pipeline.
// No LLM calls. Pure string operations, lookups, and arithmetic.

const path = require('path');

// ============================================================
// CONSTANTS
// ============================================================

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5, quarter: 0.25, 'a couple': 2, 'a few': 3, 'a dozen': 12,
  'half a': 0.5, 'a half': 0.5, 'a quarter': 0.25,
};

const UNIT_ABBREVIATIONS = {
  tbsp: 'tablespoon', tbs: 'tablespoon', T: 'tablespoon',
  tsp: 'teaspoon', t: 'teaspoon',
  oz: 'ounce', fl_oz: 'fluid_ounce',
  lb: 'pound', lbs: 'pound',
  kg: 'kilogram', kgs: 'kilogram',
  ml: 'milliliter', mls: 'milliliter',
  l: 'liter', lt: 'liter',
  g: 'gram', gm: 'gram', gms: 'gram',
  c: 'cup',
  pcs: 'piece', pc: 'piece',
  sm: 'small', med: 'medium', lg: 'large', lge: 'large',
};

// Canonical unit set — the LLM output must use one of these
const CANONICAL_UNITS = new Set([
  'g', 'gram', 'grams', 'kg', 'kilogram',
  'oz', 'ounce', 'lb', 'pound',
  'ml', 'milliliter', 'l', 'liter', 'litre',
  'cup', 'tbsp', 'tablespoon', 'tsp', 'teaspoon',
  'fl_oz', 'fluid_ounce',
  'slice', 'piece', 'whole', 'half',
  'small', 'medium', 'large',
  'handful', 'serve', 'serving',
  'rasher', 'strip', 'fillet', 'breast', 'patty',
  'container', 'packet', 'stick', 'pat',
  'shot', 'glass', 'mug', 'bowl',
  'bunch', 'head', 'floret', 'clove',
  'drizzle', 'splash', 'pinch', 'dash',
]);

// Food synonyms — regional/colloquial → standard names
// Includes diqq.js FOOD_SYNONYMS plus Australian/casual terms
const FOOD_SYNONYMS = {
  // Regional (from diqq.js)
  capsicum: 'bell pepper',
  aubergine: 'eggplant',
  courgette: 'zucchini',
  coriander: 'cilantro',
  rocket: 'arugula',
  'spring onion': 'green onion',
  mince: 'ground beef',
  prawns: 'shrimp',
  chips: 'french fries',
  crisps: 'potato chips',
  biscuits: 'cookies',
  porridge: 'oatmeal',
  treacle: 'molasses',
  // Australian
  chook: 'chicken',
  snag: 'sausage',
  brekkie: 'breakfast',
  arvo: 'afternoon',
  avo: 'avocado',
  'avo toast': 'avocado toast',
  cuppa: 'cup of tea',
  bikkies: 'cookies',
  lolly: 'candy',
  // Casual/informal
  'pb': 'peanut butter',
  'pb&j': 'peanut butter and jelly sandwich',
  'oj': 'orange juice',
  chx: 'chicken',
  veggies: 'vegetables',
  veg: 'vegetables',
  spud: 'potato',
  'sweet spud': 'sweet potato',
};

// Unit synonyms — colloquial → canonical unit
const UNIT_SYNONYMS = {
  cuppa: 'cup',
  mugful: 'mug',
  bowlful: 'bowl',
  scoop: 'serve',
  dollop: 'tablespoon',
  knob: 'tablespoon',
  glug: 'tablespoon',
  nip: 'shot',
  tot: 'shot',
};

// Universal unit-to-gram conversions (water density fallback)
const UNIVERSAL_UNIT_GRAMS = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000,
  oz: 28.35, ounce: 28.35,
  lb: 453.6, pound: 453.6,
  tbsp: 15, tablespoon: 15,
  tsp: 5, teaspoon: 5,
  cup: 240,
  ml: 1, milliliter: 1,
  l: 1000, liter: 1000, litre: 1000,
  fl_oz: 30, fluid_ounce: 30,
  pint: 473,
  pinch: 0.5,
  dash: 0.6,
  drizzle: 5,
  splash: 7,
  shot: 30,
};

// Fluff words to strip before sending to LLM
const FLUFF_PATTERNS = [
  /\b(i\s+)?(had|ate|eaten|consumed|grabbed|munched|devoured|wolfed down|scarfed)\b/gi,
  /\bfor\s+(my\s+)?(breakfast|brekkie|lunch|dinner|supper|snack|tea|arvo tea)\b/gi,
  /\b(about|approximately|roughly|around|maybe|probably|like)\b/gi,
  /\b(just|only|simply)\b/gi,
  /\b(this morning|this afternoon|this evening|tonight|today|yesterday)\b/gi,
  /\b(at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/gi, // Capture time separately, strip from food text
];

// ============================================================
// PRE-PROCESSING (before LLM)
// ============================================================

/**
 * Convert number words to digits.
 * "one egg" → "1 egg", "a couple bananas" → "2 bananas"
 */
function numberWords(text) {
  let result = text;
  // Sort by length descending so "a couple" matches before "a"
  const sorted = Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [word, num] of sorted) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, String(num));
  }
  return result;
}

/**
 * Expand unit abbreviations to full names.
 * "2 tbsp oil" → "2 tablespoon oil"
 */
function expandAbbreviations(text) {
  let result = text;
  for (const [abbr, full] of Object.entries(UNIT_ABBREVIATIONS)) {
    // Word boundary match, case-sensitive for single-char abbreviations
    const flags = abbr.length === 1 ? 'g' : 'gi';
    const regex = new RegExp(`\\b${abbr}\\b`, flags);
    result = result.replace(regex, full);
  }
  return result;
}

/**
 * Replace regional/colloquial food names with standard names.
 */
function normalizeFoodSynonyms(text) {
  let result = text.toLowerCase();
  // Sort by length descending for multi-word matches
  const sorted = Object.entries(FOOD_SYNONYMS).sort((a, b) => b[0].length - a[0].length);
  for (const [colloquial, standard] of sorted) {
    const regex = new RegExp(`\\b${escapeRegex(colloquial)}\\b`, 'gi');
    result = result.replace(regex, standard);
  }
  return result;
}

/**
 * Normalize unit synonyms.
 * "cuppa" → "cup"
 */
function normalizeUnitSynonyms(text) {
  let result = text;
  for (const [slang, canonical] of Object.entries(UNIT_SYNONYMS)) {
    const regex = new RegExp(`\\b${escapeRegex(slang)}\\b`, 'gi');
    result = result.replace(regex, canonical);
  }
  return result;
}

/**
 * Strip fluff words that add no nutritional information.
 * "I had about 2 eggs for breakfast" → "2 eggs"
 */
function stripFluff(text) {
  let result = text;
  for (const pattern of FLUFF_PATTERNS) {
    result = result.replace(pattern, '');
  }
  // Collapse multiple spaces
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Extract time references from text before stripping.
 * Returns { cleanedText, mealTime, mealType }
 */
function extractTimeAndType(text) {
  let mealTime = null;
  let mealType = null;

  // Extract time patterns
  const timeMatch = text.match(/\bat\s+(\d{1,2})(:\d{2})?\s*(am|pm)?\b/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? timeMatch[2].slice(1) : '00';
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    mealTime = `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  // Infer meal type
  const lower = text.toLowerCase();
  if (/\b(breakfast|brekkie|morning)\b/.test(lower)) mealType = 'breakfast';
  else if (/\b(lunch|midday)\b/.test(lower)) mealType = 'lunch';
  else if (/\b(dinner|supper|evening)\b/.test(lower)) mealType = 'dinner';
  else if (/\b(snack|arvo tea)\b/.test(lower)) mealType = 'snack';

  return { mealTime, mealType };
}

/**
 * Run all pre-processing steps on raw input.
 * Returns { cleaned, mealTime, mealType }
 */
function preProcess(text) {
  const { mealTime, mealType } = extractTimeAndType(text);

  let cleaned = text;
  cleaned = normalizeUnitSynonyms(cleaned);
  cleaned = normalizeFoodSynonyms(cleaned);
  cleaned = numberWords(cleaned);
  cleaned = expandAbbreviations(cleaned);
  cleaned = stripFluff(cleaned);

  return { cleaned, mealTime, mealType };
}

// ============================================================
// POST-PROCESSING (after LLM)
// ============================================================

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Trigram similarity score (0-1) between two strings.
 */
function trigramSimilarity(a, b) {
  const trigramsOf = s => {
    const padded = `  ${s.toLowerCase()}  `;
    const set = new Set();
    for (let i = 0; i < padded.length - 2; i++) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  };
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Fuzzy match a food name against the foods table.
 * Returns { food_id, food_name, confidence, match_type } or null.
 */
function fuzzyMatchFood(name, db) {
  const lower = name.toLowerCase().trim();

  // 1. Exact match
  const exact = db.prepare(
    'SELECT id, name FROM foods WHERE LOWER(name) = ?'
  ).get(lower);
  if (exact) {
    return { food_id: exact.id, food_name: exact.name, confidence: 1.0, match_type: 'exact' };
  }

  // 2. Prefix/contains match
  const contains = db.prepare(
    'SELECT id, name FROM foods WHERE LOWER(name) LIKE ? ORDER BY LENGTH(name) ASC LIMIT 1'
  ).get(`%${lower}%`);
  if (contains) {
    const sim = trigramSimilarity(lower, contains.name.toLowerCase());
    return {
      food_id: contains.id, food_name: contains.name,
      confidence: Math.max(0.7, sim), match_type: 'contains'
    };
  }

  // 3. Trigram + Levenshtein on all foods
  const allFoods = db.prepare('SELECT id, name FROM foods').all();
  let bestMatch = null;
  let bestScore = 0;

  for (const food of allFoods) {
    const foodLower = food.name.toLowerCase();
    const sim = trigramSimilarity(lower, foodLower);
    const dist = levenshtein(lower, foodLower);
    const maxLen = Math.max(lower.length, foodLower.length);
    const distScore = maxLen > 0 ? 1 - dist / maxLen : 0;
    // Weighted combination
    const score = sim * 0.6 + distScore * 0.4;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = food;
    }
  }

  if (bestMatch && bestScore >= 0.4) {
    return {
      food_id: bestMatch.id, food_name: bestMatch.name,
      confidence: Math.min(0.8, bestScore), match_type: 'fuzzy'
    };
  }

  return null;
}

/**
 * Look up unit weight for a food from the unit_weights table.
 * Returns grams per unit or null.
 */
function lookupUnitWeight(db, foodId, unit) {
  const lower = unit.toLowerCase().trim();

  // Try food-specific weight first
  const specific = db.prepare(
    'SELECT grams FROM unit_weights WHERE food_id = ? AND LOWER(unit) = ?'
  ).get(foodId, lower);
  if (specific) return specific.grams;

  // Try universal unit map
  if (UNIVERSAL_UNIT_GRAMS[lower] !== undefined) {
    return UNIVERSAL_UNIT_GRAMS[lower];
  }

  // Try without trailing 's' (cups → cup)
  const singular = lower.replace(/s$/, '');
  const singularWeight = db.prepare(
    'SELECT grams FROM unit_weights WHERE food_id = ? AND LOWER(unit) = ?'
  ).get(foodId, singular);
  if (singularWeight) return singularWeight.grams;
  if (UNIVERSAL_UNIT_GRAMS[singular] !== undefined) {
    return UNIVERSAL_UNIT_GRAMS[singular];
  }

  return null;
}

/**
 * Convert raw quantity + unit to grams using unit_weights lookup.
 * Returns { grams, source } or null if unit unknown.
 */
function convertToGrams(db, foodId, rawQuantity, rawUnit) {
  const qty = rawQuantity || 1;
  const unit = (rawUnit || 'g').toLowerCase().trim();

  // Direct gram/kg units — pass through
  if (['g', 'gram', 'grams'].includes(unit)) {
    return { grams: qty, source: 'direct' };
  }
  if (['kg', 'kilogram'].includes(unit)) {
    return { grams: qty * 1000, source: 'direct' };
  }

  const gramsPerUnit = lookupUnitWeight(db, foodId, unit);
  if (gramsPerUnit !== null) {
    return { grams: qty * gramsPerUnit, source: 'unit_weights' };
  }

  return null;
}

/**
 * Convert grams to the canonical amount multiplier (grams / 100).
 */
function calculateAmount(grams) {
  return {
    amount: Math.round((grams / 100) * 10000) / 10000, // 4 decimal places
    actual_grams: Math.round(grams * 100) / 100,
  };
}

/**
 * Score confidence for a resolved item.
 * @param {object} factors - { match_type, unit_source, quantity_explicit }
 * @returns {number} 0.0 to 1.0
 */
function scoreConfidence(factors) {
  const matchScore = {
    exact: 1.0,
    contains: 0.8,
    fuzzy: 0.6,
    llm: 0.5,
    unmatched: 0.2,
  }[factors.match_type] || 0.5;

  const unitScore = {
    direct: 1.0,
    unit_weights: 0.95,
    universal: 0.8,
    llm_estimate: 0.4,
    unknown: 0.2,
  }[factors.unit_source] || 0.5;

  const qtyScore = factors.quantity_explicit ? 1.0 : 0.6;

  // Weighted average
  return Math.round((matchScore * 0.4 + unitScore * 0.35 + qtyScore * 0.25) * 100) / 100;
}

/**
 * Check if a unit string is in the canonical set.
 */
function isCanonicalUnit(unit) {
  return CANONICAL_UNITS.has(unit.toLowerCase().trim());
}

// ============================================================
// HELPERS
// ============================================================

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Pre-processing
  numberWords,
  expandAbbreviations,
  normalizeFoodSynonyms,
  normalizeUnitSynonyms,
  stripFluff,
  extractTimeAndType,
  preProcess,

  // Post-processing
  fuzzyMatchFood,
  lookupUnitWeight,
  convertToGrams,
  calculateAmount,
  scoreConfidence,
  isCanonicalUnit,

  // Utilities
  levenshtein,
  trigramSimilarity,

  // Constants (exported for testing)
  NUMBER_WORDS,
  UNIT_ABBREVIATIONS,
  CANONICAL_UNITS,
  FOOD_SYNONYMS,
  UNIT_SYNONYMS,
  UNIVERSAL_UNIT_GRAMS,
};
