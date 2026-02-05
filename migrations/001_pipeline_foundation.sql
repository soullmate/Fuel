-- Migration 001: Pipeline Foundation
-- Adds confidence scoring, meal linking, source tracking, unit weights,
-- decision logging, and known decompositions for the agentic pipeline.
-- All changes are additive (ALTER TABLE ADD, CREATE TABLE). No drops or renames.

-- ============================================================
-- meals: add pipeline fields
-- ============================================================
ALTER TABLE meals ADD COLUMN confidence_pct REAL DEFAULT 0.5;
ALTER TABLE meals ADD COLUMN parent_meal_id INTEGER REFERENCES meals(id);
ALTER TABLE meals ADD COLUMN is_partial BOOLEAN DEFAULT 0;
ALTER TABLE meals ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE meals ADD COLUMN source_timestamp DATETIME;

-- ============================================================
-- meal_items: add raw input preservation and confidence
-- ============================================================
ALTER TABLE meal_items ADD COLUMN raw_quantity REAL;
ALTER TABLE meal_items ADD COLUMN raw_unit TEXT;
ALTER TABLE meal_items ADD COLUMN confidence_pct REAL DEFAULT 0.5;
ALTER TABLE meal_items ADD COLUMN parsing_source TEXT;

-- ============================================================
-- foods: add confidence and density
-- ============================================================
ALTER TABLE foods ADD COLUMN confidence_pct REAL DEFAULT 1.0;
ALTER TABLE foods ADD COLUMN density_g_per_ml REAL;

-- ============================================================
-- unit_weights: deterministic unit-to-gram conversion reference
-- ============================================================
CREATE TABLE IF NOT EXISTS unit_weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
    unit TEXT NOT NULL,
    grams REAL NOT NULL,
    source TEXT DEFAULT 'usda',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(food_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_unit_weights_food ON unit_weights(food_id);
CREATE INDEX IF NOT EXISTS idx_unit_weights_unit ON unit_weights(unit);

-- ============================================================
-- decision_log: audit trail for every pipeline decision
-- ============================================================
CREATE TABLE IF NOT EXISTS decision_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,    -- 'meal', 'meal_item', 'food', 'input'
    entity_id INTEGER NOT NULL,
    agent TEXT NOT NULL,          -- 'logos', 'diqq', 'hayden', 'router', 'pipeline'
    action TEXT NOT NULL,         -- 'parse', 'match', 'convert', 'validate', 'audit', 'correct', 'classify'
    details TEXT,                 -- JSON blob with action-specific reasoning
    model_used TEXT,             -- 'haiku', 'sonnet', 'ollama', 'deterministic', null
    confidence_pct REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_decision_log_entity ON decision_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_decision_log_agent ON decision_log(agent);
CREATE INDEX IF NOT EXISTS idx_decision_log_created ON decision_log(created_at);

-- ============================================================
-- known_decompositions: cached composite meal breakdowns
-- ============================================================
CREATE TABLE IF NOT EXISTS known_decompositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_name TEXT NOT NULL UNIQUE,
    ingredients TEXT NOT NULL,    -- JSON array of {food_name, default_quantity, default_unit}
    source TEXT DEFAULT 'manual', -- 'manual', 'llm', 'verified'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_known_decompositions_name ON known_decompositions(meal_name);
