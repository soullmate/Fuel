// Audit Pigeons — ephemeral audit workers for FUEL.
// Spawned by HAYDEN (or API), investigate one finding, write report, disappear.
// No persistent state. No Gas Town dependency. Pure FUEL infrastructure.
//
// Usage:
//   const Pigeon = require('./pigeon');
//   const pigeon = new Pigeon(db);
//   const report = pigeon.audit(mealId);      // audit one meal
//   const chase = pigeon.chase(requestId);     // chase one stale request
//   const flock = pigeon.flock();              // batch: audit all flagged

class Pigeon {
  constructor(db) {
    this.db = db;
  }

  // ============================================================
  // AUDIT: investigate a committed meal
  // ============================================================

  /**
   * Audit a single committed meal for correctness.
   * Checks: gram amounts, food matches, calorie sanity, decision chain integrity.
   * Writes findings to decision_log. Updates confidence if warranted.
   * @param {number} mealId
   * @returns {object} { mealId, findings[], confidence_before, confidence_after, verdict }
   */
  audit(mealId) {
    const meal = this.db.prepare('SELECT * FROM meals WHERE id = ?').get(mealId);
    if (!meal) return { mealId, error: 'meal_not_found' };

    const items = this.db.prepare(`
      SELECT mi.*, f.name as food_name, f.calories, f.protein_g, f.fat_g, f.carbs_g,
             f.serving_size, f.confidence_pct as food_confidence
      FROM meal_items mi
      JOIN foods f ON mi.food_id = f.id
      WHERE mi.meal_id = ?
    `).all(mealId);

    const decisions = this.db.prepare(
      'SELECT * FROM decision_log WHERE entity_id = ? ORDER BY created_at ASC'
    ).all(mealId);

    const findings = [];
    const confidenceBefore = meal.confidence_pct;

    // --- Check 1: Per-item gram sanity ---
    for (const item of items) {
      if (item.actual_grams > 2000) {
        findings.push({
          severity: 'error',
          check: 'gram_amount',
          item: item.food_name,
          detail: `${item.actual_grams}g is over 2kg for a single item`,
          suggestion: 'Likely a unit conversion error. Check raw_unit and unit_weights.',
        });
      }

      if (item.actual_grams <= 0) {
        findings.push({
          severity: 'error',
          check: 'gram_amount',
          item: item.food_name,
          detail: `${item.actual_grams}g — zero or negative grams`,
          suggestion: 'Unit conversion failed. Check if unit_weights entry exists.',
        });
      }

      // Suspiciously round numbers might indicate assumed_100g fallback
      if (item.actual_grams === 100 && item.parsing_source !== 'exact') {
        findings.push({
          severity: 'info',
          check: 'default_grams',
          item: item.food_name,
          detail: 'Exactly 100g — may be a fallback default, not actual measurement',
        });
      }
    }

    // --- Check 2: Per-item calorie sanity ---
    for (const item of items) {
      const itemCal = (item.calories || 0) * item.amount;
      if (itemCal > 3000) {
        findings.push({
          severity: 'error',
          check: 'calorie_amount',
          item: item.food_name,
          detail: `${Math.round(itemCal)} cal for single item exceeds 3000`,
          suggestion: 'Amount multiplier may be wrong. Check grams → amount conversion.',
        });
      }

      if (itemCal === 0 && item.calories === null) {
        findings.push({
          severity: 'warning',
          check: 'missing_nutrition',
          item: item.food_name,
          detail: 'Food has no calorie data — totals are incomplete',
          suggestion: 'Run DIQQ enrichment on this food.',
        });
      }
    }

    // --- Check 3: Total meal sanity ---
    const totalCal = items.reduce((s, i) => s + ((i.calories || 0) * i.amount), 0);
    if (totalCal > 4000) {
      findings.push({
        severity: 'warning',
        check: 'meal_total',
        detail: `Total meal ${Math.round(totalCal)} cal is unusually high`,
      });
    }
    if (totalCal === 0 && items.length > 0) {
      findings.push({
        severity: 'error',
        check: 'meal_total',
        detail: 'Meal has items but 0 total calories — nutrition data missing',
      });
    }
    if (items.length === 0) {
      findings.push({
        severity: 'error',
        check: 'empty_meal',
        detail: 'Meal has no items',
      });
    }

    // --- Check 4: Decision chain integrity ---
    if (decisions.length === 0) {
      findings.push({
        severity: 'warning',
        check: 'decision_chain',
        detail: 'No decision_log entries for this meal — pipeline audit trail missing',
      });
    } else {
      // Check that each meal_item has at least a match_food decision
      const matchDecisions = decisions.filter(d => d.action === 'match_food');
      if (matchDecisions.length < items.length) {
        findings.push({
          severity: 'info',
          check: 'decision_chain',
          detail: `${matchDecisions.length} match decisions for ${items.length} items — some items may lack audit trail`,
        });
      }
    }

    // --- Check 5: Low-confidence items ---
    for (const item of items) {
      if ((item.confidence_pct || 0) < 0.4) {
        findings.push({
          severity: 'warning',
          check: 'low_confidence',
          item: item.food_name,
          detail: `Confidence ${item.confidence_pct} is below 0.4`,
          suggestion: 'Food match or unit conversion was uncertain.',
        });
      }
    }

    // --- Check 6: Food confidence ---
    for (const item of items) {
      if ((item.food_confidence || 0) < 0.5) {
        findings.push({
          severity: 'info',
          check: 'food_data_quality',
          item: item.food_name,
          detail: `Food entry confidence is ${item.food_confidence} — nutritional data may be approximate`,
        });
      }
    }

    // --- Compute verdict and updated confidence ---
    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;

    let verdict;
    let confidenceAdjustment = 0;

    if (errors > 0) {
      verdict = 'needs_correction';
      confidenceAdjustment = -0.2;
    } else if (warnings > 0) {
      verdict = 'needs_review';
      confidenceAdjustment = -0.1;
    } else {
      verdict = 'clean';
      // Boost confidence if audit passes clean
      confidenceAdjustment = Math.min(0.1, 1.0 - (confidenceBefore || 0.5));
    }

    const confidenceAfter = Math.max(0, Math.min(1,
      (confidenceBefore || 0.5) + confidenceAdjustment
    ));

    // --- Write findings to DB ---
    this.db.prepare(`
      INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used, confidence_pct)
      VALUES ('meal', ?, 'pigeon', 'audit', ?, 'deterministic', ?)
    `).run(mealId, JSON.stringify({
      verdict,
      errors,
      warnings,
      findings,
      confidence_before: confidenceBefore,
      confidence_after: confidenceAfter,
    }), confidenceAfter);

    // Update meal confidence
    if (confidenceAfter !== confidenceBefore) {
      this.db.prepare('UPDATE meals SET confidence_pct = ? WHERE id = ?')
        .run(confidenceAfter, mealId);
    }

    return {
      mealId,
      verdict,
      findings,
      confidence_before: confidenceBefore,
      confidence_after: confidenceAfter,
      errors,
      warnings,
      infos: findings.filter(f => f.severity === 'info').length,
    };
  }

  // ============================================================
  // CHASE: follow up on a stale unconfirmed request
  // ============================================================

  /**
   * Evaluate a stale pipeline request and recommend what to do.
   * @param {number} requestId
   * @returns {object} { requestId, recommendation, message_for_captain, details }
   */
  chase(requestId) {
    const req = this.db.prepare('SELECT * FROM pipeline_requests WHERE id = ?').get(requestId);
    if (!req) return { requestId, error: 'request_not_found' };

    if (req.status !== 'pending') {
      return { requestId, recommendation: 'skip', reason: `Status is ${req.status}, not pending` };
    }

    const ageMinutes = Math.round((Date.now() - new Date(req.created_at + 'Z').getTime()) / 60000);
    const summary = req.result_summary ? JSON.parse(req.result_summary) : null;

    let recommendation;
    let messageForCaptain;

    if (req.followup_count >= 3) {
      // Already pinged 3 times — recommend expiring
      recommendation = 'expire';
      messageForCaptain = `Request "${req.raw_input}" has been pinged ${req.followup_count} times over ${this._ageDescription(req.created_at)} with no response. Recommending auto-expire.`;
    } else if (req.incomplete_reason) {
      // Was incomplete — foods couldn't be resolved
      recommendation = 'retry_or_expire';
      messageForCaptain = `Request "${req.raw_input}" from ${this._ageDescription(req.created_at)} was incomplete: ${req.incomplete_reason}. Could retry with updated food DB or expire.`;
    } else if (ageMinutes > 1440) {
      // Over 24 hours old
      recommendation = 'expire';
      messageForCaptain = `Request "${req.raw_input}" is ${this._ageDescription(req.created_at)} — likely forgotten. Recommending expire.`;
    } else if (ageMinutes > 120) {
      // Over 2 hours — gentle nudge
      recommendation = 'nudge';
      const foodList = summary
        ? summary.items.map(i => `${i.food} (${i.grams}g)`).join(', ')
        : req.raw_input;
      messageForCaptain = `Unlogged meal from ${this._ageDescription(req.created_at)}: ${foodList}. Should we log it or skip?`;
    } else {
      // Under 2 hours — still fresh, just flag
      recommendation = 'wait';
      messageForCaptain = `Request "${req.raw_input}" is ${this._ageDescription(req.created_at)} — still fresh, will check again later.`;
    }

    // Bump followup counter
    if (recommendation === 'nudge' || recommendation === 'expire') {
      this.db.prepare(`
        UPDATE pipeline_requests
        SET followup_count = followup_count + 1, last_followup_at = datetime('now')
        WHERE id = ?
      `).run(requestId);
    }

    // Auto-expire if recommended
    if (recommendation === 'expire') {
      this.db.prepare("UPDATE pipeline_requests SET status = 'expired' WHERE id = ?").run(requestId);
    }

    // Log the chase to decision_log
    this.db.prepare(`
      INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used)
      VALUES ('request', ?, 'pigeon', 'chase', ?, 'deterministic')
    `).run(requestId, JSON.stringify({
      recommendation,
      age_minutes: ageMinutes,
      followup_count: req.followup_count + 1,
    }));

    return {
      requestId,
      recommendation,
      message_for_captain: messageForCaptain,
      age: this._ageDescription(req.created_at),
      followup_count: req.followup_count + 1,
    };
  }

  // ============================================================
  // FLOCK: batch audit — HAYDEN calls this
  // ============================================================

  /**
   * Run a full audit sweep. Spawns pigeons for all flagged items.
   * @param {object} options
   * @param {number} options.auditConfidenceThreshold - audit meals below this (default 0.6)
   * @param {number} options.staleMinutes - chase requests older than this (default 30)
   * @param {number} options.maxFollowups - stop chasing after this many (default 3)
   * @returns {object} { audits[], chases[], summary }
   */
  flock(options = {}) {
    const {
      auditConfidenceThreshold = 0.6,
      staleMinutes = 30,
      maxFollowups = 3,
    } = options;

    const results = { audits: [], chases: [], summary: {} };

    // --- Audit committed meals ---
    const mealsToAudit = this.db.prepare(`
      SELECT m.id FROM meals m
      WHERE (m.confidence_pct < ? OR m.confidence_pct IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM decision_log dl
          WHERE dl.entity_type = 'meal' AND dl.entity_id = m.id
            AND dl.agent = 'pigeon' AND dl.action = 'audit'
        )
      ORDER BY m.confidence_pct ASC
      LIMIT 20
    `).all(auditConfidenceThreshold);

    for (const m of mealsToAudit) {
      const report = this.audit(m.id);
      results.audits.push(report);
    }

    // --- Chase stale requests ---
    const staleRequests = this.db.prepare(`
      SELECT id FROM pipeline_requests
      WHERE status = 'pending'
        AND followup_count < ?
        AND created_at < datetime('now', '-' || ? || ' minutes')
      ORDER BY created_at ASC
      LIMIT 20
    `).all(maxFollowups, staleMinutes);

    for (const r of staleRequests) {
      const chase = this.chase(r.id);
      results.chases.push(chase);
    }

    // --- Daily anomaly scan ---
    const anomalies = this._scanDailyAnomalies();
    results.anomalies = anomalies;

    // --- Summary ---
    results.summary = {
      meals_audited: results.audits.length,
      meals_clean: results.audits.filter(a => a.verdict === 'clean').length,
      meals_need_review: results.audits.filter(a => a.verdict === 'needs_review').length,
      meals_need_correction: results.audits.filter(a => a.verdict === 'needs_correction').length,
      requests_chased: results.chases.length,
      requests_nudged: results.chases.filter(c => c.recommendation === 'nudge').length,
      requests_expired: results.chases.filter(c => c.recommendation === 'expire').length,
      anomalies_found: anomalies.length,
      timestamp: new Date().toISOString(),
    };

    // Log the flock run itself
    this.db.prepare(`
      INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used)
      VALUES ('system', 0, 'pigeon', 'flock', ?, 'deterministic')
    `).run(JSON.stringify(results.summary));

    return results;
  }

  // ============================================================
  // INTERNAL: Daily anomaly scan
  // ============================================================

  _scanDailyAnomalies() {
    const anomalies = [];
    const today = new Date().toISOString().slice(0, 10);

    // Check today's total calories
    const dailyTotal = this.db.prepare(`
      SELECT SUM(f.calories * mi.amount) as total_cal, COUNT(DISTINCT m.id) as meal_count
      FROM meals m
      JOIN meal_items mi ON mi.meal_id = m.id
      JOIN foods f ON f.id = mi.food_id
      WHERE DATE(m.meal_time) = ?
    `).get(today);

    if (dailyTotal && dailyTotal.total_cal > 6000) {
      anomalies.push({
        type: 'high_daily_calories',
        detail: `${Math.round(dailyTotal.total_cal)} cal today across ${dailyTotal.meal_count} meals`,
        severity: 'warning',
      });
    }

    // Check for empty meals (meals with 0 items)
    const emptyMeals = this.db.prepare(`
      SELECT m.id, m.title FROM meals m
      LEFT JOIN meal_items mi ON mi.meal_id = m.id
      WHERE DATE(m.meal_time) = ? AND mi.id IS NULL
    `).all(today);

    for (const em of emptyMeals) {
      anomalies.push({
        type: 'empty_meal',
        meal_id: em.id,
        detail: `Meal "${em.title}" has no items`,
        severity: 'error',
      });
    }

    // Check for single items over 2kg or 5000 cal
    const extremeItems = this.db.prepare(`
      SELECT mi.id, f.name, mi.actual_grams, f.calories * mi.amount as item_cal
      FROM meal_items mi
      JOIN meals m ON m.id = mi.meal_id
      JOIN foods f ON f.id = mi.food_id
      WHERE DATE(m.meal_time) = ?
        AND (mi.actual_grams > 2000 OR f.calories * mi.amount > 5000)
    `).all(today);

    for (const ei of extremeItems) {
      anomalies.push({
        type: 'extreme_item',
        item: ei.name,
        detail: `${ei.actual_grams}g / ${Math.round(ei.item_cal)} cal`,
        severity: 'error',
      });
    }

    // Log anomalies if found
    if (anomalies.length > 0) {
      this.db.prepare(`
        INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used)
        VALUES ('system', 0, 'pigeon', 'anomaly_scan', ?, 'deterministic')
      `).run(JSON.stringify({ date: today, anomalies }));
    }

    return anomalies;
  }

  _ageDescription(createdAt) {
    const mins = Math.round((Date.now() - new Date(createdAt + 'Z').getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  }
}

module.exports = Pigeon;
