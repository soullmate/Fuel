#!/usr/bin/env python3
"""
Smart Weekly Grocery List Generator
Analyzes eating patterns and generates a prioritized shopping list.
"""
import sqlite3
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path

DB_PATH = str(Path(__file__).parent / 'food_tracker.db')

# Food categories for organization
CATEGORIES = {
    'produce': ['spinach', 'avocado', 'apple', 'banana', 'lemon', 'tomato', 'cherry tomato',
                'cauliflower', 'mushroom', 'cucumber', 'kale', 'lettuce', 'broccoli', 'zucchini',
                'pepper', 'onion', 'garlic', 'ginger', 'celery', 'carrot', 'sweet potato',
                'potato', 'asparagus', 'green bean', 'orange', 'blueberries'],
    'protein': ['egg', 'tuna', 'salmon', 'chicken', 'beef', 'lamb', 'pork', 'tofu', 'tempeh',
                'shrimp', 'fish', 'turkey', 'ground beef'],
    'dairy': ['milk', 'yogurt', 'greek yogurt', 'cheese', 'butter', 'cream',
              'almond milk', 'oat milk'],
    'pantry': ['olive oil', 'rice', 'pasta', 'oatmeal', 'bread', 'flour',
               'peanut butter', 'honey', 'nuts', 'almonds', 'granola'],
    'supplements': ['protein powder'],
    'beverages': ['tea', 'coffee', 'juice']
}

def categorize_food(food_name):
    """Categorize a food item."""
    food_lower = food_name.lower()
    for category, keywords in CATEGORIES.items():
        for keyword in keywords:
            if keyword in food_lower:
                return category
    return 'other'

def get_consumption_data(days=14):
    """Get food consumption data for the past N days."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    cur.execute('''
        SELECT f.name, 
               COUNT(*) as frequency,
               COALESCE(SUM(mi.quantity), COUNT(*)) as total_servings,
               f.serving_size,
               f.serving_unit,
               MAX(m.meal_time) as last_eaten
        FROM meal_items mi
        JOIN foods f ON mi.food_id = f.id
        JOIN meals m ON mi.meal_id = m.id
        WHERE m.meal_time > datetime("now", ?)
        GROUP BY f.id
        ORDER BY frequency DESC
    ''', (f'-{days} days',))
    
    results = cur.fetchall()
    conn.close()
    return results

def estimate_weekly_need(frequency, total_servings, days_analyzed=14):
    """Estimate weekly need based on consumption patterns."""
    # Calculate daily rate, then project to 7 days with 20% buffer
    daily_rate = total_servings / days_analyzed
    weekly_need = daily_rate * 7 * 1.2  # 20% buffer
    return round(weekly_need, 1)

def generate_grocery_list():
    """Generate a smart grocery list."""
    consumption = get_consumption_data(days=14)
    
    # Organize by category
    categorized = defaultdict(list)
    
    for food_name, freq, total_servings, serving_size, serving_unit, last_eaten in consumption:
        category = categorize_food(food_name)
        weekly_need = estimate_weekly_need(freq, total_servings)
        
        # Calculate approximate quantity to buy
        if serving_size and serving_size > 0:
            qty_to_buy = weekly_need * serving_size
            unit = serving_unit or 'g'
        else:
            qty_to_buy = weekly_need
            unit = 'servings'
        
        # Round to sensible quantities
        if unit == 'g' and qty_to_buy > 100:
            qty_to_buy = round(qty_to_buy / 100) * 100
        elif unit == 'ml' and qty_to_buy > 100:
            qty_to_buy = round(qty_to_buy / 100) * 100
        
        categorized[category].append({
            'name': food_name,
            'frequency': freq,
            'weekly_need': weekly_need,
            'qty': qty_to_buy,
            'unit': unit,
            'priority': 'HIGH' if freq >= 3 else 'MEDIUM' if freq >= 2 else 'LOW'
        })
    
    return categorized

def format_output(categorized):
    """Format the grocery list for output."""
    output = []
    output.append("🛒 **SMART WEEKLY GROCERY LIST**")
    output.append(f"📅 Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    output.append(f"📊 Based on: Last 14 days of eating patterns\n")
    
    # Priority items first
    high_priority = []
    for category, items in categorized.items():
        for item in items:
            if item['priority'] == 'HIGH':
                high_priority.append(item)
    
    if high_priority:
        output.append("🔴 **HIGH PRIORITY** (eaten 3+ times/2 weeks)")
        for item in sorted(high_priority, key=lambda x: x['frequency'], reverse=True):
            output.append(f"  • {item['name']}: ~{item['qty']:.0f}{item['unit']}")
        output.append("")
    
    # By category
    category_order = ['produce', 'protein', 'dairy', 'pantry', 'supplements', 'beverages', 'other']
    category_emoji = {
        'produce': '🥬', 'protein': '🥩', 'dairy': '🥛',
        'pantry': '🫙', 'supplements': '💊', 'beverages': '☕', 'other': '📦'
    }
    category_names = {
        'produce': 'Fresh Produce', 'protein': 'Protein', 'dairy': 'Dairy',
        'pantry': 'Pantry Staples', 'supplements': 'Supplements', 'beverages': 'Beverages', 'other': 'Other'
    }
    
    for cat in category_order:
        if cat in categorized and categorized[cat]:
            items = categorized[cat]
            emoji = category_emoji.get(cat, '📦')
            name = category_names.get(cat, cat.title())
            output.append(f"{emoji} **{name}**")
            for item in sorted(items, key=lambda x: x['frequency'], reverse=True):
                marker = "🔴" if item['priority'] == 'HIGH' else "🟡" if item['priority'] == 'MEDIUM' else "⚪"
                output.append(f"  {marker} {item['name']}: ~{item['qty']:.0f}{item['unit']}")
            output.append("")
    
    # Summary stats
    total_items = sum(len(items) for items in categorized.values())
    high_count = len(high_priority)
    output.append(f"📈 **Summary:** {total_items} items total, {high_count} high priority")
    
    return "\n".join(output)

def main():
    categorized = generate_grocery_list()
    print(format_output(categorized))

if __name__ == '__main__':
    main()
