#!/usr/bin/env python3
"""
Food Tracker - Core Module
Handles all database operations for meal logging and nutrition tracking.
"""

import sqlite3
import json
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple
import re

DB_PATH = Path(__file__).parent / "food_tracker.db"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"

# Unit conversion to grams
UNIT_TO_GRAMS = {
    'g': 1,
    'gram': 1,
    'grams': 1,
    'kg': 1000,
    'oz': 28.35,
    'ounce': 28.35,
    'ounces': 28.35,
    'lb': 453.6,
    'pound': 453.6,
    'pounds': 453.6,
    'cup': 240,  # approximate, varies by food
    'cups': 240,
    'tbsp': 15,
    'tablespoon': 15,
    'tablespoons': 15,
    'tsp': 5,
    'teaspoon': 5,
    'teaspoons': 5,
    'ml': 1,  # approximate for water-based
    'l': 1000,
    'liter': 1000,
    'litre': 1000,
    'serving': None,  # use food's serving size
    'servings': None,
    'piece': None,
    'pieces': None,
    'slice': None,
    'slices': None,
}


class FoodTracker:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()
    
    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def _init_db(self):
        """Initialize database with schema if needed."""
        if not self.db_path.exists() or self.db_path.stat().st_size == 0:
            with self._get_conn() as conn:
                with open(SCHEMA_PATH) as f:
                    conn.executescript(f.read())
                conn.commit()
    
    # =====================
    # FOOD MANAGEMENT
    # =====================
    
    def add_food(self, name: str, nutrition: Dict[str, Any], 
                 serving_size: float = 100, serving_unit: str = 'g',
                 brand: str = None, data_source: str = 'manual') -> int:
        """Add a new food to the database."""
        # Build column list from nutrition dict
        columns = ['name', 'serving_size', 'serving_unit', 'brand', 'data_source']
        values = [name, serving_size, serving_unit, brand, data_source]
        
        for key, val in nutrition.items():
            if val is not None:
                columns.append(key)
                values.append(val)
        
        placeholders = ', '.join(['?' for _ in values])
        col_str = ', '.join(columns)
        
        with self._get_conn() as conn:
            cursor = conn.execute(
                f"INSERT INTO foods ({col_str}) VALUES ({placeholders})",
                values
            )
            conn.commit()
            return cursor.lastrowid
    
    def find_food(self, query: str, limit: int = 10) -> List[Dict]:
        """Search for foods by name."""
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT id, name, brand, serving_size, serving_unit, 
                          calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g
                   FROM foods 
                   WHERE name LIKE ? 
                   ORDER BY name 
                   LIMIT ?""",
                (f'%{query}%', limit)
            ).fetchall()
            return [dict(row) for row in rows]
    
    def get_food(self, food_id: int) -> Optional[Dict]:
        """Get full food details by ID."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM foods WHERE id = ?", (food_id,)
            ).fetchone()
            return dict(row) if row else None
    
    def update_food(self, food_id: int, updates: Dict[str, Any]) -> bool:
        """Update food nutritional data."""
        if not updates:
            return False
        
        set_clause = ', '.join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [food_id]
        
        with self._get_conn() as conn:
            conn.execute(
                f"UPDATE foods SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                values
            )
            conn.commit()
            return True
    
    # =====================
    # MEAL LOGGING
    # =====================
    
    def log_meal(self, items: List[Dict], meal_type: str = None, 
                 meal_time: datetime = None, notes: str = None, title: str = None) -> int:
        """
        Log a meal with multiple items.
        
        items: List of dicts with keys:
            - food_id or food_name (required)
            - quantity (default 1)
            - unit (default 'serving')
        title: Short descriptive name for the meal (e.g., "Protein oat porridge")
        """
        meal_time = meal_time or datetime.now()
        
        with self._get_conn() as conn:
            # Create meal record
            cursor = conn.execute(
                "INSERT INTO meals (meal_type, meal_time, notes, title) VALUES (?, ?, ?, ?)",
                (meal_type, meal_time.isoformat(), notes, title)
            )
            meal_id = cursor.lastrowid
            
            # Add each item
            for item in items:
                food_id = item.get('food_id')
                
                # Look up food by name if no ID provided
                if not food_id and item.get('food_name'):
                    foods = self.find_food(item['food_name'], limit=1)
                    if foods:
                        food_id = foods[0]['id']
                    else:
                        # Auto-create placeholder food
                        food_id = self.add_food(
                            item['food_name'],
                            nutrition={},
                            data_source='auto_created'
                        )
                
                if not food_id:
                    continue
                
                quantity = item.get('quantity', 1)
                unit = item.get('unit', 'serving')
                
                # Calculate actual grams
                food = self.get_food(food_id)
                actual_grams = self._convert_to_grams(quantity, unit, food)
                
                conn.execute(
                    """INSERT INTO meal_items 
                       (meal_id, food_id, quantity, unit, actual_grams, notes)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (meal_id, food_id, quantity, unit, actual_grams, item.get('notes'))
                )
            
            conn.commit()
            return meal_id
    
    def _convert_to_grams(self, quantity: float, unit: str, food: Dict) -> float:
        """Convert a quantity+unit to grams."""
        unit_lower = unit.lower().strip()
        
        if unit_lower in ('serving', 'servings', 'piece', 'pieces', 'slice', 'slices'):
            # Use the food's serving size
            return quantity * food.get('serving_size', 100)
        
        conversion = UNIT_TO_GRAMS.get(unit_lower)
        if conversion:
            return quantity * conversion
        
        # Default: assume grams
        return quantity * 100
    
    def get_meal(self, meal_id: int) -> Optional[Dict]:
        """Get meal with all items and nutrition totals."""
        with self._get_conn() as conn:
            meal = conn.execute(
                "SELECT * FROM meals WHERE id = ?", (meal_id,)
            ).fetchone()
            
            if not meal:
                return None
            
            items = conn.execute(
                """SELECT mi.*, f.name as food_name, f.serving_size,
                          f.calories, f.protein_g, f.carbs_g, f.fat_g,
                          f.fiber_g, f.sugar_g
                   FROM meal_items mi
                   JOIN foods f ON mi.food_id = f.id
                   WHERE mi.meal_id = ?""",
                (meal_id,)
            ).fetchall()
            
            result = dict(meal)
            result['items'] = []
            result['totals'] = {
                'calories': 0, 'protein_g': 0, 'carbs_g': 0,
                'fat_g': 0, 'fiber_g': 0, 'sugar_g': 0
            }
            
            for item in items:
                item_dict = dict(item)
                ratio = (item['actual_grams'] or 0) / (item['serving_size'] or 100)
                
                # Calculate nutrition for this item
                for key in result['totals'].keys():
                    val = (item[key] or 0) * ratio
                    item_dict[f'actual_{key}'] = round(val, 2)
                    result['totals'][key] += val
                
                result['items'].append(item_dict)
            
            # Round totals
            for key in result['totals']:
                result['totals'][key] = round(result['totals'][key], 1)
            
            return result
    
    def get_meals_for_date(self, target_date: date = None) -> List[Dict]:
        """Get all meals for a specific date."""
        target_date = target_date or date.today()
        start = datetime.combine(target_date, datetime.min.time())
        end = datetime.combine(target_date, datetime.max.time())
        
        with self._get_conn() as conn:
            meals = conn.execute(
                """SELECT id FROM meals 
                   WHERE meal_time BETWEEN ? AND ?
                   ORDER BY meal_time""",
                (start.isoformat(), end.isoformat())
            ).fetchall()
            
            return [self.get_meal(m['id']) for m in meals]
    
    # =====================
    # DAILY SUMMARY
    # =====================
    
    def get_daily_summary(self, target_date: date = None) -> Dict:
        """Get comprehensive daily nutrition summary."""
        target_date = target_date or date.today()
        # Use strftime to get space-separated format (SQLite compatible)
        start = f"{target_date} 00:00:00"
        end = f"{target_date} 23:59:59"
        
        with self._get_conn() as conn:
            # Get all nutrition columns
            result = conn.execute(
                """SELECT 
                    COUNT(DISTINCT m.id) as meal_count,
                    COUNT(mi.id) as item_count,
                    
                    -- Macros (using mi.amount which is the multiplier, e.g. 0.15 = 15g when per 100g)
                    COALESCE(SUM(f.calories * mi.amount), 0) as calories,
                    COALESCE(SUM(f.protein_g * mi.amount), 0) as protein_g,
                    COALESCE(SUM(f.fat_g * mi.amount), 0) as fat_g,
                    COALESCE(SUM(f.saturated_fat_g * mi.amount), 0) as saturated_fat_g,
                    COALESCE(SUM(f.carbs_g * mi.amount), 0) as carbs_g,
                    COALESCE(SUM(f.fiber_g * mi.amount), 0) as fiber_g,
                    COALESCE(SUM(f.sugar_g * mi.amount), 0) as sugar_g,
                    COALESCE(SUM(f.added_sugar_g * mi.amount), 0) as added_sugar_g,
                    
                    -- Minerals
                    COALESCE(SUM(f.sodium_mg * mi.amount), 0) as sodium_mg,
                    COALESCE(SUM(f.potassium_mg * mi.amount), 0) as potassium_mg,
                    COALESCE(SUM(f.calcium_mg * mi.amount), 0) as calcium_mg,
                    COALESCE(SUM(f.iron_mg * mi.amount), 0) as iron_mg,
                    COALESCE(SUM(f.magnesium_mg * mi.amount), 0) as magnesium_mg,
                    COALESCE(SUM(f.zinc_mg * mi.amount), 0) as zinc_mg,
                    
                    -- Vitamins
                    COALESCE(SUM(f.vitamin_a_mcg * mi.amount), 0) as vitamin_a_mcg,
                    COALESCE(SUM(f.vitamin_c_mg * mi.amount), 0) as vitamin_c_mg,
                    COALESCE(SUM(f.vitamin_d_mcg * mi.amount), 0) as vitamin_d_mcg,
                    COALESCE(SUM(f.vitamin_b12_mcg * mi.amount), 0) as vitamin_b12_mcg,
                    COALESCE(SUM(f.folate_mcg * mi.amount), 0) as folate_mcg
                    
                FROM meals m
                LEFT JOIN meal_items mi ON m.id = mi.meal_id
                LEFT JOIN foods f ON mi.food_id = f.id
                WHERE m.meal_time BETWEEN ? AND ?""",
                (start, end)
            ).fetchone()
            
            summary = dict(result)
            summary['date'] = str(target_date)
            
            # Round all numeric values
            for key, val in summary.items():
                if isinstance(val, float):
                    summary[key] = round(val, 1)
            
            # Get list of foods eaten with actual amounts
            foods = conn.execute(
                """SELECT f.name, mi.quantity, mi.unit, mi.amount, mi.actual_grams, f.serving_size
                   FROM meals m
                   JOIN meal_items mi ON m.id = mi.meal_id
                   JOIN foods f ON mi.food_id = f.id
                   WHERE m.meal_time BETWEEN ? AND ?
                   ORDER BY m.meal_time""",
                (start, end)
            ).fetchall()
            
            def format_food(row):
                name = row['name']
                # Calculate actual grams: prefer actual_grams, then amount * serving_size, then quantity
                if row['actual_grams']:
                    grams = row['actual_grams']
                elif row['amount'] and row['serving_size']:
                    grams = row['amount'] * row['serving_size']
                elif row['quantity'] and row['unit'] and row['unit'] != 'None':
                    return f"{row['quantity']:.0f}{row['unit']} {name}"
                else:
                    grams = (row['quantity'] or 1) * (row['serving_size'] or 100)
                return f"{grams:.0f}g {name}"
            
            summary['foods_eaten'] = [format_food(row) for row in foods]
            
            return summary
    
    def format_daily_summary(self, target_date: date = None) -> str:
        """Format daily summary as readable text."""
        summary = self.get_daily_summary(target_date)
        
        if summary['meal_count'] == 0:
            return f"📊 **{summary['date']}** - No meals logged today."
        
        lines = [
            f"📊 **Daily Summary - {summary['date']}**",
            f"Meals: {summary['meal_count']} | Items: {summary['item_count']}",
            "",
            "**🔥 Calories & Macros**",
            f"  Calories: {summary['calories']:.0f} kcal",
            f"  Protein: {summary['protein_g']:.1f}g",
            f"  Fat: {summary['fat_g']:.1f}g (sat: {summary['saturated_fat_g']:.1f}g)",
            f"  Carbs: {summary['carbs_g']:.1f}g",
            f"    ↳ Fiber: {summary['fiber_g']:.1f}g",
            f"    ↳ Sugar: {summary['sugar_g']:.1f}g",
        ]
        
        # Only show micros if we have data
        has_micros = any([
            summary.get('sodium_mg', 0) > 0,
            summary.get('vitamin_c_mg', 0) > 0,
        ])
        
        if has_micros:
            lines.extend([
                "",
                "**💊 Key Micronutrients**",
                f"  Sodium: {summary['sodium_mg']:.0f}mg",
                f"  Potassium: {summary['potassium_mg']:.0f}mg",
                f"  Calcium: {summary['calcium_mg']:.0f}mg",
                f"  Iron: {summary['iron_mg']:.1f}mg",
                f"  Vit C: {summary['vitamin_c_mg']:.1f}mg",
                f"  Vit D: {summary['vitamin_d_mcg']:.1f}mcg",
            ])
        
        if summary['foods_eaten']:
            lines.extend([
                "",
                "**🍽 Foods Eaten**",
            ])
            for food in summary['foods_eaten'][:15]:  # Limit to 15 items
                lines.append(f"  • {food}")
            if len(summary['foods_eaten']) > 15:
                lines.append(f"  ... and {len(summary['foods_eaten']) - 15} more")
        
        return '\n'.join(lines)
    
    # =====================
    # ANALYTICS
    # =====================
    
    def get_weekly_stats(self, weeks: int = 1) -> Dict:
        """Get nutrition stats for the past N weeks."""
        end_date = date.today()
        start_date = end_date - timedelta(days=7 * weeks)
        
        with self._get_conn() as conn:
            result = conn.execute(
                """SELECT 
                    DATE(m.meal_time) as day,
                    COALESCE(SUM(f.calories * mi.actual_grams / f.serving_size), 0) as calories,
                    COALESCE(SUM(f.protein_g * mi.actual_grams / f.serving_size), 0) as protein_g,
                    COALESCE(SUM(f.carbs_g * mi.actual_grams / f.serving_size), 0) as carbs_g,
                    COALESCE(SUM(f.fiber_g * mi.actual_grams / f.serving_size), 0) as fiber_g,
                    COALESCE(SUM(f.sugar_g * mi.actual_grams / f.serving_size), 0) as sugar_g,
                    COALESCE(SUM(f.fat_g * mi.actual_grams / f.serving_size), 0) as fat_g
                FROM meals m
                LEFT JOIN meal_items mi ON m.id = mi.meal_id
                LEFT JOIN foods f ON mi.food_id = f.id
                WHERE DATE(m.meal_time) BETWEEN ? AND ?
                GROUP BY DATE(m.meal_time)
                ORDER BY day""",
                (start_date.isoformat(), end_date.isoformat())
            ).fetchall()
            
            daily_data = [dict(row) for row in result]
            
            # Calculate averages
            if daily_data:
                avg = {
                    'calories': sum(d['calories'] for d in daily_data) / len(daily_data),
                    'protein_g': sum(d['protein_g'] for d in daily_data) / len(daily_data),
                    'carbs_g': sum(d['carbs_g'] for d in daily_data) / len(daily_data),
                    'fiber_g': sum(d['fiber_g'] for d in daily_data) / len(daily_data),
                    'sugar_g': sum(d['sugar_g'] for d in daily_data) / len(daily_data),
                    'fat_g': sum(d['fat_g'] for d in daily_data) / len(daily_data),
                }
            else:
                avg = {}
            
            return {
                'start_date': start_date.isoformat(),
                'end_date': end_date.isoformat(),
                'days_tracked': len(daily_data),
                'daily_data': daily_data,
                'averages': {k: round(v, 1) for k, v in avg.items()}
            }
    
    def get_food_frequency(self, days: int = 30) -> List[Dict]:
        """Get most frequently eaten foods in the past N days."""
        start_date = date.today() - timedelta(days=days)
        
        with self._get_conn() as conn:
            result = conn.execute(
                """SELECT 
                    f.id, f.name, f.brand,
                    COUNT(*) as times_eaten,
                    SUM(mi.actual_grams) as total_grams,
                    AVG(mi.actual_grams) as avg_serving_grams
                FROM meal_items mi
                JOIN foods f ON mi.food_id = f.id
                JOIN meals m ON mi.meal_id = m.id
                WHERE DATE(m.meal_time) >= ?
                GROUP BY f.id
                ORDER BY times_eaten DESC
                LIMIT 30""",
                (start_date.isoformat(),)
            ).fetchall()
            
            return [dict(row) for row in result]
    
    # =====================
    # GROCERY LIST
    # =====================
    
    def generate_grocery_list(self, days_to_analyze: int = 14) -> Dict:
        """Generate grocery list based on meal patterns."""
        freq = self.get_food_frequency(days_to_analyze)
        
        # Calculate weekly consumption rate
        weeks = days_to_analyze / 7
        grocery_items = []
        
        for food in freq:
            weekly_rate = food['times_eaten'] / weeks
            weekly_grams = (food['total_grams'] or 0) / weeks
            
            # Only include foods eaten at least once per week
            if weekly_rate >= 0.5:
                grocery_items.append({
                    'name': food['name'],
                    'brand': food['brand'],
                    'weekly_servings': round(weekly_rate, 1),
                    'weekly_grams': round(weekly_grams, 0),
                    'priority': 'high' if weekly_rate >= 3 else 'medium' if weekly_rate >= 1 else 'low'
                })
        
        return {
            'generated_at': datetime.now().isoformat(),
            'based_on_days': days_to_analyze,
            'items': grocery_items
        }
    
    def format_grocery_list(self, days_to_analyze: int = 14) -> str:
        """Format grocery list as readable text."""
        grocery = self.generate_grocery_list(days_to_analyze)
        
        if not grocery['items']:
            return "🛒 **Grocery List** - Not enough meal data yet. Keep logging!"
        
        lines = [
            "🛒 **Weekly Grocery List**",
            f"Based on your last {grocery['based_on_days']} days of eating",
            ""
        ]
        
        # Group by priority
        high = [i for i in grocery['items'] if i['priority'] == 'high']
        medium = [i for i in grocery['items'] if i['priority'] == 'medium']
        low = [i for i in grocery['items'] if i['priority'] == 'low']
        
        if high:
            lines.append("**🔴 Essentials (3+ times/week)**")
            for item in high:
                lines.append(f"  • {item['name']} (~{item['weekly_grams']:.0f}g/week)")
        
        if medium:
            lines.append("")
            lines.append("**🟡 Regular (1-3 times/week)**")
            for item in medium:
                lines.append(f"  • {item['name']} (~{item['weekly_grams']:.0f}g/week)")
        
        if low:
            lines.append("")
            lines.append("**🟢 Occasional**")
            for item in low[:10]:  # Limit
                lines.append(f"  • {item['name']}")
        
        return '\n'.join(lines)


# =====================
# CLI INTERFACE
# =====================

def main():
    import sys
    tracker = FoodTracker()
    
    if len(sys.argv) < 2:
        print("Usage: tracker.py <command> [args]")
        print("Commands: add_food, find_food, log_meal, daily_summary, weekly_stats, grocery_list")
        return
    
    cmd = sys.argv[1]
    
    if cmd == 'init':
        print(f"Database initialized at {tracker.db_path}")
    
    elif cmd == 'daily_summary':
        target = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else None
        print(tracker.format_daily_summary(target))
    
    elif cmd == 'weekly_stats':
        weeks = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        stats = tracker.get_weekly_stats(weeks)
        print(json.dumps(stats, indent=2))
    
    elif cmd == 'grocery_list':
        days = int(sys.argv[2]) if len(sys.argv) > 2 else 14
        print(tracker.format_grocery_list(days))
    
    elif cmd == 'find_food':
        query = sys.argv[2] if len(sys.argv) > 2 else ''
        results = tracker.find_food(query)
        for r in results:
            print(f"{r['id']}: {r['name']} - {r['calories']} kcal per {r['serving_size']}{r['serving_unit']}")
    
    else:
        print(f"Unknown command: {cmd}")


if __name__ == '__main__':
    main()
