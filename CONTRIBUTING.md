# Contributing to FUEL

Thanks for your interest in contributing. Here's how to get started.

## Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, browser)

## Development Setup

```bash
git clone https://github.com/user/fuel.git
cd fuel
cp .env.example .env
npm install
npm start
# Dashboard at http://localhost:3456
```

Seed the database with common foods:
```bash
python3 seed_foods.py
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test manually (start the server, verify the dashboard works)
4. Submit a pull request

## Code Style

- **JavaScript**: No transpilation, no TypeScript. Plain Node.js + Express.
- **Frontend**: Single-file `index.html` with inline CSS/JS. No build step.
- **Database**: SQLite via `better-sqlite3`. Migrations go in `migrations/`.
- **Python**: Used only for seed scripts and CLI utilities. Not required at runtime.

## Project Structure

```
fuel/
├── web/server.js           # Express API + target calculation engine
├── web/public/index.html   # Single-page dashboard (self-contained)
├── schema.sql              # Database schema
├── lib/                    # Server-side modules (pipeline, normalization)
├── agents/                 # Agent role documentation (for AI integration)
├── seed_foods.py           # Database seed script
└── diqq.js                 # USDA auto-enrichment
```

## Key Conventions

- **Food nutrition** is stored per 100g in the `foods` table
- **meal_items.amount** is a multiplier: `grams / 100` (so 150g = 1.5)
- **Carb cycling** is optional. The app must always work with cycling OFF.
- **No external services required** except optionally USDA FoodData Central for micronutrient enrichment

## Pull Request Guidelines

- Keep PRs focused. One feature or fix per PR.
- Don't change unrelated code.
- If adding an API endpoint, add it to the API Reference in README.md.
- If adding a database column, add a migration file in `migrations/`.

## Questions?

Open an issue or start a discussion.
