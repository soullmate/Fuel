#!/usr/bin/env python3
"""
Seed database with demo data for screenshots and testing.
Creates generic foods and a week of realistic sample meals.
Run on a FRESH database (after schema.sql).
"""

import sqlite3
import random
from datetime import datetime, timedelta

DB_PATH = 'food_tracker.db'

# ─── Common foods with USDA-sourced nutrition (per 100g) ───

DEMO_FOODS = [
    # Proteins
    {'name': 'egg', 'serving_size': 50, 'serving_unit': 'g',
     'calories': 143, 'protein_g': 12.6, 'fat_g': 9.5, 'carbs_g': 0.7, 'fiber_g': 0, 'sugar_g': 0.4,
     'sodium_mg': 142, 'potassium_mg': 138, 'calcium_mg': 56, 'iron_mg': 1.75,
     'vitamin_a_mcg': 160, 'vitamin_d_mcg': 2.0, 'vitamin_b12_mcg': 0.89, 'choline_mg': 294,
     'magnesium_mg': 12, 'zinc_mg': 1.29, 'category': 'protein'},
    {'name': 'chicken breast', 'serving_size': 120, 'serving_unit': 'g',
     'calories': 165, 'protein_g': 31.0, 'fat_g': 3.6, 'carbs_g': 0, 'fiber_g': 0, 'sugar_g': 0,
     'sodium_mg': 74, 'potassium_mg': 256, 'iron_mg': 1.04, 'zinc_mg': 1.0,
     'vitamin_b12_mcg': 0.34, 'magnesium_mg': 29, 'category': 'protein'},
    {'name': 'salmon fillet', 'serving_size': 150, 'serving_unit': 'g',
     'calories': 208, 'protein_g': 20.4, 'fat_g': 13.4, 'carbs_g': 0, 'fiber_g': 0, 'sugar_g': 0,
     'sodium_mg': 59, 'potassium_mg': 363, 'calcium_mg': 12, 'iron_mg': 0.8,
     'vitamin_d_mcg': 11.0, 'vitamin_b12_mcg': 3.2, 'omega_3_g': 2.3, 'magnesium_mg': 30, 'zinc_mg': 0.6,
     'category': 'protein'},
    {'name': 'greek yogurt', 'serving_size': 170, 'serving_unit': 'g',
     'calories': 97, 'protein_g': 17.3, 'fat_g': 0.7, 'carbs_g': 5.7, 'fiber_g': 0, 'sugar_g': 4.0,
     'calcium_mg': 187, 'potassium_mg': 220, 'sodium_mg': 56, 'vitamin_b12_mcg': 0.75,
     'magnesium_mg': 11, 'zinc_mg': 0.6, 'category': 'dairy'},
    {'name': 'tofu (firm)', 'serving_size': 100, 'serving_unit': 'g',
     'calories': 76, 'protein_g': 8.0, 'fat_g': 4.8, 'carbs_g': 1.9, 'fiber_g': 0.3, 'sugar_g': 0.6,
     'calcium_mg': 350, 'iron_mg': 5.4, 'magnesium_mg': 30, 'zinc_mg': 0.8,
     'sodium_mg': 7, 'potassium_mg': 121, 'category': 'protein'},
    {'name': 'egg whites', 'serving_size': 100, 'serving_unit': 'g',
     'calories': 52, 'protein_g': 10.9, 'fat_g': 0.2, 'carbs_g': 0.7, 'fiber_g': 0, 'sugar_g': 0.7,
     'sodium_mg': 166, 'potassium_mg': 163, 'calcium_mg': 7, 'iron_mg': 0.08,
     'magnesium_mg': 11, 'zinc_mg': 0.03, 'category': 'protein'},

    # Grains & Carbs
    {'name': 'brown rice (cooked)', 'serving_size': 150, 'serving_unit': 'g',
     'calories': 123, 'protein_g': 2.7, 'fat_g': 1.0, 'carbs_g': 25.6, 'fiber_g': 1.6, 'sugar_g': 0.4,
     'magnesium_mg': 39, 'potassium_mg': 79, 'iron_mg': 0.56, 'zinc_mg': 0.63,
     'sodium_mg': 4, 'category': 'grain'},
    {'name': 'oats (rolled)', 'serving_size': 40, 'serving_unit': 'g',
     'calories': 389, 'protein_g': 16.9, 'fat_g': 6.9, 'carbs_g': 66.3, 'fiber_g': 10.6, 'sugar_g': 0.9,
     'iron_mg': 4.7, 'magnesium_mg': 177, 'zinc_mg': 3.97, 'potassium_mg': 429,
     'sodium_mg': 2, 'category': 'grain'},
    {'name': 'sourdough bread', 'serving_size': 50, 'serving_unit': 'g',
     'calories': 274, 'protein_g': 10.0, 'fat_g': 3.0, 'carbs_g': 51.0, 'fiber_g': 3.0, 'sugar_g': 3.0,
     'sodium_mg': 500, 'calcium_mg': 20, 'iron_mg': 3.0, 'magnesium_mg': 30,
     'potassium_mg': 120, 'zinc_mg': 1.0, 'category': 'grain'},
    {'name': 'quinoa (cooked)', 'serving_size': 150, 'serving_unit': 'g',
     'calories': 120, 'protein_g': 4.4, 'fat_g': 1.9, 'carbs_g': 21.3, 'fiber_g': 2.8, 'sugar_g': 0.9,
     'iron_mg': 1.49, 'magnesium_mg': 64, 'potassium_mg': 172, 'zinc_mg': 1.09,
     'sodium_mg': 7, 'category': 'grain'},
    {'name': 'sweet potato (baked)', 'serving_size': 150, 'serving_unit': 'g',
     'calories': 90, 'protein_g': 2.0, 'fat_g': 0.1, 'carbs_g': 20.7, 'fiber_g': 3.3, 'sugar_g': 6.5,
     'vitamin_a_mcg': 961, 'vitamin_c_mg': 19.6, 'potassium_mg': 475, 'magnesium_mg': 27,
     'sodium_mg': 36, 'calcium_mg': 38, 'iron_mg': 0.69, 'category': 'vegetable'},

    # Vegetables
    {'name': 'spinach', 'serving_size': 100, 'serving_unit': 'g',
     'calories': 23, 'protein_g': 2.9, 'fat_g': 0.4, 'carbs_g': 3.6, 'fiber_g': 2.2, 'sugar_g': 0.4,
     'vitamin_a_mcg': 469, 'vitamin_c_mg': 28.1, 'iron_mg': 2.71, 'calcium_mg': 99,
     'magnesium_mg': 79, 'potassium_mg': 558, 'zinc_mg': 0.53, 'sodium_mg': 79, 'category': 'vegetable'},
    {'name': 'broccoli', 'serving_size': 100, 'serving_unit': 'g',
     'calories': 34, 'protein_g': 2.8, 'fat_g': 0.4, 'carbs_g': 6.6, 'fiber_g': 2.6, 'sugar_g': 1.7,
     'vitamin_c_mg': 89.2, 'vitamin_a_mcg': 31, 'calcium_mg': 47, 'iron_mg': 0.73,
     'potassium_mg': 316, 'magnesium_mg': 21, 'zinc_mg': 0.41, 'sodium_mg': 33, 'category': 'vegetable'},
    {'name': 'avocado', 'serving_size': 70, 'serving_unit': 'g',
     'calories': 160, 'protein_g': 2.0, 'fat_g': 14.7, 'carbs_g': 8.5, 'fiber_g': 6.7, 'sugar_g': 0.7,
     'potassium_mg': 485, 'magnesium_mg': 29, 'vitamin_c_mg': 10.0, 'vitamin_e_mg': 2.1,
     'sodium_mg': 7, 'calcium_mg': 12, 'iron_mg': 0.55, 'zinc_mg': 0.64, 'category': 'vegetable'},
    {'name': 'mixed salad greens', 'serving_size': 50, 'serving_unit': 'g',
     'calories': 20, 'protein_g': 1.5, 'fat_g': 0.3, 'carbs_g': 3.0, 'fiber_g': 1.5, 'sugar_g': 0.8,
     'vitamin_a_mcg': 300, 'vitamin_c_mg': 20.0, 'calcium_mg': 50, 'iron_mg': 1.0,
     'potassium_mg': 250, 'magnesium_mg': 15, 'sodium_mg': 25, 'category': 'vegetable'},
    {'name': 'tomatoes', 'serving_size': 100, 'serving_unit': 'g',
     'calories': 18, 'protein_g': 0.9, 'fat_g': 0.2, 'carbs_g': 3.9, 'fiber_g': 1.2, 'sugar_g': 2.6,
     'vitamin_c_mg': 13.7, 'vitamin_a_mcg': 42, 'potassium_mg': 237, 'calcium_mg': 10,
     'magnesium_mg': 11, 'sodium_mg': 5, 'iron_mg': 0.27, 'category': 'vegetable'},
    {'name': 'mushrooms', 'serving_size': 100, 'serving_unit': 'g',
     'calories': 22, 'protein_g': 3.1, 'fat_g': 0.3, 'carbs_g': 3.3, 'fiber_g': 1.0, 'sugar_g': 2.0,
     'potassium_mg': 318, 'selenium_mcg': 9.3, 'vitamin_d_mcg': 0.2, 'niacin_mg': 3.6,
     'sodium_mg': 5, 'calcium_mg': 3, 'iron_mg': 0.5, 'magnesium_mg': 9, 'zinc_mg': 0.52, 'category': 'vegetable'},
    {'name': 'cucumber', 'serving_size': 100, 'serving_unit': 'g',
     'calories': 15, 'protein_g': 0.7, 'fat_g': 0.1, 'carbs_g': 3.6, 'fiber_g': 0.5, 'sugar_g': 1.7,
     'potassium_mg': 147, 'vitamin_c_mg': 2.8, 'calcium_mg': 16, 'magnesium_mg': 13,
     'sodium_mg': 2, 'iron_mg': 0.28, 'category': 'vegetable'},

    # Fruits
    {'name': 'banana', 'serving_size': 120, 'serving_unit': 'g',
     'calories': 89, 'protein_g': 1.1, 'fat_g': 0.3, 'carbs_g': 22.8, 'fiber_g': 2.6, 'sugar_g': 12.2,
     'potassium_mg': 358, 'vitamin_c_mg': 8.7, 'vitamin_b6_mg': 0.37, 'magnesium_mg': 27,
     'sodium_mg': 1, 'calcium_mg': 5, 'iron_mg': 0.26, 'category': 'fruit'},
    {'name': 'blueberries', 'serving_size': 75, 'serving_unit': 'g',
     'calories': 57, 'protein_g': 0.7, 'fat_g': 0.3, 'carbs_g': 14.5, 'fiber_g': 2.4, 'sugar_g': 10.0,
     'vitamin_c_mg': 9.7, 'vitamin_k_mcg': 19.3, 'potassium_mg': 77, 'magnesium_mg': 6,
     'sodium_mg': 1, 'calcium_mg': 6, 'iron_mg': 0.28, 'category': 'fruit'},
    {'name': 'apple', 'serving_size': 180, 'serving_unit': 'g',
     'calories': 52, 'protein_g': 0.3, 'fat_g': 0.2, 'carbs_g': 13.8, 'fiber_g': 2.4, 'sugar_g': 10.4,
     'vitamin_c_mg': 4.6, 'potassium_mg': 107, 'calcium_mg': 6, 'magnesium_mg': 5,
     'sodium_mg': 1, 'iron_mg': 0.12, 'category': 'fruit'},

    # Nuts & Seeds
    {'name': 'almonds', 'serving_size': 30, 'serving_unit': 'g',
     'calories': 579, 'protein_g': 21.2, 'fat_g': 49.9, 'carbs_g': 21.6, 'fiber_g': 12.5, 'sugar_g': 4.4,
     'magnesium_mg': 270, 'calcium_mg': 269, 'iron_mg': 3.71, 'zinc_mg': 3.12,
     'vitamin_e_mg': 25.6, 'potassium_mg': 733, 'sodium_mg': 1, 'category': 'nuts'},
    {'name': 'hemp seeds', 'serving_size': 20, 'serving_unit': 'g',
     'calories': 553, 'protein_g': 31.6, 'fat_g': 48.8, 'carbs_g': 8.7, 'fiber_g': 4.0, 'sugar_g': 1.5,
     'magnesium_mg': 700, 'iron_mg': 7.95, 'zinc_mg': 9.9, 'omega_3_g': 8.7,
     'potassium_mg': 1200, 'sodium_mg': 5, 'calcium_mg': 70, 'category': 'nuts'},
    {'name': 'peanut butter', 'serving_size': 30, 'serving_unit': 'g',
     'calories': 588, 'protein_g': 25.1, 'fat_g': 50.4, 'carbs_g': 20.0, 'fiber_g': 6.0, 'sugar_g': 9.2,
     'magnesium_mg': 168, 'potassium_mg': 649, 'iron_mg': 1.74, 'zinc_mg': 2.51,
     'niacin_mg': 13.4, 'sodium_mg': 459, 'calcium_mg': 43, 'category': 'nuts'},

    # Fats & Oils
    {'name': 'olive oil', 'serving_size': 15, 'serving_unit': 'ml',
     'calories': 884, 'protein_g': 0, 'fat_g': 100, 'carbs_g': 0, 'fiber_g': 0, 'sugar_g': 0,
     'vitamin_e_mg': 14.4, 'vitamin_k_mcg': 60.2, 'category': 'fat'},

    # Beverages
    {'name': 'espresso coffee', 'serving_size': 30, 'serving_unit': 'ml',
     'calories': 2, 'protein_g': 0.1, 'fat_g': 0, 'carbs_g': 0, 'fiber_g': 0, 'sugar_g': 0,
     'potassium_mg': 115, 'magnesium_mg': 80, 'sodium_mg': 14, 'category': 'beverage'},
    {'name': 'green tea (brewed)', 'serving_size': 250, 'serving_unit': 'ml',
     'calories': 1, 'protein_g': 0.2, 'fat_g': 0, 'carbs_g': 0, 'fiber_g': 0, 'sugar_g': 0,
     'potassium_mg': 8, 'magnesium_mg': 1, 'sodium_mg': 1, 'category': 'beverage'},

    # Extras
    {'name': 'honey', 'serving_size': 15, 'serving_unit': 'g',
     'calories': 304, 'protein_g': 0.3, 'fat_g': 0, 'carbs_g': 82.4, 'fiber_g': 0.2, 'sugar_g': 82.1,
     'potassium_mg': 52, 'calcium_mg': 6, 'iron_mg': 0.42, 'sodium_mg': 4, 'category': 'other'},
    {'name': 'granola', 'serving_size': 40, 'serving_unit': 'g',
     'calories': 471, 'protein_g': 10.0, 'fat_g': 20.0, 'carbs_g': 64.0, 'fiber_g': 7.0, 'sugar_g': 20.0,
     'iron_mg': 3.5, 'magnesium_mg': 100, 'potassium_mg': 300, 'sodium_mg': 200,
     'calcium_mg': 50, 'zinc_mg': 2.0, 'category': 'grain'},
    {'name': 'hummus', 'serving_size': 30, 'serving_unit': 'g',
     'calories': 166, 'protein_g': 7.9, 'fat_g': 9.6, 'carbs_g': 14.3, 'fiber_g': 6.0, 'sugar_g': 0.3,
     'iron_mg': 2.44, 'calcium_mg': 38, 'magnesium_mg': 71, 'potassium_mg': 228,
     'sodium_mg': 379, 'zinc_mg': 1.83, 'category': 'other'},
]

# ─── Demo meals for a week ───

DEMO_MEALS = [
    # Day 1 — Normal day
    {'meal_type': 'breakfast', 'title': 'Oatmeal with Blueberries',
     'hours_ago': 168, 'confidence_pct': 0.9,
     'items': [('oats (rolled)', 50), ('blueberries', 100), ('honey', 10), ('almonds', 15)]},
    {'meal_type': 'lunch', 'title': 'Chicken Salad Bowl',
     'hours_ago': 163, 'confidence_pct': 0.85,
     'items': [('chicken breast', 150), ('mixed salad greens', 80), ('avocado', 50), ('tomatoes', 60), ('olive oil', 10)]},
    {'meal_type': 'snack', 'title': 'Apple + Peanut Butter',
     'hours_ago': 160, 'confidence_pct': 0.95,
     'items': [('apple', 180), ('peanut butter', 20)]},
    {'meal_type': 'dinner', 'title': 'Salmon with Brown Rice & Broccoli',
     'hours_ago': 156, 'confidence_pct': 0.9,
     'items': [('salmon fillet', 180), ('brown rice (cooked)', 200), ('broccoli', 120), ('olive oil', 8)]},

    # Day 2 — High protein
    {'meal_type': 'breakfast', 'title': 'Scrambled Eggs on Toast',
     'hours_ago': 144, 'confidence_pct': 0.95,
     'items': [('egg', 150), ('sourdough bread', 60), ('spinach', 40), ('mushrooms', 50)]},
    {'meal_type': 'lunch', 'title': 'Quinoa Buddha Bowl',
     'hours_ago': 139, 'confidence_pct': 0.8,
     'items': [('quinoa (cooked)', 200), ('tofu (firm)', 120), ('avocado', 60), ('cucumber', 80), ('hemp seeds', 15)]},
    {'meal_type': 'snack', 'title': 'Greek Yogurt + Granola',
     'hours_ago': 136, 'confidence_pct': 0.9,
     'items': [('greek yogurt', 170), ('granola', 30), ('blueberries', 50)]},
    {'meal_type': 'dinner', 'title': 'Chicken Stir-fry',
     'hours_ago': 132, 'confidence_pct': 0.85,
     'items': [('chicken breast', 180), ('broccoli', 100), ('mushrooms', 80), ('brown rice (cooked)', 180), ('olive oil', 10)]},

    # Day 3
    {'meal_type': 'breakfast', 'title': 'Banana Smoothie Bowl',
     'hours_ago': 120, 'confidence_pct': 0.85,
     'items': [('banana', 120), ('greek yogurt', 150), ('hemp seeds', 20), ('granola', 25), ('blueberries', 40)]},
    {'meal_type': 'lunch', 'title': 'Egg & Avocado Toast',
     'hours_ago': 115, 'confidence_pct': 0.9,
     'items': [('egg', 100), ('sourdough bread', 80), ('avocado', 70), ('tomatoes', 50)]},
    {'meal_type': 'dinner', 'title': 'Salmon Poke Bowl',
     'hours_ago': 108, 'confidence_pct': 0.8,
     'items': [('salmon fillet', 150), ('brown rice (cooked)', 180), ('avocado', 50), ('cucumber', 60), ('mixed salad greens', 40)]},

    # Day 4
    {'meal_type': 'breakfast', 'title': 'Overnight Oats',
     'hours_ago': 96, 'confidence_pct': 0.9,
     'items': [('oats (rolled)', 50), ('greek yogurt', 100), ('blueberries', 60), ('honey', 8), ('almonds', 10)]},
    {'meal_type': 'lunch', 'title': 'Grilled Chicken Wrap',
     'hours_ago': 91, 'confidence_pct': 0.75,
     'items': [('chicken breast', 140), ('sourdough bread', 70), ('mixed salad greens', 60), ('hummus', 30), ('tomatoes', 40)]},
    {'meal_type': 'snack', 'title': 'Trail Mix',
     'hours_ago': 88, 'confidence_pct': 0.7,
     'items': [('almonds', 25), ('banana', 80)]},
    {'meal_type': 'dinner', 'title': 'Tofu Stir-fry with Quinoa',
     'hours_ago': 84, 'confidence_pct': 0.85,
     'items': [('tofu (firm)', 150), ('quinoa (cooked)', 180), ('broccoli', 100), ('mushrooms', 60), ('olive oil', 10)]},

    # Day 5
    {'meal_type': 'breakfast', 'title': 'Eggs & Spinach',
     'hours_ago': 72, 'confidence_pct': 0.9,
     'items': [('egg', 100), ('egg whites', 80), ('spinach', 60), ('sourdough bread', 50), ('avocado', 40)]},
    {'meal_type': 'lunch', 'title': 'Sweet Potato & Chicken Bowl',
     'hours_ago': 67, 'confidence_pct': 0.85,
     'items': [('chicken breast', 160), ('sweet potato (baked)', 200), ('broccoli', 80), ('olive oil', 8)]},
    {'meal_type': 'dinner', 'title': 'Salmon with Vegetables',
     'hours_ago': 60, 'confidence_pct': 0.9,
     'items': [('salmon fillet', 170), ('spinach', 80), ('mushrooms', 100), ('tomatoes', 60), ('olive oil', 10)]},

    # Day 6
    {'meal_type': 'breakfast', 'title': 'Granola Bowl',
     'hours_ago': 48, 'confidence_pct': 0.85,
     'items': [('granola', 45), ('greek yogurt', 170), ('banana', 100), ('hemp seeds', 10)]},
    {'meal_type': 'lunch', 'title': 'Quinoa Salad',
     'hours_ago': 43, 'confidence_pct': 0.8,
     'items': [('quinoa (cooked)', 200), ('cucumber', 80), ('tomatoes', 80), ('avocado', 50), ('almonds', 15), ('olive oil', 8)]},
    {'meal_type': 'snack', 'title': 'Espresso + Almonds',
     'hours_ago': 40, 'confidence_pct': 0.95,
     'items': [('espresso coffee', 60), ('almonds', 30)]},
    {'meal_type': 'dinner', 'title': 'Chicken & Brown Rice',
     'hours_ago': 36, 'confidence_pct': 0.9,
     'items': [('chicken breast', 170), ('brown rice (cooked)', 200), ('spinach', 60), ('mushrooms', 70), ('olive oil', 10)]},

    # Day 7 (today-ish)
    {'meal_type': 'breakfast', 'title': 'Avocado Toast with Eggs',
     'hours_ago': 24, 'confidence_pct': 0.95,
     'items': [('sourdough bread', 80), ('avocado', 70), ('egg', 100), ('tomatoes', 40), ('hemp seeds', 10)]},
    {'meal_type': 'snack', 'title': 'Blueberries + Greek Yogurt',
     'hours_ago': 20, 'confidence_pct': 0.9,
     'items': [('greek yogurt', 150), ('blueberries', 80), ('honey', 8)]},
    {'meal_type': 'lunch', 'title': 'Salmon Rice Bowl',
     'hours_ago': 17, 'confidence_pct': 0.85,
     'items': [('salmon fillet', 160), ('brown rice (cooked)', 180), ('avocado', 50), ('mixed salad greens', 60), ('cucumber', 50)]},
    {'meal_type': 'snack', 'title': 'Green Tea + Apple',
     'hours_ago': 14, 'confidence_pct': 0.9,
     'items': [('green tea (brewed)', 250), ('apple', 180)]},
    {'meal_type': 'dinner', 'title': 'Chicken Quinoa Bowl',
     'hours_ago': 8, 'confidence_pct': 0.85,
     'items': [('chicken breast', 160), ('quinoa (cooked)', 180), ('broccoli', 100), ('mushrooms', 60), ('avocado', 40), ('olive oil', 8)]},
]


def seed_demo():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Get all column names from foods table
    cols_info = cur.execute("PRAGMA table_info(foods)").fetchall()
    food_cols = [c[1] for c in cols_info]

    # Insert foods
    food_ids = {}
    for food in DEMO_FOODS:
        name = food['name']
        # Build insert dict with only columns that exist
        insert_data = {}
        for key, val in food.items():
            if key in food_cols:
                insert_data[key] = val

        cols = ', '.join(insert_data.keys())
        placeholders = ', '.join(['?'] * len(insert_data))
        try:
            cur.execute(f"INSERT INTO foods ({cols}) VALUES ({placeholders})", list(insert_data.values()))
            food_ids[name] = cur.lastrowid
            print(f"  + {name}")
        except sqlite3.IntegrityError:
            # Already exists
            food_ids[name] = cur.execute("SELECT id FROM foods WHERE name = ?", (name,)).fetchone()[0]
            print(f"  = {name} (exists)")

    conn.commit()

    # Check if meal_items table exists
    tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    has_meal_items = 'meal_items' in tables

    # Insert meals
    now = datetime.utcnow()
    for meal in DEMO_MEALS:
        meal_time = now - timedelta(hours=meal['hours_ago'])
        meal_time_str = meal_time.strftime('%Y-%m-%d %H:%M:%S')

        cur.execute(
            "INSERT INTO meals (meal_type, meal_time, title, confidence_pct) VALUES (?, ?, ?, ?)",
            (meal['meal_type'], meal_time_str, meal['title'], meal['confidence_pct'])
        )
        meal_id = cur.lastrowid

        if has_meal_items:
            for food_name, grams in meal['items']:
                food_id = food_ids.get(food_name)
                if food_id:
                    amount = grams / 100.0
                    cur.execute(
                        "INSERT INTO meal_items (meal_id, food_id, amount, actual_grams) VALUES (?, ?, ?, ?)",
                        (meal_id, food_id, amount, grams)
                    )

        print(f"  🍽  {meal['title']} ({meal['meal_type']}, {meal_time.strftime('%m/%d %H:%M')})")

    conn.commit()
    conn.close()

    print(f"\n✅ Seeded {len(DEMO_FOODS)} foods and {len(DEMO_MEALS)} meals")


if __name__ == '__main__':
    seed_demo()
