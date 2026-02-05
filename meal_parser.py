#!/usr/bin/env python3
"""
Natural language meal parser for food tracking.
Parses messages like "2 eggs, 1 cup oatmeal, black coffee" into structured meal data.
"""

import re
import json
import sys
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from tracker import FoodTracker

# Patterns for parsing quantities
QUANTITY_PATTERNS = [
    r'(\d+\.?\d*)\s*(g|gram|grams|oz|ounce|ounces|cup|cups|tbsp|tablespoon|tsp|teaspoon|serving|servings|piece|pieces|slice|slices|ml|l|liter|lb|pound)?\s+(?:of\s+)?(.+)',
    r'(\d+\.?\d*)\s*(.+)',  # Just number + food
    r'(a|an|one|two|three|four|five|six)\s+(.+)',  # Word numbers
]

WORD_TO_NUM = {
    'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3,
    'four': 4, 'five': 5, 'six': 6, 'half': 0.5
}

# Common meal type keywords
MEAL_TYPES = {
    'breakfast': ['breakfast', 'morning', 'bfast'],
    'lunch': ['lunch', 'midday'],
    'dinner': ['dinner', 'supper', 'evening meal'],
    'snack': ['snack', 'snacking'],
}


def parse_quantity(text: str) -> Tuple[float, str, str]:
    """
    Parse a food item string into (quantity, unit, food_name).
    """
    text = text.strip().lower()
    
    # Try each pattern
    for pattern in QUANTITY_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            groups = match.groups()
            
            if len(groups) == 3:
                qty, unit, food = groups
                qty = float(qty) if qty else 1
                unit = unit or 'serving'
                return (qty, unit, food.strip())
            
            elif len(groups) == 2:
                qty, food = groups
                # Check if qty is a word
                if qty in WORD_TO_NUM:
                    qty = WORD_TO_NUM[qty]
                else:
                    try:
                        qty = float(qty)
                    except ValueError:
                        qty = 1
                        food = text
                return (qty, 'serving', food.strip())
    
    # No quantity found, assume 1 serving
    return (1, 'serving', text)


def parse_meal_message(message: str) -> Dict:
    """
    Parse a meal log message into structured data.
    
    Example inputs:
    - "breakfast: 2 eggs, 1 cup oatmeal with honey, black coffee"
    - "had a chicken salad for lunch"
    - "2 slices pizza, coke"
    """
    message = message.strip()
    
    # Detect meal type
    meal_type = None
    for mtype, keywords in MEAL_TYPES.items():
        for kw in keywords:
            if kw in message.lower():
                meal_type = mtype
                # Remove the meal type keyword from message
                message = re.sub(rf'\b{kw}\b[:\s]*', '', message, flags=re.IGNORECASE)
                break
        if meal_type:
            break
    
    # Remove common prefixes
    message = re.sub(r'^(had|ate|eating|i ate|i had|just had|for \w+:?\s*)', '', message, flags=re.IGNORECASE)
    
    # Split on common delimiters
    items_raw = re.split(r'[,;]|\band\b|\+', message)
    items_raw = [i.strip() for i in items_raw if i.strip()]
    
    # Parse each item
    items = []
    for raw in items_raw:
        qty, unit, food_name = parse_quantity(raw)
        items.append({
            'food_name': food_name,
            'quantity': qty,
            'unit': unit
        })
    
    return {
        'meal_type': meal_type,
        'items': items,
        'raw_message': message
    }


def log_meal_from_message(message: str, meal_time: datetime = None) -> Dict:
    """
    Parse message and log meal to database.
    Returns summary of what was logged.
    """
    tracker = FoodTracker()
    parsed = parse_meal_message(message)
    
    if not parsed['items']:
        return {'success': False, 'error': 'No food items detected in message'}
    
    meal_id = tracker.log_meal(
        items=parsed['items'],
        meal_type=parsed['meal_type'],
        meal_time=meal_time
    )
    
    meal = tracker.get_meal(meal_id)
    
    return {
        'success': True,
        'meal_id': meal_id,
        'meal_type': parsed['meal_type'],
        'items_logged': len(parsed['items']),
        'items': parsed['items'],
        'totals': meal['totals'] if meal else None
    }


def format_log_confirmation(result: Dict) -> str:
    """Format meal logging result for Telegram reply."""
    if not result['success']:
        return f"❌ Couldn't log meal: {result.get('error', 'Unknown error')}"
    
    lines = [
        f"✅ **Meal logged** ({result['meal_type'] or 'meal'})",
        ""
    ]
    
    for item in result['items']:
        lines.append(f"  • {item['quantity']} {item['unit']} {item['food_name']}")
    
    if result.get('totals'):
        t = result['totals']
        lines.extend([
            "",
            f"📊 {t['calories']:.0f} kcal | P: {t['protein_g']:.0f}g | C: {t['total_carbs_g']:.0f}g | F: {t['total_fat_g']:.0f}g"
        ])
    
    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: meal_parser.py '<meal description>'")
        print("Example: meal_parser.py '2 eggs, toast with butter, coffee'")
        return
    
    message = ' '.join(sys.argv[1:])
    result = log_meal_from_message(message)
    print(format_log_confirmation(result))


if __name__ == '__main__':
    main()
