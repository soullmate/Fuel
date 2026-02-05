#!/usr/bin/env python3
"""
Seed database with common foods and their nutritional data.
Data sourced from USDA FoodData Central.
"""

from tracker import FoodTracker

# Common foods with comprehensive nutritional data
# All values per 100g unless otherwise noted
COMMON_FOODS = [
    # EGGS & DAIRY
    {
        'name': 'egg',
        'serving_size': 50,  # 1 large egg
        'serving_unit': 'g',
        'nutrition': {
            'calories': 143,
            'protein_g': 12.6,
            'fat_g': 9.5,
            'saturated_fat_g': 3.1,
            'cholesterol_mg': 372,
            'carbs_g': 0.7,
            'fiber_g': 0,
            'sugar_g': 0.4,
            'sodium_mg': 142,
            'potassium_mg': 138,
            'calcium_mg': 56,
            'iron_mg': 1.75,
            'vitamin_a_mcg': 160,
            'vitamin_d_mcg': 2.0,
            'vitamin_b12_mcg': 0.89,
            'choline_mg': 294,
        }
    },
    {
        'name': 'milk whole',
        'serving_size': 244,  # 1 cup
        'serving_unit': 'ml',
        'nutrition': {
            'calories': 61,
            'protein_g': 3.2,
            'fat_g': 3.3,
            'saturated_fat_g': 1.9,
            'carbs_g': 4.8,
            'sugar_g': 5.0,
            'fiber_g': 0,
            'calcium_mg': 113,
            'vitamin_d_mcg': 1.3,
            'vitamin_b12_mcg': 0.45,
            'potassium_mg': 132,
            'sodium_mg': 43,
        }
    },
    {
        'name': 'greek yogurt',
        'serving_size': 170,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 97,
            'protein_g': 17.3,
            'fat_g': 0.7,
            'carbs_g': 5.7,
            'sugar_g': 4.0,
            'fiber_g': 0,
            'calcium_mg': 187,
            'potassium_mg': 220,
            'sodium_mg': 56,
        }
    },
    {
        'name': 'cheese cheddar',
        'serving_size': 28,  # 1 oz
        'serving_unit': 'g',
        'nutrition': {
            'calories': 403,
            'protein_g': 25.0,
            'fat_g': 33.0,
            'saturated_fat_g': 19.0,
            'carbs_g': 1.3,
            'sugar_g': 0.5,
            'fiber_g': 0,
            'calcium_mg': 721,
            'sodium_mg': 621,
            'vitamin_a_mcg': 265,
        }
    },
    
    # PROTEINS
    {
        'name': 'chicken breast',
        'serving_size': 100,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 165,
            'protein_g': 31.0,
            'fat_g': 3.6,
            'saturated_fat_g': 1.0,
            'carbs_g': 0,
            'fiber_g': 0,
            'sugar_g': 0,
            'sodium_mg': 74,
            'potassium_mg': 256,
            'iron_mg': 1.0,
            'vitamin_b6_mg': 0.6,
            'vitamin_b12_mcg': 0.3,
        }
    },
    {
        'name': 'salmon',
        'serving_size': 100,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 208,
            'protein_g': 20.0,
            'fat_g': 13.0,
            'saturated_fat_g': 3.1,
            'omega_3_g': 2.3,
            'carbs_g': 0,
            'fiber_g': 0,
            'sugar_g': 0,
            'sodium_mg': 59,
            'potassium_mg': 363,
            'vitamin_d_mcg': 11.0,
            'vitamin_b12_mcg': 2.8,
        }
    },
    {
        'name': 'ground beef 80/20',
        'serving_size': 100,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 254,
            'protein_g': 17.0,
            'fat_g': 20.0,
            'saturated_fat_g': 7.7,
            'carbs_g': 0,
            'fiber_g': 0,
            'sugar_g': 0,
            'iron_mg': 2.6,
            'zinc_mg': 5.4,
            'vitamin_b12_mcg': 2.2,
            'sodium_mg': 66,
            'potassium_mg': 270,
        }
    },
    {
        'name': 'bacon',
        'serving_size': 30,  # ~3 slices
        'serving_unit': 'g',
        'nutrition': {
            'calories': 541,
            'protein_g': 37.0,
            'fat_g': 42.0,
            'saturated_fat_g': 14.0,
            'carbs_g': 1.4,
            'sugar_g': 0,
            'fiber_g': 0,
            'sodium_mg': 1717,
            'potassium_mg': 565,
        }
    },
    {
        'name': 'tofu',
        'serving_size': 100,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 76,
            'protein_g': 8.0,
            'fat_g': 4.8,
            'saturated_fat_g': 0.7,
            'carbs_g': 1.9,
            'fiber_g': 0.3,
            'sugar_g': 0.6,
            'calcium_mg': 350,
            'iron_mg': 5.4,
            'magnesium_mg': 30,
            'sodium_mg': 7,
        }
    },
    
    # GRAINS & CARBS
    {
        'name': 'rice white cooked',
        'serving_size': 158,  # 1 cup
        'serving_unit': 'g',
        'nutrition': {
            'calories': 130,
            'protein_g': 2.7,
            'fat_g': 0.3,
            'carbs_g': 28.0,
            'fiber_g': 0.4,
            'sugar_g': 0,
            'iron_mg': 0.2,
            'magnesium_mg': 12,
            'sodium_mg': 1,
        }
    },
    {
        'name': 'rice brown cooked',
        'serving_size': 195,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 112,
            'protein_g': 2.6,
            'fat_g': 0.9,
            'carbs_g': 23.5,
            'fiber_g': 1.8,
            'sugar_g': 0.4,
            'magnesium_mg': 43,
            'iron_mg': 0.5,
            'sodium_mg': 5,
        }
    },
    {
        'name': 'oatmeal',
        'serving_size': 234,  # 1 cup cooked
        'serving_unit': 'g',
        'nutrition': {
            'calories': 68,
            'protein_g': 2.4,
            'fat_g': 1.4,
            'carbs_g': 12.0,
            'fiber_g': 1.7,
            'sugar_g': 0.3,
            'iron_mg': 1.4,
            'magnesium_mg': 27,
            'potassium_mg': 61,
            'sodium_mg': 49,
        }
    },
    {
        'name': 'bread whole wheat',
        'serving_size': 28,  # 1 slice
        'serving_unit': 'g',
        'nutrition': {
            'calories': 247,
            'protein_g': 13.0,
            'fat_g': 3.4,
            'carbs_g': 41.0,
            'fiber_g': 7.0,
            'sugar_g': 5.6,
            'sodium_mg': 472,
            'potassium_mg': 254,
            'iron_mg': 2.5,
        }
    },
    {
        'name': 'bread white',
        'serving_size': 25,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 265,
            'protein_g': 9.0,
            'fat_g': 3.2,
            'carbs_g': 49.0,
            'fiber_g': 2.7,
            'sugar_g': 5.0,
            'sodium_mg': 491,
            'calcium_mg': 260,
        }
    },
    {
        'name': 'pasta cooked',
        'serving_size': 140,  # 1 cup
        'serving_unit': 'g',
        'nutrition': {
            'calories': 131,
            'protein_g': 5.0,
            'fat_g': 1.1,
            'carbs_g': 25.0,
            'fiber_g': 1.8,
            'sugar_g': 0.6,
            'iron_mg': 1.0,
            'sodium_mg': 1,
        }
    },
    
    # VEGETABLES
    {
        'name': 'broccoli',
        'serving_size': 91,  # 1 cup chopped
        'serving_unit': 'g',
        'nutrition': {
            'calories': 34,
            'protein_g': 2.8,
            'fat_g': 0.4,
            'carbs_g': 6.6,
            'fiber_g': 2.6,
            'sugar_g': 1.7,
            'vitamin_c_mg': 89.2,
            'vitamin_k_mcg': 102,
            'folate_mcg': 63,
            'potassium_mg': 316,
            'calcium_mg': 47,
        }
    },
    {
        'name': 'spinach',
        'serving_size': 30,  # 1 cup raw
        'serving_unit': 'g',
        'nutrition': {
            'calories': 23,
            'protein_g': 2.9,
            'fat_g': 0.4,
            'carbs_g': 3.6,
            'fiber_g': 2.2,
            'sugar_g': 0.4,
            'vitamin_a_mcg': 469,
            'vitamin_k_mcg': 483,
            'vitamin_c_mg': 28,
            'iron_mg': 2.7,
            'calcium_mg': 99,
            'magnesium_mg': 79,
        }
    },
    {
        'name': 'sweet potato',
        'serving_size': 130,  # 1 medium
        'serving_unit': 'g',
        'nutrition': {
            'calories': 86,
            'protein_g': 1.6,
            'fat_g': 0.1,
            'carbs_g': 20.0,
            'fiber_g': 3.0,
            'sugar_g': 4.2,
            'vitamin_a_mcg': 709,
            'vitamin_c_mg': 2.4,
            'potassium_mg': 337,
            'manganese_mg': 0.3,
        }
    },
    {
        'name': 'avocado',
        'serving_size': 150,  # 1 whole
        'serving_unit': 'g',
        'nutrition': {
            'calories': 160,
            'protein_g': 2.0,
            'fat_g': 15.0,
            'saturated_fat_g': 2.1,
            'monounsaturated_fat_g': 10.0,
            'carbs_g': 8.5,
            'fiber_g': 6.7,
            'sugar_g': 0.7,
            'potassium_mg': 485,
            'vitamin_k_mcg': 21,
            'vitamin_c_mg': 10,
            'folate_mcg': 81,
        }
    },
    {
        'name': 'tomato',
        'serving_size': 123,  # 1 medium
        'serving_unit': 'g',
        'nutrition': {
            'calories': 18,
            'protein_g': 0.9,
            'fat_g': 0.2,
            'carbs_g': 3.9,
            'fiber_g': 1.2,
            'sugar_g': 2.6,
            'vitamin_c_mg': 14,
            'vitamin_a_mcg': 42,
            'potassium_mg': 237,
            'vitamin_k_mcg': 7.9,
        }
    },
    
    # FRUITS
    {
        'name': 'banana',
        'serving_size': 118,  # 1 medium
        'serving_unit': 'g',
        'nutrition': {
            'calories': 89,
            'protein_g': 1.1,
            'fat_g': 0.3,
            'carbs_g': 23.0,
            'fiber_g': 2.6,
            'sugar_g': 12.0,
            'potassium_mg': 358,
            'vitamin_b6_mg': 0.4,
            'vitamin_c_mg': 8.7,
            'magnesium_mg': 27,
        }
    },
    {
        'name': 'apple',
        'serving_size': 182,  # 1 medium
        'serving_unit': 'g',
        'nutrition': {
            'calories': 52,
            'protein_g': 0.3,
            'fat_g': 0.2,
            'carbs_g': 14.0,
            'fiber_g': 2.4,
            'sugar_g': 10.0,
            'vitamin_c_mg': 4.6,
            'potassium_mg': 107,
        }
    },
    {
        'name': 'blueberries',
        'serving_size': 148,  # 1 cup
        'serving_unit': 'g',
        'nutrition': {
            'calories': 57,
            'protein_g': 0.7,
            'fat_g': 0.3,
            'carbs_g': 14.5,
            'fiber_g': 2.4,
            'sugar_g': 10.0,
            'vitamin_c_mg': 9.7,
            'vitamin_k_mcg': 19.3,
            'manganese_mg': 0.3,
        }
    },
    {
        'name': 'orange',
        'serving_size': 131,  # 1 medium
        'serving_unit': 'g',
        'nutrition': {
            'calories': 47,
            'protein_g': 0.9,
            'fat_g': 0.1,
            'carbs_g': 12.0,
            'fiber_g': 2.4,
            'sugar_g': 9.4,
            'vitamin_c_mg': 53.0,
            'folate_mcg': 30,
            'potassium_mg': 181,
        }
    },
    
    # NUTS & SEEDS
    {
        'name': 'almonds',
        'serving_size': 28,  # 1 oz
        'serving_unit': 'g',
        'nutrition': {
            'calories': 579,
            'protein_g': 21.0,
            'fat_g': 50.0,
            'saturated_fat_g': 3.8,
            'monounsaturated_fat_g': 31.6,
            'carbs_g': 22.0,
            'fiber_g': 12.5,
            'sugar_g': 4.4,
            'vitamin_e_mg': 25.6,
            'magnesium_mg': 270,
            'calcium_mg': 269,
        }
    },
    {
        'name': 'peanut butter',
        'serving_size': 32,  # 2 tbsp
        'serving_unit': 'g',
        'nutrition': {
            'calories': 588,
            'protein_g': 25.0,
            'fat_g': 50.0,
            'saturated_fat_g': 10.0,
            'carbs_g': 20.0,
            'fiber_g': 6.0,
            'sugar_g': 9.0,
            'sodium_mg': 426,
            'potassium_mg': 649,
            'magnesium_mg': 168,
        }
    },
    
    # BEVERAGES
    {
        'name': 'coffee black',
        'serving_size': 240,  # 1 cup
        'serving_unit': 'ml',
        'nutrition': {
            'calories': 2,
            'protein_g': 0.3,
            'fat_g': 0,
            'carbs_g': 0,
            'fiber_g': 0,
            'sugar_g': 0,
            'caffeine_mg': 95,
            'potassium_mg': 116,
        }
    },
    {
        'name': 'orange juice',
        'serving_size': 240,
        'serving_unit': 'ml',
        'nutrition': {
            'calories': 45,
            'protein_g': 0.7,
            'fat_g': 0.2,
            'carbs_g': 10.4,
            'fiber_g': 0.2,
            'sugar_g': 8.4,
            'vitamin_c_mg': 50,
            'potassium_mg': 200,
            'folate_mcg': 30,
        }
    },
    
    # COMMON MEALS/FAST FOOD
    {
        'name': 'pizza cheese slice',
        'serving_size': 107,  # 1 slice
        'serving_unit': 'g',
        'nutrition': {
            'calories': 285,
            'protein_g': 12.0,
            'fat_g': 10.0,
            'saturated_fat_g': 4.8,
            'carbs_g': 36.0,
            'fiber_g': 2.5,
            'sugar_g': 4.0,
            'sodium_mg': 640,
            'calcium_mg': 201,
        }
    },
    {
        'name': 'hamburger',
        'serving_size': 110,
        'serving_unit': 'g',
        'nutrition': {
            'calories': 254,
            'protein_g': 13.0,
            'fat_g': 10.0,
            'saturated_fat_g': 3.8,
            'carbs_g': 27.0,
            'fiber_g': 1.0,
            'sugar_g': 5.0,
            'sodium_mg': 396,
            'iron_mg': 2.4,
        }
    },
    
    # CONDIMENTS & EXTRAS
    {
        'name': 'olive oil',
        'serving_size': 14,  # 1 tbsp
        'serving_unit': 'ml',
        'nutrition': {
            'calories': 884,
            'protein_g': 0,
            'fat_g': 100.0,
            'saturated_fat_g': 14.0,
            'monounsaturated_fat_g': 73.0,
            'polyunsaturated_fat_g': 11.0,
            'carbs_g': 0,
            'fiber_g': 0,
            'sugar_g': 0,
            'vitamin_e_mg': 14.4,
            'vitamin_k_mcg': 60.2,
        }
    },
    {
        'name': 'butter',
        'serving_size': 14,  # 1 tbsp
        'serving_unit': 'g',
        'nutrition': {
            'calories': 717,
            'protein_g': 0.9,
            'fat_g': 81.0,
            'saturated_fat_g': 51.0,
            'cholesterol_mg': 215,
            'carbs_g': 0.1,
            'fiber_g': 0,
            'sugar_g': 0.1,
            'vitamin_a_mcg': 684,
            'sodium_mg': 11,
        }
    },
    {
        'name': 'honey',
        'serving_size': 21,  # 1 tbsp
        'serving_unit': 'g',
        'nutrition': {
            'calories': 304,
            'protein_g': 0.3,
            'fat_g': 0,
            'carbs_g': 82.0,
            'fiber_g': 0.2,
            'sugar_g': 82.0,
            'sodium_mg': 4,
            'potassium_mg': 52,
        }
    },
]


def seed_database():
    """Add all common foods to the database."""
    tracker = FoodTracker()
    added = 0
    skipped = 0
    
    for food in COMMON_FOODS:
        # Check if food already exists
        existing = tracker.find_food(food['name'], limit=1)
        if existing and existing[0]['name'].lower() == food['name'].lower():
            skipped += 1
            continue
        
        tracker.add_food(
            name=food['name'],
            nutrition=food['nutrition'],
            serving_size=food['serving_size'],
            serving_unit=food['serving_unit'],
            data_source='seed_data_usda'
        )
        added += 1
        print(f"Added: {food['name']}")
    
    print(f"\nDone! Added {added} foods, skipped {skipped} (already exist)")


if __name__ == '__main__':
    seed_database()
