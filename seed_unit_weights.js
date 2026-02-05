#!/usr/bin/env node
// Seed unit_weights table with deterministic unit-to-gram conversions.
// Sources: USDA FoodData Central portion data, standard culinary measures.
// Safe to re-run — uses INSERT OR IGNORE with UNIQUE(food_id, unit).

const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, 'web', 'node_modules', 'better-sqlite3'));

const DB_PATH = path.join(__dirname, 'food_tracker.db');

// Food-specific unit weights from USDA portion data
// food_pattern matches against foods.name (case-insensitive LIKE)
const FOOD_WEIGHTS = [
  // Eggs
  { food: 'egg', weights: { large: 50, medium: 44, small: 38, piece: 50, whole: 50 } },

  // Dairy
  { food: 'milk whole', weights: { cup: 244, tbsp: 15, glass: 244 } },
  { food: 'greek yogurt', weights: { cup: 245, container: 170, serve: 170 } },
  { food: 'cheese cheddar', weights: { slice: 28, cup: 113, oz: 28 } },
  { food: 'butter', weights: { tbsp: 14, tsp: 5, pat: 5, stick: 113, cup: 227 } },

  // Proteins
  { food: 'chicken breast', weights: { piece: 174, breast: 174, fillet: 174, serve: 120 } },
  { food: 'salmon', weights: { fillet: 170, piece: 170, serve: 120 } },
  { food: 'ground beef', weights: { patty: 113, serve: 120, cup: 220 } },
  { food: 'bacon', weights: { slice: 8, rasher: 35, piece: 8, strip: 8 } },
  { food: 'tofu', weights: { block: 340, serve: 120, cup: 252, slice: 85 } },

  // Grains
  { food: 'rice white cooked', weights: { cup: 186, serve: 150, bowl: 250 } },
  { food: 'rice brown cooked', weights: { cup: 195, serve: 150, bowl: 250 } },
  { food: 'oatmeal', weights: { cup: 234, serve: 40, packet: 43 } },
  { food: 'bread whole wheat', weights: { slice: 28, piece: 28 } },
  { food: 'bread white', weights: { slice: 25, piece: 25 } },
  { food: 'pasta cooked', weights: { cup: 140, serve: 140, bowl: 250 } },

  // Vegetables
  { food: 'broccoli', weights: { cup: 91, floret: 11, serve: 85, head: 608 } },
  { food: 'spinach', weights: { cup: 30, bunch: 340, serve: 85, handful: 30 } },
  { food: 'sweet potato', weights: { medium: 130, large: 180, small: 100, cup: 133 } },
  { food: 'avocado', weights: { whole: 200, half: 100, medium: 200, small: 150, cup: 150 } },
  { food: 'tomato', weights: { medium: 123, large: 182, small: 91, cherry: 17, cup: 180, slice: 15 } },

  // Fruits
  { food: 'banana', weights: { medium: 118, large: 136, small: 101, piece: 118 } },
  { food: 'apple', weights: { medium: 182, large: 223, small: 149, piece: 182 } },
  { food: 'blueberries', weights: { cup: 148, handful: 40, serve: 75, punnet: 125 } },
  { food: 'orange', weights: { medium: 131, large: 184, small: 96, piece: 131 } },

  // Nuts & spreads
  { food: 'almonds', weights: { cup: 143, handful: 30, serve: 28, piece: 1.2 } },
  { food: 'peanut butter', weights: { tbsp: 16, tsp: 5, serve: 32, cup: 258 } },

  // Oils
  { food: 'olive oil', weights: { tbsp: 14, tsp: 5, drizzle: 5, splash: 7, cup: 216 } },

  // Drinks
  { food: 'coffee black', weights: { cup: 237, mug: 350, shot: 30 } },
  { food: 'orange juice', weights: { cup: 248, glass: 248, serve: 240 } },

  // Prepared foods
  { food: 'pizza cheese slice', weights: { slice: 107, piece: 107 } },
  { food: 'hamburger', weights: { whole: 226, piece: 226, serve: 226 } },

  // Honey
  { food: 'honey', weights: { tbsp: 21, tsp: 7, drizzle: 7, serve: 21 } },
];

// Universal unit defaults (used when no food-specific weight exists)
// These are water-density approximations for volume units
const UNIVERSAL_WEIGHTS = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  oz: 28.35,
  ounce: 28.35,
  lb: 453.6,
  pound: 453.6,
  tbsp: 15,
  tablespoon: 15,
  tsp: 5,
  teaspoon: 5,
  cup: 240,
  ml: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  fl_oz: 30,
  pint: 473,
};

function run() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const insert = db.prepare(
    'INSERT OR IGNORE INTO unit_weights (food_id, unit, grams, source) VALUES (?, ?, ?, ?)'
  );

  let totalInserted = 0;
  let totalSkipped = 0;

  // Insert food-specific weights
  const insertMany = db.transaction(() => {
    for (const entry of FOOD_WEIGHTS) {
      const food = db.prepare(
        'SELECT id FROM foods WHERE LOWER(name) = LOWER(?)'
      ).get(entry.food);

      if (!food) {
        console.log(`  Food not found: "${entry.food}" — skipping (will be added when food is seeded)`);
        continue;
      }

      for (const [unit, grams] of Object.entries(entry.weights)) {
        const result = insert.run(food.id, unit, grams, 'usda');
        if (result.changes > 0) {
          totalInserted++;
        } else {
          totalSkipped++;
        }
      }
    }
  });

  console.log('Seeding unit weights...');
  insertMany();
  console.log(`  Food-specific: ${totalInserted} inserted, ${totalSkipped} skipped.`);

  // Note: Universal weights are handled in normalize.js at lookup time
  // (if no food-specific weight found, fall back to universal map).
  // We don't insert them per-food to avoid table bloat.

  const total = db.prepare('SELECT COUNT(*) as count FROM unit_weights').get();
  console.log(`  Total unit_weights rows: ${total.count}`);

  db.close();
  console.log('Done.');
}

run();
