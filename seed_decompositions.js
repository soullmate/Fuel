#!/usr/bin/env node
// Seed known_decompositions table with common composite meals.
// Each entry maps a meal name to its ingredient breakdown.
// Safe to re-run — uses INSERT OR IGNORE with UNIQUE meal_name.

const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, 'web', 'node_modules', 'better-sqlite3'));

const DB_PATH = path.join(__dirname, 'food_tracker.db');

const DECOMPOSITIONS = [
  {
    meal_name: 'caesar salad',
    ingredients: [
      { food_name: 'romaine lettuce', default_quantity: 100, default_unit: 'g' },
      { food_name: 'parmesan', default_quantity: 20, default_unit: 'g' },
      { food_name: 'croutons', default_quantity: 30, default_unit: 'g' },
      { food_name: 'caesar dressing', default_quantity: 30, default_unit: 'ml' },
      { food_name: 'chicken breast', default_quantity: 120, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'eggs on toast',
    ingredients: [
      { food_name: 'egg', default_quantity: 2, default_unit: 'large' },
      { food_name: 'bread white', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'butter', default_quantity: 1, default_unit: 'tsp' },
    ],
  },
  {
    meal_name: 'eggs benedict',
    ingredients: [
      { food_name: 'egg', default_quantity: 2, default_unit: 'large' },
      { food_name: 'english muffin', default_quantity: 1, default_unit: 'piece' },
      { food_name: 'ham', default_quantity: 60, default_unit: 'g' },
      { food_name: 'hollandaise sauce', default_quantity: 40, default_unit: 'ml' },
    ],
  },
  {
    meal_name: 'avocado toast',
    ingredients: [
      { food_name: 'avocado', default_quantity: 0.5, default_unit: 'whole' },
      { food_name: 'bread whole wheat', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tsp' },
    ],
  },
  {
    meal_name: 'blt sandwich',
    ingredients: [
      { food_name: 'bacon', default_quantity: 4, default_unit: 'slice' },
      { food_name: 'lettuce', default_quantity: 30, default_unit: 'g' },
      { food_name: 'tomato', default_quantity: 3, default_unit: 'slice' },
      { food_name: 'bread white', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'mayonnaise', default_quantity: 1, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'chicken stir fry',
    ingredients: [
      { food_name: 'chicken breast', default_quantity: 150, default_unit: 'g' },
      { food_name: 'broccoli', default_quantity: 100, default_unit: 'g' },
      { food_name: 'capsicum', default_quantity: 80, default_unit: 'g' },
      { food_name: 'soy sauce', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'rice white cooked', default_quantity: 1, default_unit: 'cup' },
    ],
  },
  {
    meal_name: 'greek salad',
    ingredients: [
      { food_name: 'cucumber', default_quantity: 100, default_unit: 'g' },
      { food_name: 'tomato', default_quantity: 150, default_unit: 'g' },
      { food_name: 'red onion', default_quantity: 30, default_unit: 'g' },
      { food_name: 'feta cheese', default_quantity: 50, default_unit: 'g' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'olives', default_quantity: 30, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'protein smoothie',
    ingredients: [
      { food_name: 'banana', default_quantity: 1, default_unit: 'medium' },
      { food_name: 'protein powder', default_quantity: 30, default_unit: 'g' },
      { food_name: 'milk whole', default_quantity: 1, default_unit: 'cup' },
      { food_name: 'peanut butter', default_quantity: 1, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'oatmeal with fruit',
    ingredients: [
      { food_name: 'oatmeal', default_quantity: 40, default_unit: 'g' },
      { food_name: 'milk whole', default_quantity: 200, default_unit: 'ml' },
      { food_name: 'banana', default_quantity: 0.5, default_unit: 'medium' },
      { food_name: 'blueberries', default_quantity: 1, default_unit: 'handful' },
      { food_name: 'honey', default_quantity: 1, default_unit: 'tsp' },
    ],
  },
  {
    meal_name: 'tuna sandwich',
    ingredients: [
      { food_name: 'tuna canned', default_quantity: 95, default_unit: 'g' },
      { food_name: 'bread whole wheat', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'mayonnaise', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'lettuce', default_quantity: 20, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'pasta bolognese',
    ingredients: [
      { food_name: 'pasta cooked', default_quantity: 200, default_unit: 'g' },
      { food_name: 'ground beef 80/20', default_quantity: 120, default_unit: 'g' },
      { food_name: 'tomato sauce', default_quantity: 100, default_unit: 'ml' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'parmesan', default_quantity: 15, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'salmon with vegetables',
    ingredients: [
      { food_name: 'salmon', default_quantity: 1, default_unit: 'fillet' },
      { food_name: 'broccoli', default_quantity: 100, default_unit: 'g' },
      { food_name: 'sweet potato', default_quantity: 1, default_unit: 'medium' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'chicken wrap',
    ingredients: [
      { food_name: 'chicken breast', default_quantity: 120, default_unit: 'g' },
      { food_name: 'tortilla wrap', default_quantity: 1, default_unit: 'piece' },
      { food_name: 'lettuce', default_quantity: 30, default_unit: 'g' },
      { food_name: 'tomato', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'sour cream', default_quantity: 1, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'peanut butter toast',
    ingredients: [
      { food_name: 'bread whole wheat', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'peanut butter', default_quantity: 2, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'yogurt bowl',
    ingredients: [
      { food_name: 'greek yogurt', default_quantity: 1, default_unit: 'cup' },
      { food_name: 'blueberries', default_quantity: 1, default_unit: 'handful' },
      { food_name: 'almonds', default_quantity: 1, default_unit: 'handful' },
      { food_name: 'honey', default_quantity: 1, default_unit: 'tsp' },
    ],
  },
  {
    meal_name: 'grilled cheese sandwich',
    ingredients: [
      { food_name: 'bread white', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'cheese cheddar', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'butter', default_quantity: 1, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'fish and chips',
    ingredients: [
      { food_name: 'fish fillet battered', default_quantity: 170, default_unit: 'g' },
      { food_name: 'french fries', default_quantity: 150, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'acai bowl',
    ingredients: [
      { food_name: 'acai puree', default_quantity: 100, default_unit: 'g' },
      { food_name: 'banana', default_quantity: 1, default_unit: 'medium' },
      { food_name: 'blueberries', default_quantity: 50, default_unit: 'g' },
      { food_name: 'granola', default_quantity: 30, default_unit: 'g' },
      { food_name: 'honey', default_quantity: 1, default_unit: 'tsp' },
    ],
  },
  {
    meal_name: 'burrito bowl',
    ingredients: [
      { food_name: 'rice brown cooked', default_quantity: 1, default_unit: 'cup' },
      { food_name: 'chicken breast', default_quantity: 120, default_unit: 'g' },
      { food_name: 'black beans', default_quantity: 80, default_unit: 'g' },
      { food_name: 'avocado', default_quantity: 0.5, default_unit: 'whole' },
      { food_name: 'sour cream', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'salsa', default_quantity: 30, default_unit: 'ml' },
    ],
  },
  {
    meal_name: 'bacon and eggs',
    ingredients: [
      { food_name: 'bacon', default_quantity: 3, default_unit: 'rasher' },
      { food_name: 'egg', default_quantity: 2, default_unit: 'large' },
    ],
  },
  {
    meal_name: 'french toast',
    ingredients: [
      { food_name: 'bread white', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'egg', default_quantity: 1, default_unit: 'large' },
      { food_name: 'milk whole', default_quantity: 2, default_unit: 'tbsp' },
      { food_name: 'butter', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'maple syrup', default_quantity: 2, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'chicken salad',
    ingredients: [
      { food_name: 'chicken breast', default_quantity: 150, default_unit: 'g' },
      { food_name: 'lettuce', default_quantity: 80, default_unit: 'g' },
      { food_name: 'tomato', default_quantity: 1, default_unit: 'medium' },
      { food_name: 'cucumber', default_quantity: 60, default_unit: 'g' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'steak and vegetables',
    ingredients: [
      { food_name: 'beef steak', default_quantity: 200, default_unit: 'g' },
      { food_name: 'broccoli', default_quantity: 100, default_unit: 'g' },
      { food_name: 'sweet potato', default_quantity: 1, default_unit: 'medium' },
      { food_name: 'butter', default_quantity: 1, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'pancakes',
    ingredients: [
      { food_name: 'pancake', default_quantity: 3, default_unit: 'piece' },
      { food_name: 'butter', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'maple syrup', default_quantity: 2, default_unit: 'tbsp' },
    ],
  },
  {
    meal_name: 'muesli with milk',
    ingredients: [
      { food_name: 'muesli', default_quantity: 60, default_unit: 'g' },
      { food_name: 'milk whole', default_quantity: 1, default_unit: 'cup' },
    ],
  },
  {
    meal_name: 'caprese salad',
    ingredients: [
      { food_name: 'tomato', default_quantity: 200, default_unit: 'g' },
      { food_name: 'mozzarella', default_quantity: 125, default_unit: 'g' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'basil', default_quantity: 5, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'ham and cheese sandwich',
    ingredients: [
      { food_name: 'ham', default_quantity: 60, default_unit: 'g' },
      { food_name: 'cheese cheddar', default_quantity: 1, default_unit: 'slice' },
      { food_name: 'bread whole wheat', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'lettuce', default_quantity: 15, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'overnight oats',
    ingredients: [
      { food_name: 'oatmeal', default_quantity: 40, default_unit: 'g' },
      { food_name: 'greek yogurt', default_quantity: 100, default_unit: 'g' },
      { food_name: 'milk whole', default_quantity: 100, default_unit: 'ml' },
      { food_name: 'blueberries', default_quantity: 50, default_unit: 'g' },
      { food_name: 'honey', default_quantity: 1, default_unit: 'tsp' },
    ],
  },
  {
    meal_name: 'fried rice',
    ingredients: [
      { food_name: 'rice white cooked', default_quantity: 1.5, default_unit: 'cup' },
      { food_name: 'egg', default_quantity: 2, default_unit: 'large' },
      { food_name: 'soy sauce', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'olive oil', default_quantity: 1, default_unit: 'tbsp' },
      { food_name: 'spring onion', default_quantity: 20, default_unit: 'g' },
    ],
  },
  {
    meal_name: 'toast with butter',
    ingredients: [
      { food_name: 'bread white', default_quantity: 2, default_unit: 'slice' },
      { food_name: 'butter', default_quantity: 2, default_unit: 'tsp' },
    ],
  },
];

function run() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const insert = db.prepare(
    'INSERT OR IGNORE INTO known_decompositions (meal_name, ingredients, source) VALUES (?, ?, ?)'
  );

  let inserted = 0;
  let skipped = 0;

  const insertAll = db.transaction(() => {
    for (const d of DECOMPOSITIONS) {
      const result = insert.run(d.meal_name, JSON.stringify(d.ingredients), 'manual');
      if (result.changes > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }
  });

  console.log('Seeding known decompositions...');
  insertAll();
  console.log(`  ${inserted} inserted, ${skipped} skipped (already exist).`);

  const total = db.prepare('SELECT COUNT(*) as count FROM known_decompositions').get();
  console.log(`  Total decompositions: ${total.count}`);

  db.close();
  console.log('Done.');
}

run();
