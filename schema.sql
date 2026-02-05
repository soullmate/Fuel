-- Food Tracker Database Schema
-- Designed for comprehensive nutritional tracking

-- Foods table: master list of all foods with full nutritional data
CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT,
    serving_size REAL NOT NULL DEFAULT 100,
    serving_unit TEXT NOT NULL DEFAULT 'g',
    
    -- Macronutrients (per serving)
    calories REAL,
    protein_g REAL,
    fat_g REAL,
    saturated_fat_g REAL,
    trans_fat_g REAL,
    monounsaturated_fat_g REAL,
    polyunsaturated_fat_g REAL,
    cholesterol_mg REAL,
    carbs_g REAL,
    fiber_g REAL,
    sugar_g REAL,
    added_sugar_g REAL,
    sugar_alcohols_g REAL,
    net_carbs_g REAL,  -- calculated: total_carbs - fiber - sugar_alcohols
    
    -- Minerals (per serving)
    sodium_mg REAL,
    potassium_mg REAL,
    calcium_mg REAL,
    iron_mg REAL,
    magnesium_mg REAL,
    phosphorus_mg REAL,
    zinc_mg REAL,
    copper_mg REAL,
    manganese_mg REAL,
    selenium_mcg REAL,
    chromium_mcg REAL,
    molybdenum_mcg REAL,
    iodine_mcg REAL,
    
    -- Vitamins (per serving)
    vitamin_a_mcg REAL,        -- RAE
    vitamin_c_mg REAL,
    vitamin_d_mcg REAL,
    vitamin_e_mg REAL,
    vitamin_k_mcg REAL,
    thiamin_mg REAL,           -- B1
    riboflavin_mg REAL,        -- B2
    niacin_mg REAL,            -- B3
    pantothenic_acid_mg REAL,  -- B5
    vitamin_b6_mg REAL,
    biotin_mcg REAL,           -- B7
    folate_mcg REAL,           -- B9
    vitamin_b12_mcg REAL,
    choline_mg REAL,
    
    -- Amino Acids (per serving, in g)
    histidine_g REAL,
    isoleucine_g REAL,
    leucine_g REAL,
    lysine_g REAL,
    methionine_g REAL,
    phenylalanine_g REAL,
    threonine_g REAL,
    tryptophan_g REAL,
    valine_g REAL,
    
    -- Fatty Acids (per serving, in g)
    omega_3_g REAL,
    omega_6_g REAL,
    epa_g REAL,
    dha_g REAL,
    ala_g REAL,
    
    -- Other
    caffeine_mg REAL,
    alcohol_g REAL,
    water_g REAL,
    
    -- Metadata
    data_source TEXT,          -- 'usda', 'manual', 'nutrition_label', etc.
    usda_fdc_id INTEGER,       -- USDA FoodData Central ID if available
    barcode TEXT,
    confidence_pct REAL DEFAULT 1.0,
    density_g_per_ml REAL,
    usda_enriched INTEGER DEFAULT 0,  -- 1 = USDA lookup done (skip re-check even if no match)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create index on food name for fast lookups
CREATE INDEX IF NOT EXISTS idx_foods_name ON foods(name);
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode);

-- Meals table: when the user ate
CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_type TEXT,            -- 'breakfast', 'lunch', 'dinner', 'snack', 'other'
    meal_time DATETIME NOT NULL,
    title TEXT,                -- Short descriptive name (e.g., "Protein oat porridge")
    notes TEXT,
    photo_url TEXT,
    confidence_pct REAL DEFAULT 0.5,
    parent_meal_id INTEGER REFERENCES meals(id),
    is_partial BOOLEAN DEFAULT 0,
    source TEXT DEFAULT 'manual',
    source_timestamp DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meals_time ON meals(meal_time);

-- Meal items: what was in each meal
CREATE TABLE IF NOT EXISTS meal_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_id INTEGER NOT NULL,
    food_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 1,  -- Multiplier: 1.0 = 100g (serving_size)
    quantity REAL,                    -- Legacy field
    unit TEXT,                        -- 'serving', 'g', 'oz', 'cup', etc.
    actual_grams REAL,                -- Actual grams eaten (amount × 100)
    raw_quantity REAL,                -- Original quantity from user input
    raw_unit TEXT,                    -- Original unit from user input
    confidence_pct REAL DEFAULT 0.5, -- Pipeline confidence score
    parsing_source TEXT,             -- Which method parsed this item
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
    FOREIGN KEY (food_id) REFERENCES foods(id)
);

CREATE INDEX IF NOT EXISTS idx_meal_items_meal ON meal_items(meal_id);

-- Daily goals table (optional, for tracking against targets)
CREATE TABLE IF NOT EXISTS daily_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    effective_date DATE NOT NULL,
    calories REAL,
    protein_g REAL,
    fat_g REAL,
    carbs_g REAL,
    fiber_g REAL,
    sugar_g REAL,
    sodium_mg REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Weight/body tracking (optional but useful context)
CREATE TABLE IF NOT EXISTS body_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    measured_at DATETIME NOT NULL,
    weight_kg REAL,
    body_fat_pct REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recipe table for composite foods
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    total_servings REAL DEFAULT 1,
    serving_description TEXT,
    instructions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recipe ingredients
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    food_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT,
    actual_grams REAL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (food_id) REFERENCES foods(id)
);

-- Grocery list items (for generating lists)
CREATE TABLE IF NOT EXISTS grocery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER,
    custom_name TEXT,          -- for items not in foods table
    category TEXT,             -- 'produce', 'dairy', 'meat', 'pantry', etc.
    quantity REAL,
    unit TEXT,
    frequency_per_week REAL,   -- calculated from meal patterns
    last_suggested DATE,
    is_staple BOOLEAN DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (food_id) REFERENCES foods(id)
);

-- User settings (singleton table - only one row)
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    weight_kg REAL DEFAULT 70,
    height_cm REAL DEFAULT 170,
    age INTEGER DEFAULT 30,
    sex TEXT DEFAULT 'female',
    goal TEXT DEFAULT 'maintenance',
    activity_level TEXT DEFAULT 'moderate',
    activity_mult REAL DEFAULT 1.2,
    training_cal INTEGER DEFAULT 300,
    -- Carb cycling settings
    carb_cycling_enabled INTEGER DEFAULT 0,  -- 0=off (simple tracker), 1=on (cycle phases)
    cycle_start_date TEXT DEFAULT (date('now')),  -- When the current cycle started
    cycle_length INTEGER DEFAULT 28,
    buffer_days INTEGER DEFAULT 4,    -- High-carb buffer days at cycle boundaries
    fasting_duration INTEGER DEFAULT 2,
    keto_strictness REAL DEFAULT 50,
    protein_per_kg REAL DEFAULT 1.6,
    max_cheat_sugar INTEGER DEFAULT 50,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default row if not exists
INSERT OR IGNORE INTO user_settings (id) VALUES (1);

-- View for daily nutrition totals
CREATE VIEW IF NOT EXISTS daily_nutrition AS
SELECT 
    DATE(m.meal_time) as date,
    COUNT(DISTINCT m.id) as meal_count,
    SUM(f.calories * mi.actual_grams / f.serving_size) as total_calories,
    SUM(f.protein_g * mi.actual_grams / f.serving_size) as total_protein_g,
    SUM(f.fat_g * mi.actual_grams / f.serving_size) as total_fat_g,
    SUM(f.saturated_fat_g * mi.actual_grams / f.serving_size) as total_saturated_fat_g,
    SUM(f.carbs_g * mi.actual_grams / f.serving_size) as total_carbs_g,
    SUM(f.fiber_g * mi.actual_grams / f.serving_size) as total_fiber_g,
    SUM(f.sugar_g * mi.actual_grams / f.serving_size) as total_sugar_g,
    SUM(f.sodium_mg * mi.actual_grams / f.serving_size) as total_sodium_mg,
    SUM(f.potassium_mg * mi.actual_grams / f.serving_size) as total_potassium_mg,
    SUM(f.calcium_mg * mi.actual_grams / f.serving_size) as total_calcium_mg,
    SUM(f.iron_mg * mi.actual_grams / f.serving_size) as total_iron_mg,
    SUM(f.vitamin_a_mcg * mi.actual_grams / f.serving_size) as total_vitamin_a_mcg,
    SUM(f.vitamin_c_mg * mi.actual_grams / f.serving_size) as total_vitamin_c_mg,
    SUM(f.vitamin_d_mcg * mi.actual_grams / f.serving_size) as total_vitamin_d_mcg
FROM meals m
JOIN meal_items mi ON m.id = mi.meal_id
JOIN foods f ON mi.food_id = f.id
GROUP BY DATE(m.meal_time);

-- ============================================================
-- Unit weights: deterministic unit-to-gram conversion reference
-- ============================================================
CREATE TABLE IF NOT EXISTS unit_weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
    unit TEXT NOT NULL,              -- 'cup', 'tbsp', 'large', 'slice', 'piece', etc.
    grams REAL NOT NULL,             -- 1 unit = X grams
    source TEXT DEFAULT 'usda',      -- 'usda', 'manual', 'llm_estimate'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(food_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_unit_weights_food ON unit_weights(food_id);
CREATE INDEX IF NOT EXISTS idx_unit_weights_unit ON unit_weights(unit);

-- ============================================================
-- Decision log: audit trail for every pipeline decision
-- ============================================================
CREATE TABLE IF NOT EXISTS decision_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,       -- 'meal', 'meal_item', 'food', 'input'
    entity_id INTEGER NOT NULL,
    agent TEXT NOT NULL,             -- 'logos', 'diqq', 'hayden', 'router', 'pipeline'
    action TEXT NOT NULL,            -- 'parse', 'match', 'convert', 'validate', 'audit', 'correct'
    details TEXT,                    -- JSON blob with action-specific reasoning
    model_used TEXT,                 -- 'haiku', 'sonnet', 'ollama', 'deterministic', null
    confidence_pct REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_decision_log_entity ON decision_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_decision_log_agent ON decision_log(agent);
CREATE INDEX IF NOT EXISTS idx_decision_log_created ON decision_log(created_at);

-- ============================================================
-- Known decompositions: cached composite meal breakdowns
-- ============================================================
CREATE TABLE IF NOT EXISTS known_decompositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_name TEXT NOT NULL UNIQUE,
    ingredients TEXT NOT NULL,       -- JSON array of {food_name, default_quantity, default_unit}
    source TEXT DEFAULT 'manual',    -- 'manual', 'llm', 'verified'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_known_decompositions_name ON known_decompositions(meal_name);

-- ============================================================
-- Pipeline requests: logs every process() call regardless of outcome
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_input TEXT NOT NULL,              -- exactly what the user typed
    intent TEXT,                          -- classified intent (log, correction, advice, query, system)
    status TEXT NOT NULL DEFAULT 'pending', -- pending → confirmed → committed | abandoned | expired
    meal_id INTEGER REFERENCES meals(id), -- set on commit, NULL until then
    result_summary TEXT,                  -- JSON: {items, totals, confidence} snapshot
    incomplete_reason TEXT,               -- if status=incomplete, why (unresolved foods, etc.)
    confidence_pct REAL,                  -- overall pipeline confidence
    followup_count INTEGER DEFAULT 0,    -- how many times we've pinged about this
    last_followup_at DATETIME,           -- when we last asked "still relevant?"
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME,               -- when user said "yes, log it"
    committed_at DATETIME                -- when commit() wrote to meals
);

CREATE INDEX IF NOT EXISTS idx_pipeline_requests_status ON pipeline_requests(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_created ON pipeline_requests(created_at);

-- ============================================================
-- Food history: append-only mutation log (the "refinery" audit trail)
-- Every UPDATE or DELETE on foods is captured automatically via triggers.
-- Nothing disappears — even if a food is deleted, the history stays.
-- ============================================================
CREATE TABLE IF NOT EXISTS food_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER NOT NULL,
    operation TEXT NOT NULL,          -- 'update' or 'delete'
    old_values TEXT NOT NULL,         -- JSON snapshot of previous state
    new_values TEXT,                  -- JSON snapshot of new state (NULL for delete)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_food_history_food ON food_history(food_id);
CREATE INDEX IF NOT EXISTS idx_food_history_created ON food_history(created_at);

-- Trigger: log every meaningful UPDATE on foods
-- Fires when any nutritional, metadata, or identity field changes.
-- Skips updates that only touch updated_at (noise from timestamp bumps).
CREATE TRIGGER IF NOT EXISTS trg_food_history_update
AFTER UPDATE ON foods
WHEN OLD.name != NEW.name
   OR COALESCE(OLD.brand, '') != COALESCE(NEW.brand, '')
   OR COALESCE(OLD.calories, -1) != COALESCE(NEW.calories, -1)
   OR COALESCE(OLD.protein_g, -1) != COALESCE(NEW.protein_g, -1)
   OR COALESCE(OLD.fat_g, -1) != COALESCE(NEW.fat_g, -1)
   OR COALESCE(OLD.carbs_g, -1) != COALESCE(NEW.carbs_g, -1)
   OR COALESCE(OLD.fiber_g, -1) != COALESCE(NEW.fiber_g, -1)
   OR COALESCE(OLD.sugar_g, -1) != COALESCE(NEW.sugar_g, -1)
   OR COALESCE(OLD.sodium_mg, -1) != COALESCE(NEW.sodium_mg, -1)
   OR COALESCE(OLD.potassium_mg, -1) != COALESCE(NEW.potassium_mg, -1)
   OR COALESCE(OLD.calcium_mg, -1) != COALESCE(NEW.calcium_mg, -1)
   OR COALESCE(OLD.iron_mg, -1) != COALESCE(NEW.iron_mg, -1)
   OR COALESCE(OLD.serving_size, -1) != COALESCE(NEW.serving_size, -1)
   OR COALESCE(OLD.serving_unit, '') != COALESCE(NEW.serving_unit, '')
   OR COALESCE(OLD.confidence_pct, -1) != COALESCE(NEW.confidence_pct, -1)
   OR COALESCE(OLD.data_source, '') != COALESCE(NEW.data_source, '')
   OR COALESCE(OLD.usda_enriched, -1) != COALESCE(NEW.usda_enriched, -1)
   OR COALESCE(OLD.usda_fdc_id, -1) != COALESCE(NEW.usda_fdc_id, -1)
BEGIN
  INSERT INTO food_history (food_id, operation, old_values, new_values)
  VALUES (
    OLD.id,
    'update',
    json_object(
      'name', OLD.name, 'brand', OLD.brand,
      'calories', OLD.calories, 'protein_g', OLD.protein_g,
      'fat_g', OLD.fat_g, 'carbs_g', OLD.carbs_g,
      'fiber_g', OLD.fiber_g, 'sugar_g', OLD.sugar_g,
      'sodium_mg', OLD.sodium_mg, 'potassium_mg', OLD.potassium_mg,
      'calcium_mg', OLD.calcium_mg, 'iron_mg', OLD.iron_mg,
      'serving_size', OLD.serving_size, 'serving_unit', OLD.serving_unit,
      'confidence_pct', OLD.confidence_pct, 'data_source', OLD.data_source,
      'usda_enriched', OLD.usda_enriched, 'usda_fdc_id', OLD.usda_fdc_id
    ),
    json_object(
      'name', NEW.name, 'brand', NEW.brand,
      'calories', NEW.calories, 'protein_g', NEW.protein_g,
      'fat_g', NEW.fat_g, 'carbs_g', NEW.carbs_g,
      'fiber_g', NEW.fiber_g, 'sugar_g', NEW.sugar_g,
      'sodium_mg', NEW.sodium_mg, 'potassium_mg', NEW.potassium_mg,
      'calcium_mg', NEW.calcium_mg, 'iron_mg', NEW.iron_mg,
      'serving_size', NEW.serving_size, 'serving_unit', NEW.serving_unit,
      'confidence_pct', NEW.confidence_pct, 'data_source', NEW.data_source,
      'usda_enriched', NEW.usda_enriched, 'usda_fdc_id', NEW.usda_fdc_id
    )
  );
END;

-- Trigger: log every DELETE on foods (should be rare, but capture it)
CREATE TRIGGER IF NOT EXISTS trg_food_history_delete
AFTER DELETE ON foods
BEGIN
  INSERT INTO food_history (food_id, operation, old_values, new_values)
  VALUES (
    OLD.id,
    'delete',
    json_object(
      'name', OLD.name, 'brand', OLD.brand,
      'calories', OLD.calories, 'protein_g', OLD.protein_g,
      'fat_g', OLD.fat_g, 'carbs_g', OLD.carbs_g,
      'fiber_g', OLD.fiber_g, 'sugar_g', OLD.sugar_g,
      'sodium_mg', OLD.sodium_mg, 'potassium_mg', OLD.potassium_mg,
      'calcium_mg', OLD.calcium_mg, 'iron_mg', OLD.iron_mg,
      'serving_size', OLD.serving_size, 'serving_unit', OLD.serving_unit,
      'confidence_pct', OLD.confidence_pct, 'data_source', OLD.data_source,
      'usda_enriched', OLD.usda_enriched, 'usda_fdc_id', OLD.usda_fdc_id
    ),
    NULL
  );
END;

-- ============================================================
-- Agent reports: communication channel from background agents to PA
-- Background agents (HAYDEN, DIQQ, RICKY) write reports here.
-- The PA scan cron reads pending reports and processes them.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,              -- 'hayden', 'diqq', 'ricky', 'gera', 'zeus'
    severity TEXT DEFAULT 'info',     -- 'critical', 'high', 'medium', 'low', 'info'
    category TEXT,                    -- 'health', 'data_quality', 'learning', 'anomaly', 'preference'
    summary TEXT NOT NULL,            -- One-line summary for PA
    details TEXT,                     -- JSON blob for structured data
    for_human INTEGER DEFAULT 0,      -- 1 = needs human decision, 0 = PA can handle
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME,         -- NULL until PA processes
    resolution TEXT                   -- What PA did with it
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_pending
    ON agent_reports(acknowledged_at) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_reports_agent ON agent_reports(agent);
CREATE INDEX IF NOT EXISTS idx_agent_reports_severity ON agent_reports(severity);
