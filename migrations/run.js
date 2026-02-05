#!/usr/bin/env node
// Migration runner for FUEL database
// Applies schema.sql to create tables, then runs numbered migrations.
// Safe to re-run — uses CREATE IF NOT EXISTS and checks before ALTER.

const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, '..', 'web', 'node_modules', 'better-sqlite3'));

const DB_PATH = path.join(__dirname, '..', 'food_tracker.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

function getColumnNames(db, table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  } catch {
    return [];
  }
}

function tableExists(db, table) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(table);
  return !!row;
}

function run() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Step 1: Apply base schema (CREATE IF NOT EXISTS — always safe)
  console.log('Applying base schema...');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  try {
    db.exec(schema);
    console.log('  Base schema applied successfully.');
  } catch (err) {
    console.error(`  Schema error: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Apply numbered migrations (ALTER TABLEs)
  // Since schema.sql already has all columns, migrations are for
  // upgrading existing databases that predate the new columns.
  const migrations = fs.readdirSync(__dirname)
    .filter(f => f.match(/^\d+.*\.sql$/))
    .sort();

  for (const migration of migrations) {
    console.log(`Checking migration: ${migration}`);
    const sql = fs.readFileSync(path.join(__dirname, migration), 'utf8');

    // Parse ALTER TABLE statements and apply only missing columns
    const alterRegex = /ALTER TABLE (\w+) ADD COLUMN (\w+) (.+)/gi;
    let match;
    let applied = 0;
    let skipped = 0;

    while ((match = alterRegex.exec(sql)) !== null) {
      const [, table, column, definition] = match;
      const existing = getColumnNames(db, table);

      if (existing.includes(column)) {
        skipped++;
        continue;
      }

      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition.replace(/;$/, '')}`);
        applied++;
        console.log(`  Added ${table}.${column}`);
      } catch (err) {
        if (err.message.includes('duplicate column')) {
          skipped++;
        } else {
          console.error(`  Error adding ${table}.${column}: ${err.message}`);
        }
      }
    }

    // Parse CREATE TABLE/INDEX statements and apply if missing
    const createRegex = /CREATE (TABLE|INDEX) IF NOT EXISTS (\w+)/gi;
    while ((match = createRegex.exec(sql)) !== null) {
      // Already handled by the IF NOT EXISTS clause — just run them
    }

    // Run CREATE statements from migration
    const createStatements = sql.match(/CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS[\s\S]*?;/gi) || [];
    for (const stmt of createStatements) {
      try {
        db.exec(stmt);
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.error(`  Error: ${err.message}`);
        }
      }
    }

    console.log(`  ${applied} columns added, ${skipped} already existed.`);
  }

  // Step 3: Verify critical tables and columns
  console.log('\nVerifying schema...');
  const checks = [
    { table: 'foods', columns: ['confidence_pct', 'density_g_per_ml'] },
    { table: 'meals', columns: ['confidence_pct', 'parent_meal_id', 'is_partial', 'source', 'source_timestamp'] },
    { table: 'meal_items', columns: ['raw_quantity', 'raw_unit', 'confidence_pct', 'parsing_source'] },
    { table: 'unit_weights', columns: ['food_id', 'unit', 'grams', 'source'] },
    { table: 'decision_log', columns: ['entity_type', 'entity_id', 'agent', 'action', 'details', 'model_used', 'confidence_pct'] },
    { table: 'known_decompositions', columns: ['meal_name', 'ingredients', 'source'] },
  ];

  let allGood = true;
  for (const check of checks) {
    if (!tableExists(db, check.table)) {
      console.error(`  MISSING TABLE: ${check.table}`);
      allGood = false;
      continue;
    }
    const colNames = getColumnNames(db, check.table);
    for (const col of check.columns) {
      if (!colNames.includes(col)) {
        console.error(`  MISSING COLUMN: ${check.table}.${col}`);
        allGood = false;
      }
    }
  }

  if (allGood) {
    console.log('  All tables and columns verified.');
  }

  // Step 4: Ensure default user_settings row
  if (tableExists(db, 'user_settings')) {
    const settings = db.prepare('SELECT id FROM user_settings WHERE id = 1').get();
    if (!settings) {
      db.prepare('INSERT OR IGNORE INTO user_settings (id) VALUES (1)').run();
      console.log('  Default user_settings row inserted.');
    }
  }

  db.close();
  console.log('\nMigration complete.');
}

run();
