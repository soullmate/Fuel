// Pipeline orchestrator for FUEL meal logging.
// Two-phase commit: process() extracts + validates, commit() saves to DB.
// Deterministic path via normalize.js; LLM stubs for future enrichment.

const normalize = require('./normalize');
const router = require('./router');
const diqq = require('../diqq');

// Composite food heuristic keywords
const COMPOSITE_KEYWORDS = [
  'salad', 'bowl', 'sandwich', 'wrap', 'burrito', 'taco', 'pizza',
  'stir fry', 'stir-fry', 'curry', 'stew', 'soup', 'smoothie',
  'parfait', 'plate', 'combo', 'platter', 'bento', 'poke',
  'risotto', 'casserole', 'pie', 'lasagna', 'omelette', 'omelet',
  'frittata', 'quiche', 'hash', 'scramble',
];

class Pipeline {
  constructor(db) {
    this.db = db;
  }

  /**
   * Process raw user input into a structured meal ready for confirmation.
   * Does NOT write to DB — returns result for user review.
   */
  async process(input, context = {}) {
    const decisions = [];

    // Step 1: Route intent
    const routing = await router.classify(input, context);
    decisions.push({
      agent: 'router',
      action: 'classify',
      details: {
        intent: routing.intent,
        confidence: routing.confidence,
        method: routing.method,
      },
      model_used: 'deterministic',
      confidence_pct: routing.confidence,
    });

    // Only process LOG and CORRECTION intents
    if (routing.routeTo !== 'pipeline') {
      // Log the request even if routed elsewhere
      this._logRequest(input, routing.intent, 'routed', null, null, null);
      return {
        routed: true,
        routing,
        decisions,
        message: `Input classified as ${routing.intent} — route to ${routing.routeTo}`,
      };
    }

    // Step 2: Parse input
    const parsed = this._parseInput(input, context, decisions);

    // Step 3: Split ingredients (decompose composites)
    const splitItems = this._splitIngredients(parsed.items, decisions);

    // Step 4: Resolve foods and convert units (async — DIQQ lookups for unknown foods)
    const resolved = await this._resolveAndConvert(splitItems, decisions);

    // Check for unresolved items — pipeline halts until everything is matched
    const unmatched = resolved.filter(i => i.unmatched);
    if (unmatched.length > 0) {
      const unmatchedNames = unmatched.map(i => i.food_name);
      decisions.push({
        agent: 'pipeline',
        action: 'halt_unresolved',
        details: { unmatched: unmatchedNames },
        model_used: 'deterministic',
      });

      const requestId = this._logRequest(
        input, 'log', 'incomplete', null,
        null, `Unresolved foods: ${unmatchedNames.join(', ')}`
      );

      return {
        incomplete: true,
        requestId,
        message: `I couldn't find ${unmatchedNames.join(', ')} in any database (USDA, Open Food Facts, or local). ` +
          'You may need to add this food manually or check the spelling.',
        unresolved: unmatchedNames,
        resolved: resolved.filter(i => !i.unmatched),
        items: resolved,
        decisions,
        needsConfirmation: false,
      };
    }

    // Step 5: Pre-save validation (only when all items resolved)
    const validation = this._validatePreSave(resolved, decisions);

    // Calculate preview totals
    const totals = this._calculateTotals(resolved);

    // Build meal object
    const meal = {
      meal_type: parsed.mealType || this._inferMealType(),
      meal_time: this._buildMealTime(parsed.mealTime),
      title: this._generateTitle(resolved),
      source: 'pipeline',
      confidence_pct: this._compositeMealConfidence(resolved),
      photo_url: context.photo_url || null,
    };

    // Log request as pending confirmation
    const requestId = this._logRequest(
      input, 'log', 'pending', null,
      JSON.stringify({ items: resolved.map(i => ({ food: i.food_name, grams: i.actual_grams })), totals }),
      null
    );

    return {
      incomplete: false,
      requestId,
      meal,
      items: resolved,
      validation,
      decisions,
      totals,
      needsConfirmation: true,
    };
  }

  /**
   * Save a confirmed processed meal to the database.
   * Only called after user reviews process() output.
   */
  async commit(processedMeal) {
    const { meal, items, decisions, requestId } = processedMeal;

    // Insert meal
    const mealResult = this.db.prepare(`
      INSERT INTO meals (meal_type, meal_time, title, source, confidence_pct, photo_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      meal.meal_type,
      meal.meal_time,
      meal.title,
      meal.source || 'pipeline',
      meal.confidence_pct || 0.5,
      meal.photo_url || null
    );
    const mealId = Number(mealResult.lastInsertRowid);

    // Insert meal items
    const insertItem = this.db.prepare(`
      INSERT INTO meal_items (
        meal_id, food_id, amount, actual_grams,
        raw_quantity, raw_unit, confidence_pct, parsing_source, unit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const savedItems = [];
    const insertMany = this.db.transaction((itemList) => {
      for (const item of itemList) {
        const result = insertItem.run(
          mealId,
          item.food_id,
          item.amount,
          item.actual_grams,
          item.raw_quantity,
          item.raw_unit,
          item.confidence_pct,
          item.parsing_source || 'pipeline',
          item.raw_unit
        );
        savedItems.push({
          ...item,
          id: Number(result.lastInsertRowid),
          meal_id: mealId,
        });
      }
    });
    insertMany(items);

    // Log decisions
    if (decisions && decisions.length > 0) {
      const insertDecision = this.db.prepare(`
        INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used, confidence_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const logDecisions = this.db.transaction((decs) => {
        for (const d of decs) {
          insertDecision.run(
            d.entity_type || 'meal',
            mealId,
            d.agent || 'pipeline',
            d.action,
            JSON.stringify(d.details || {}),
            d.model_used || 'deterministic',
            d.confidence_pct || null
          );
        }
      });
      logDecisions(decisions);
    }

    // Store any new LLM-estimated unit weights for future deterministic lookups
    this._persistNewUnitWeights(items);

    // Mark request as committed
    if (requestId) {
      this._updateRequestStatus(requestId, 'committed', mealId);
    }

    return {
      meal: { ...meal, id: mealId },
      items: savedItems,
      mealId,
      requestId,
    };
  }

  // ============================================================
  // INTERNAL: Parse Input
  // ============================================================

  _parseInput(input, context, decisions) {
    // Run deterministic pre-processing
    const { cleaned, mealTime, mealType } = normalize.preProcess(input);

    decisions.push({
      agent: 'pipeline',
      action: 'parse',
      details: {
        original: input,
        cleaned,
        mealTime,
        mealType,
      },
      model_used: 'deterministic',
    });

    // Extract {food, quantity, unit} triples deterministically
    const items = this._extractFoodTriples(cleaned);

    // If deterministic extraction found nothing, try LLM
    if (items.length === 0) {
      const llmItems = this._llmExtractTriples(cleaned);
      if (llmItems.length > 0) {
        decisions.push({
          agent: 'pipeline',
          action: 'parse_llm',
          details: { items: llmItems },
          model_used: null, // TODO: wire LLM
        });
        return { items: llmItems, mealTime, mealType: mealType || context.mealType };
      }

      // Last resort: treat whole input as single food item
      items.push({ food: cleaned, quantity: 1, unit: null, quantity_explicit: false });
    }

    decisions.push({
      agent: 'pipeline',
      action: 'extract_triples',
      details: { count: items.length, items },
      model_used: 'deterministic',
    });

    return { items, mealTime, mealType: mealType || context.mealType };
  }

  /**
   * Deterministic extraction of food triples from cleaned text.
   * Handles patterns like: "2 eggs", "100g chicken breast", "a banana"
   */
  _extractFoodTriples(text) {
    const items = [];
    // Split on common separators: "and", ",", "&", "with", "+"
    const parts = text.split(/\s*(?:,\s*|\s+and\s+|\s*&\s*|\s*\+\s*)\s*/i)
      .map(s => s.trim())
      .filter(Boolean);

    for (const part of parts) {
      const triple = this._parseOneTriple(part);
      if (triple) {
        items.push(triple);
      }
    }

    return items;
  }

  _parseOneTriple(text) {
    // Pattern: (quantity) (unit) (food)
    // Examples: "2 eggs", "100g chicken", "1 cup rice", "banana", "large apple"
    const match = text.match(
      /^(\d+\.?\d*)\s*(g|gram|grams|kg|kilogram|oz|ounce|lb|pound|ml|milliliter|l|liter|litre|cup|cups|tbsp|tablespoon|tsp|teaspoon|slice|slices|piece|pieces|whole|small|medium|large|serve|serving|handful|bowl|glass|mug|rasher|rashers|strip|strips|fillet|fillets|breast|breasts|patty|patties|stick|sticks|clove|cloves|bunch|head|floret|florets|shot|shots|splash|drizzle|pinch|dash|container|packet|pat)?\s*(?:of\s+)?(.+)$/i
    );

    if (match) {
      const quantity = parseFloat(match[1]);
      const unit = match[2] ? match[2].toLowerCase().replace(/s$/, '') : null;
      const food = match[3].trim();
      if (food) {
        return { food, quantity, unit, quantity_explicit: true };
      }
    }

    // Pattern: no leading number — single food item
    // Could still have a size descriptor: "large apple", "small banana"
    const sizeMatch = text.match(/^(small|medium|large|half)\s+(.+)$/i);
    if (sizeMatch) {
      return {
        food: sizeMatch[2].trim(),
        quantity: 1,
        unit: sizeMatch[1].toLowerCase(),
        quantity_explicit: false,
      };
    }

    // Bare food name
    if (text.length > 0) {
      return { food: text, quantity: 1, unit: null, quantity_explicit: false };
    }

    return null;
  }

  /**
   * LLM extraction stub. Returns empty array until LLM is wired.
   * TODO: Call cheap LLM (haiku/ollama) to extract food triples from text.
   */
  _llmExtractTriples(text) {
    // Stub: deterministic path should handle most inputs
    return [];
  }

  // ============================================================
  // INTERNAL: Split Ingredients (decompose composites)
  // ============================================================

  _splitIngredients(items, decisions) {
    const result = [];

    for (const item of items) {
      // 1. Check known_decompositions table
      const decomp = this._lookupDecomposition(item.food);
      if (decomp) {
        const ingredients = JSON.parse(decomp.ingredients);
        decisions.push({
          agent: 'pipeline',
          action: 'decompose',
          details: {
            composite: item.food,
            source: 'known_decompositions',
            ingredients: ingredients.length,
          },
          model_used: 'deterministic',
        });

        for (const ing of ingredients) {
          result.push({
            food: ing.food_name,
            quantity: (ing.default_quantity || 1) * item.quantity,
            unit: ing.default_unit || 'g',
            quantity_explicit: true,
            from_composite: item.food,
          });
        }
        continue;
      }

      // 2. Heuristic: does this look like a composite?
      if (this._looksComposite(item.food)) {
        // TODO: LLM decomposition for unknown composites
        decisions.push({
          agent: 'pipeline',
          action: 'decompose_skip',
          details: {
            composite: item.food,
            reason: 'No known decomposition and no LLM available — treating as single item',
          },
          model_used: null,
        });
      }

      // 3. Simple food — pass through
      result.push(item);
    }

    return result;
  }

  _lookupDecomposition(foodName) {
    const lower = foodName.toLowerCase().trim();
    return this.db.prepare(
      'SELECT * FROM known_decompositions WHERE LOWER(meal_name) = ?'
    ).get(lower) || null;
  }

  _looksComposite(foodName) {
    const lower = foodName.toLowerCase();
    return COMPOSITE_KEYWORDS.some(kw => lower.includes(kw));
  }

  // ============================================================
  // INTERNAL: DIQQ Integration — create unknown foods on the fly
  // ============================================================

  /**
   * Create a food entry via DIQQ when fuzzyMatchFood finds nothing.
   * Creates a bare food row, then uses DIQQ's full fallback chain
   * (USDA → Open Food Facts → local similar → Nutritionix) to enrich it.
   */
  async _createFoodViaDIQQ(foodName, decisions) {
    const name = foodName.toLowerCase().trim();

    // Check if it already exists (exact match that fuzzy somehow missed)
    const existing = this.db.prepare('SELECT id, name FROM foods WHERE LOWER(name) = ?').get(name);
    if (existing) {
      return {
        food_id: existing.id,
        food_name: existing.name,
        match_type: 'diqq_existing',
        confidence: 0.7,
      };
    }

    // Create a bare food row so enrichFood can work on it
    let foodId;
    try {
      const result = this.db.prepare(
        'INSERT INTO foods (name, confidence_pct) VALUES (?, ?)'
      ).run(name, 0.5);
      foodId = Number(result.lastInsertRowid);
    } catch (err) {
      decisions.push({
        agent: 'diqq',
        action: 'create_food_failed',
        details: { name, error: err.message },
        confidence_pct: 0,
      });
      return null;
    }

    // Run DIQQ's full enrichment chain on the new food
    const food = this.db.prepare('SELECT * FROM foods WHERE id = ?').get(foodId);
    const enrichResult = await diqq.enrichFood(this.db, food);

    decisions.push({
      agent: 'diqq',
      action: 'enrich_food',
      entity_type: 'food',
      details: {
        name,
        food_id: foodId,
        source: enrichResult.source || 'none',
        matched_as: enrichResult.matchedFood || null,
        fields_updated: enrichResult.updated || 0,
        success: enrichResult.success,
      },
      model_used: enrichResult.source || 'fallback_chain',
      confidence_pct: enrichResult.success && enrichResult.updated > 0 ? 0.7 : 0.3,
    });

    // Keep the food regardless — even without nutrients, the meal should be logged.
    // DIQQ scans can retry fallbacks later, or the user can fill in data manually.
    const confidence = enrichResult.success && enrichResult.updated > 0 ? 0.7 : 0.3;
    this.db.prepare('UPDATE foods SET confidence_pct = ? WHERE id = ?').run(confidence, foodId);

    return {
      food_id: foodId,
      food_name: name,
      match_type: enrichResult.success ? 'diqq_' + (enrichResult.source || 'enriched') : 'diqq_unenriched',
      confidence,
    };
  }

  // ============================================================
  // INTERNAL: Resolve Foods & Convert Units
  // ============================================================

  async _resolveAndConvert(items, decisions) {
    const resolved = [];

    for (const item of items) {
      // 1. Fuzzy match food against DB
      let match = normalize.fuzzyMatchFood(item.food, this.db);

      if (!match) {
        // No local match — call DIQQ to create the food from USDA
        decisions.push({
          agent: 'pipeline',
          action: 'match_food',
          entity_type: 'meal_item',
          details: {
            input: item.food,
            result: 'no_local_match',
            action: 'calling DIQQ to resolve from USDA',
          },
          model_used: 'deterministic',
          confidence_pct: 0.2,
        });

        match = await this._createFoodViaDIQQ(item.food, decisions);

        if (!match) {
          // DIQQ couldn't find it either — genuinely unknown food
          resolved.push({
            food_id: null,
            food_name: item.food,
            amount: 0,
            actual_grams: 0,
            raw_quantity: item.quantity,
            raw_unit: item.unit,
            confidence_pct: 0.1,
            parsing_source: 'unmatched',
            unmatched: true,
          });
          continue;
        }
      }

      decisions.push({
        agent: 'pipeline',
        action: 'match_food',
        entity_type: 'meal_item',
        details: {
          input: item.food,
          matched: match.food_name,
          food_id: match.food_id,
          match_type: match.match_type,
        },
        model_used: 'deterministic',
        confidence_pct: match.confidence,
      });

      // 2. Convert to grams
      let grams = null;
      let unitSource = 'unknown';

      if (item.unit) {
        const conversion = normalize.convertToGrams(
          this.db, match.food_id, item.quantity, item.unit
        );
        if (conversion) {
          grams = conversion.grams;
          unitSource = conversion.source;
        }
      }

      // No unit specified or conversion failed — try common defaults
      if (grams === null && !item.unit) {
        // If no unit given, assume grams if quantity > 10, else assume "piece/whole"
        if (item.quantity >= 10) {
          grams = item.quantity;
          unitSource = 'direct';
        } else {
          // Try "piece" or "whole" from unit_weights
          const pieceGrams = normalize.lookupUnitWeight(this.db, match.food_id, 'piece')
            || normalize.lookupUnitWeight(this.db, match.food_id, 'whole')
            || normalize.lookupUnitWeight(this.db, match.food_id, 'medium');
          if (pieceGrams) {
            grams = item.quantity * pieceGrams;
            unitSource = 'unit_weights';
          } else {
            // Fallback: assume 100g per unit
            grams = item.quantity * 100;
            unitSource = 'assumed_100g';
          }
        }
      }

      // Unit was specified but conversion failed
      if (grams === null && item.unit) {
        // TODO: LLM estimate for unknown unit conversions
        decisions.push({
          agent: 'pipeline',
          action: 'convert_unit',
          entity_type: 'meal_item',
          details: {
            food: match.food_name,
            unit: item.unit,
            result: 'unknown_unit',
            action_needed: 'LLM estimation or manual unit_weight entry needed',
          },
          model_used: null,
          confidence_pct: 0.3,
        });

        // Rough estimate: 1 unit ≈ 100g
        grams = item.quantity * 100;
        unitSource = 'llm_estimate';
      }

      const { amount, actual_grams } = normalize.calculateAmount(grams);

      // 3. Score confidence
      const confidence = normalize.scoreConfidence({
        match_type: match.match_type,
        unit_source: unitSource,
        quantity_explicit: item.quantity_explicit !== false,
      });

      decisions.push({
        agent: 'pipeline',
        action: 'convert_unit',
        entity_type: 'meal_item',
        details: {
          food: match.food_name,
          raw_qty: item.quantity,
          raw_unit: item.unit,
          grams: actual_grams,
          amount,
          unit_source: unitSource,
        },
        model_used: unitSource === 'llm_estimate' ? null : 'deterministic',
        confidence_pct: confidence,
      });

      resolved.push({
        food_id: match.food_id,
        food_name: match.food_name,
        amount,
        actual_grams,
        raw_quantity: item.quantity,
        raw_unit: item.unit,
        confidence_pct: confidence,
        parsing_source: match.match_type,
        unit_source: unitSource,
        from_composite: item.from_composite || null,
      });
    }

    return resolved;
  }

  // ============================================================
  // INTERNAL: Pre-Save Validation
  // ============================================================

  _validatePreSave(items, decisions) {
    const issues = [];

    // Filter out unmatched items for validation
    const matched = items.filter(i => !i.unmatched);

    for (const item of matched) {
      // Look up food calories for validation
      const food = this.db.prepare('SELECT calories FROM foods WHERE id = ?').get(item.food_id);
      const itemCal = food ? (food.calories || 0) * item.amount : 0;

      if (itemCal > 5000) {
        issues.push({
          type: 'error',
          item: item.food_name,
          message: `${Math.round(itemCal)} cal exceeds 5000 cal limit for single item`,
        });
      }

      if (item.actual_grams > 2000) {
        issues.push({
          type: 'warning',
          item: item.food_name,
          message: `${item.actual_grams}g is unusually large (>2kg)`,
        });
      }

      if (item.amount < 0) {
        issues.push({
          type: 'error',
          item: item.food_name,
          message: 'Negative quantity',
        });
      }

      if (!item.food_name || item.food_name.trim() === '') {
        issues.push({
          type: 'error',
          item: '(empty)',
          message: 'Empty food name',
        });
      }
    }

    // Total meal calories check
    const totalCal = matched.reduce((sum, item) => {
      const food = this.db.prepare('SELECT calories FROM foods WHERE id = ?').get(item.food_id);
      return sum + (food ? (food.calories || 0) * item.amount : 0);
    }, 0);

    if (totalCal > 6000) {
      issues.push({
        type: 'warning',
        item: 'total',
        message: `Total meal ${Math.round(totalCal)} cal exceeds 6000 cal`,
      });
    }

    // Check all required fields present
    for (const item of items) {
      if (item.unmatched) {
        issues.push({
          type: 'warning',
          item: item.food_name,
          message: 'Food not found in database — needs DIQQ resolution',
        });
      }
    }

    const valid = issues.filter(i => i.type === 'error').length === 0;

    decisions.push({
      agent: 'pipeline',
      action: 'validate',
      details: { valid, issue_count: issues.length, issues },
      model_used: 'deterministic',
    });

    return { valid, issues };
  }

  // ============================================================
  // INTERNAL: Helpers
  // ============================================================

  _calculateTotals(items) {
    const totals = {
      calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0,
      fiber_g: 0, sugar_g: 0,
    };

    for (const item of items) {
      if (item.unmatched || !item.food_id) continue;
      const food = this.db.prepare(
        'SELECT calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g FROM foods WHERE id = ?'
      ).get(item.food_id);
      if (!food) continue;

      totals.calories += (food.calories || 0) * item.amount;
      totals.protein_g += (food.protein_g || 0) * item.amount;
      totals.fat_g += (food.fat_g || 0) * item.amount;
      totals.carbs_g += (food.carbs_g || 0) * item.amount;
      totals.fiber_g += (food.fiber_g || 0) * item.amount;
      totals.sugar_g += (food.sugar_g || 0) * item.amount;
    }

    // Round
    for (const key of Object.keys(totals)) {
      totals[key] = Math.round(totals[key] * 10) / 10;
    }

    return totals;
  }

  _inferMealType() {
    const hour = new Date().getHours();
    if (hour < 10) return 'breakfast';
    if (hour < 14) return 'lunch';
    if (hour < 17) return 'snack';
    return 'dinner';
  }

  _buildMealTime(parsedTime) {
    const now = new Date();
    if (parsedTime) {
      const [h, m] = parsedTime.split(':').map(Number);
      now.setHours(h, m, 0, 0);
    }
    return now.toISOString().replace('T', ' ').slice(0, 19);
  }

  _generateTitle(items) {
    const names = items
      .filter(i => !i.unmatched)
      .map(i => i.food_name)
      .slice(0, 3);
    if (names.length === 0) return 'Meal';
    if (names.length <= 2) return names.join(' and ');
    return names.slice(0, 2).join(', ') + ' + more';
  }

  _compositeMealConfidence(items) {
    const matched = items.filter(i => !i.unmatched);
    if (matched.length === 0) return 0.2;
    const avg = matched.reduce((s, i) => s + (i.confidence_pct || 0), 0) / matched.length;
    return Math.round(avg * 100) / 100;
  }

  /**
   * Persist any LLM-estimated unit weights so future lookups are deterministic.
   */
  _persistNewUnitWeights(items) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO unit_weights (food_id, unit, grams, source)
      VALUES (?, ?, ?, ?)
    `);

    for (const item of items) {
      if (item.unit_source === 'llm_estimate' && item.food_id && item.raw_unit && item.actual_grams > 0) {
        const gramsPerUnit = item.actual_grams / (item.raw_quantity || 1);
        insert.run(item.food_id, item.raw_unit, gramsPerUnit, 'llm_estimate');
      }
    }
  }

  // ============================================================
  // REQUEST LOGGING
  // ============================================================

  /**
   * Log every process() call to pipeline_requests.
   * Returns the request ID for tracking through commit.
   */
  _logRequest(rawInput, intent, status, mealId, resultSummary, incompleteReason) {
    try {
      const result = this.db.prepare(`
        INSERT INTO pipeline_requests (raw_input, intent, status, meal_id, result_summary, incomplete_reason, confidence_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        rawInput,
        intent,
        status,
        mealId,
        resultSummary,
        incompleteReason,
        null
      );
      return Number(result.lastInsertRowid);
    } catch (err) {
      // Don't let logging failures break the pipeline
      console.error('Pipeline request log failed:', err.message);
      return null;
    }
  }

  /**
   * Update a request's status (e.g., pending → committed).
   */
  _updateRequestStatus(requestId, status, mealId) {
    try {
      const updates = ['status = ?'];
      const values = [status];

      if (status === 'committed') {
        updates.push('meal_id = ?', 'committed_at = datetime(\'now\')');
        values.push(mealId);
      } else if (status === 'confirmed') {
        updates.push('confirmed_at = datetime(\'now\')');
      }

      values.push(requestId);
      this.db.prepare(
        `UPDATE pipeline_requests SET ${updates.join(', ')} WHERE id = ?`
      ).run(...values);
    } catch (err) {
      console.error('Pipeline request status update failed:', err.message);
    }
  }

  // ============================================================
  // SWEEPS: stale request followup + audit
  // ============================================================

  /**
   * Find requests that were processed but never confirmed/committed.
   * Returns items that should be followed up on.
   * @param {number} staleMinutes - how old before we consider it stale (default 30)
   * @param {number} maxFollowups - stop pinging after this many (default 3)
   */
  sweepStaleRequests(staleMinutes = 30, maxFollowups = 3) {
    const stale = this.db.prepare(`
      SELECT * FROM pipeline_requests
      WHERE status = 'pending'
        AND followup_count < ?
        AND created_at < datetime('now', '-' || ? || ' minutes')
      ORDER BY created_at ASC
    `).all(maxFollowups, staleMinutes);

    return stale.map(req => ({
      id: req.id,
      raw_input: req.raw_input,
      created_at: req.created_at,
      followup_count: req.followup_count,
      age_description: this._ageDescription(req.created_at),
      summary: req.result_summary ? JSON.parse(req.result_summary) : null,
    }));
  }

  /**
   * Mark a stale request as followed up (bump counter).
   */
  markFollowedUp(requestId) {
    this.db.prepare(`
      UPDATE pipeline_requests
      SET followup_count = followup_count + 1,
          last_followup_at = datetime('now')
      WHERE id = ?
    `).run(requestId);
  }

  /**
   * Mark a request as abandoned (user said "no" or too many followups).
   */
  markAbandoned(requestId) {
    this._updateRequestStatus(requestId, 'abandoned', null);
  }

  /**
   * Expire requests that have been followed up too many times.
   */
  expireStaleRequests(maxFollowups = 3) {
    const expired = this.db.prepare(`
      UPDATE pipeline_requests
      SET status = 'expired'
      WHERE status = 'pending'
        AND followup_count >= ?
    `).run(maxFollowups);
    return expired.changes;
  }

  /**
   * Find committed meals that need audit review.
   * Targets: low confidence, recent, not yet audited.
   * @param {number} confidenceThreshold - review meals below this (default 0.6)
   */
  sweepForAudit(confidenceThreshold = 0.6) {
    const needsAudit = this.db.prepare(`
      SELECT pr.id as request_id, pr.raw_input, pr.meal_id, pr.confidence_pct as request_confidence,
             m.title, m.meal_type, m.confidence_pct as meal_confidence, m.created_at as meal_created
      FROM pipeline_requests pr
      JOIN meals m ON pr.meal_id = m.id
      WHERE pr.status = 'committed'
        AND (m.confidence_pct < ? OR m.confidence_pct IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM decision_log dl
          WHERE dl.entity_type = 'meal' AND dl.entity_id = m.id AND dl.agent = 'hayden' AND dl.action = 'audit'
        )
      ORDER BY m.confidence_pct ASC
    `).all(confidenceThreshold);

    return needsAudit;
  }

  /**
   * Get pipeline request stats for a time period.
   */
  getRequestStats(sinceDays = 7) {
    const stats = this.db.prepare(`
      SELECT
        status,
        COUNT(*) as count,
        AVG(confidence_pct) as avg_confidence
      FROM pipeline_requests
      WHERE created_at > datetime('now', '-' || ? || ' days')
      GROUP BY status
    `).all(sinceDays);

    const total = stats.reduce((s, r) => s + r.count, 0);
    const committed = (stats.find(s => s.status === 'committed') || {}).count || 0;
    const abandoned = (stats.find(s => s.status === 'abandoned') || {}).count || 0;
    const expired = (stats.find(s => s.status === 'expired') || {}).count || 0;
    const pending = (stats.find(s => s.status === 'pending') || {}).count || 0;

    return {
      total,
      committed,
      abandoned,
      expired,
      pending,
      commit_rate: total > 0 ? Math.round((committed / total) * 100) : 0,
      drop_rate: total > 0 ? Math.round(((abandoned + expired) / total) * 100) : 0,
      by_status: stats,
    };
  }

  _ageDescription(createdAt) {
    const mins = Math.round((Date.now() - new Date(createdAt + 'Z').getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  }
}

module.exports = Pipeline;
