// Intent router for FUEL pipeline.
// Classifies user input into: LOG, CORRECTION, ADVICE, QUERY, SYSTEM
// Uses deterministic keyword matching first, LLM fallback for ambiguous.

const INTENTS = {
  LOG: 'log',
  CORRECTION: 'correction',
  ADVICE: 'advice',
  QUERY: 'query',
  SYSTEM: 'system',
};

const ROUTES = {
  [INTENTS.LOG]: 'pipeline',
  [INTENTS.CORRECTION]: 'pipeline',
  [INTENTS.ADVICE]: 'zeus',
  [INTENTS.QUERY]: 'gera',
  [INTENTS.SYSTEM]: 'server',
};

// ============================================================
// DETERMINISTIC KEYWORD PATTERNS
// ============================================================

// Each pattern returns { intent, confidence } or null
const PATTERNS = [
  // CORRECTION — must check before LOG (both mention food)
  {
    intent: INTENTS.CORRECTION,
    patterns: [
      /\b(fix|correct|change|update|wrong|mistake|actually|should\s+be|wasn'?t|that'?s\s+not)\b/i,
      /\b(remove|delete|undo)\s+(the|my|that|last)\b/i,
      /\b(swap|replace)\s+/i,
      /\bnot\s+\d+\s*(g|grams|cup|tbsp)/i,  // "not 200g, it was 150g"
    ],
    // Must also mention food/meal context to avoid false positives on system commands
    requires: /\b(meal|food|breakfast|lunch|dinner|snack|ate|had|log|entry|item)\b/i,
    confidence: 0.85,
  },

  // LOG — user wants to record food intake
  {
    intent: INTENTS.LOG,
    patterns: [
      // Explicit logging
      /\b(log|record|add|track|save)\s+(my\s+)?(meal|food|breakfast|lunch|dinner|snack)\b/i,
      /\b(i\s+)?(had|ate|eaten|consumed|grabbed|just\s+had)\s+/i,
      // Quantity + food pattern: "2 eggs", "100g chicken", "a banana"
      /\b\d+\.?\d*\s*(g|grams|oz|cup|cups|tbsp|tsp|slice|slices|piece|pieces)\s+/i,
      /\b\d+\.?\d*\s+\w+\s+(for|at|this)\s+(breakfast|lunch|dinner|morning|afternoon|evening)\b/i,
      // Standalone food mentions with time context
      /\bfor\s+(breakfast|lunch|dinner|snack|brekkie)\b/i,
      // "eggs and toast", "chicken with rice" — food compound patterns
      /\b(eggs?|toast|chicken|rice|salmon|pasta|salad|sandwich|yogurt|oatmeal|banana|apple)\s+(and|with|on)\s+/i,
    ],
    confidence: 0.80,
  },

  // ADVICE — user wants meal planning / dietary suggestions
  // Must be checked BEFORE QUERY because "what should I eat with X remaining"
  // contains "remaining" which would otherwise match QUERY.
  {
    intent: INTENTS.ADVICE,
    patterns: [
      /\b(what\s+should\s+i\s+(eat|have|cook|make|prepare))\b/i,
      /\b(what\s+can\s+i\s+(eat|have))\b/i,
      /\b(suggest|recommend)\s+(a\s+)?(meal|food|snack|something)\b/i,
      /\b(meal\s+plan|grocery\s+list|shopping\s+list)\b/i,
      /\b(plan)\s+(my\s+)?(meals?|food|week|tomorrow|today)\b/i,
      /\b(good|best)\s+(food|source|option)\s+(for|of)\b/i,
      /\b(is\s+\w+\s+good\s+for)\b/i,  // "is chicken good for protein"
      /\b(help\s+me\s+(plan|decide|choose))\b/i,
      /\bwhat\s+to\s+(eat|have|cook)\b/i,
      /\b(idea|option|suggestion)s?\s+(for\s+)?(breakfast|lunch|dinner|snack|meal)\b/i,
    ],
    confidence: 0.90,  // Higher than QUERY to win ties
  },

  // QUERY — user asking about their data / progress
  {
    intent: INTENTS.QUERY,
    patterns: [
      /\b(how\s+much|how\s+many|what\s+did\s+i|show\s+me|what'?s\s+my|tell\s+me\s+(about|my))\b/i,
      /\b(remaining|left|consumed|total|progress|summary|today'?s|yesterday'?s)\b/i,
      /\bhow\s+(am\s+i|are\s+(things|we))\s+(doing|going|tracking)\b/i,
      /\b(calories|protein|carbs|fat|fiber|macros?|micros?|nutrients?)\s+(today|left|remaining|so\s+far)\b/i,
      /\b(daily|weekly)\s+(summary|report|totals?|stats?)\b/i,
      /\bwhat\s+(phase|cycle\s+day|day)\s+(am\s+i|is\s+it)\b/i,
    ],
    confidence: 0.85,
  },

  // SYSTEM — meta commands
  {
    intent: INTENTS.SYSTEM,
    patterns: [
      /\b(settings?|preferences?|configure|setup|onboard)\b/i,
      /\b(help|commands?|how\s+do\s+i)\b/i,
      /\b(update|change|set)\s+(my\s+)?(weight|height|age|cycle\s+length|cycle\s+start|activity)\b/i,
      /\b(weight|height|age|cycle\s+length|cycle\s+start|activity)\s+(is|to)\s+\d/i,
    ],
    confidence: 0.80,
  },
];

// ============================================================
// CLASSIFICATION
// ============================================================

/**
 * Classify user input into an intent.
 * @param {string} input - Raw user text
 * @param {object} context - { lastMealLogged, pendingMeal, conversationHistory }
 * @returns {object} { intent, confidence, routeTo, originalInput, method }
 */
async function classify(input, context = {}) {
  const trimmed = input.trim();

  // Empty input
  if (!trimmed) {
    return {
      intent: INTENTS.SYSTEM,
      confidence: 1.0,
      routeTo: ROUTES[INTENTS.SYSTEM],
      originalInput: input,
      method: 'empty',
    };
  }

  // Try deterministic patterns first
  const deterministicResult = classifyDeterministic(trimmed);
  if (deterministicResult && deterministicResult.confidence >= 0.75) {
    return {
      ...deterministicResult,
      routeTo: ROUTES[deterministicResult.intent],
      originalInput: input,
      method: 'deterministic',
    };
  }

  // Context-based heuristics
  const contextResult = classifyFromContext(trimmed, context);
  if (contextResult && contextResult.confidence >= 0.7) {
    return {
      ...contextResult,
      routeTo: ROUTES[contextResult.intent],
      originalInput: input,
      method: 'context',
    };
  }

  // If we got a weak deterministic match, use it
  if (deterministicResult) {
    return {
      ...deterministicResult,
      routeTo: ROUTES[deterministicResult.intent],
      originalInput: input,
      method: 'deterministic_weak',
    };
  }

  // Default: if it looks like food, treat as LOG
  if (looksLikeFood(trimmed)) {
    return {
      intent: INTENTS.LOG,
      confidence: 0.5,
      routeTo: ROUTES[INTENTS.LOG],
      originalInput: input,
      method: 'food_heuristic',
    };
  }

  // Last resort: assume QUERY
  return {
    intent: INTENTS.QUERY,
    confidence: 0.3,
    routeTo: ROUTES[INTENTS.QUERY],
    originalInput: input,
    method: 'default',
  };
}

/**
 * Try deterministic keyword matching.
 */
function classifyDeterministic(text) {
  let bestMatch = null;
  let bestConfidence = 0;

  for (const rule of PATTERNS) {
    let matched = false;
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        matched = true;
        break;
      }
    }

    if (!matched) continue;

    // Check additional requirements
    if (rule.requires && !rule.requires.test(text)) continue;

    if (rule.confidence > bestConfidence) {
      bestConfidence = rule.confidence;
      bestMatch = { intent: rule.intent, confidence: rule.confidence };
    }
  }

  return bestMatch;
}

/**
 * Use conversation context to help classify.
 */
function classifyFromContext(text, context) {
  // If there's a pending correction context, lean toward correction
  if (context.pendingCorrection) {
    return { intent: INTENTS.CORRECTION, confidence: 0.75 };
  }

  // If last action was logging and this looks like a follow-up food item
  if (context.lastAction === 'log' && looksLikeFood(text)) {
    return { intent: INTENTS.LOG, confidence: 0.75 };
  }

  // If user just asked for advice and responds with a choice
  if (context.lastAction === 'advice' && /\b(that|first|second|option|yes|sounds\s+good)\b/i.test(text)) {
    return { intent: INTENTS.ADVICE, confidence: 0.7 };
  }

  return null;
}

/**
 * Heuristic: does this text look like it contains food items?
 * Used as a last resort when no patterns match.
 */
function looksLikeFood(text) {
  const foodWords = [
    'egg', 'eggs', 'toast', 'bread', 'chicken', 'rice', 'salmon', 'pasta',
    'salad', 'sandwich', 'yogurt', 'oatmeal', 'banana', 'apple', 'avocado',
    'milk', 'cheese', 'bacon', 'steak', 'fish', 'broccoli', 'spinach',
    'potato', 'tomato', 'coffee', 'tea', 'juice', 'smoothie', 'pizza',
    'burger', 'wrap', 'bowl', 'soup', 'curry', 'noodles', 'cereal',
    'pancake', 'waffle', 'muffin', 'cookie', 'fruit', 'nuts', 'almonds',
    'peanut butter', 'olive oil', 'butter', 'honey', 'protein',
  ];

  const lower = text.toLowerCase();
  return foodWords.some(word => lower.includes(word));
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  classify,
  classifyDeterministic,
  classifyFromContext,
  looksLikeFood,
  INTENTS,
  ROUTES,
};
