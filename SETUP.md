# FUEL Setup Guide

Complete setup instructions for the FUEL nutrition tracking skill.

## Prerequisites

- Node.js 18+
- SQLite3
- USDA API key (free) — [Get one here](https://fdc.nal.usda.gov/api-key-signup.html)

## 1. Install Dependencies

```bash
cd fuel-public
npm install
```

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Required: USDA API key for food data enrichment
USDA_API_KEY=your_key_here

# Optional: Generate a secure access token
# Run: echo "fuel-$(openssl rand -hex 6)"
ACCESS_TOKEN=fuel-a1b2c3d4e5f6

# Optional: Bind to all interfaces for remote access
HOST=0.0.0.0
PORT=3456
```

## 3. Initialize Database

```bash
sqlite3 food_tracker.db < schema.sql
```

This creates all required tables with sensible defaults.

## 4. Start the Server

```bash
node web/server.js
```

You should see:
```
🔒 Access token enabled — app at /fuel-a1b2c3...
🔍 DIQQ loaded - Food quality control active
🔥 FUEL v3 running on http://0.0.0.0:3456
```

## 5. Access the Dashboard

Open in browser:
```
http://your-server:3456/{ACCESS_TOKEN}/
```

New users will see an onboarding screen prompting them to set up with their AI assistant.

## 6. Set Up Background Agents (Optional)

See [CRON_SETUP.md](./CRON_SETUP.md) for:
- HAYDEN — Health monitoring (every 15 min)
- DIQQ — Food data enrichment (every 3 hours)
- PA Scan — Process agent reports (every 15 min)

## Directory Structure

```
fuel-public/
├── web/
│   ├── server.js        # Main API server
│   └── public/          # Dashboard frontend
├── agents/
│   ├── hayden.js        # Health check agent
│   ├── pa-scan.js       # PA report processor
│   └── *.md             # Agent behavior specs
├── schema.sql           # Database schema
├── diqq.js              # Food enrichment module
├── SKILL.md             # Main skill instructions
├── SETUP.md             # This file
└── CRON_SETUP.md        # Cron job setup
```

## Verify Installation

```bash
# Check server is running
curl http://localhost:3456/api/health
# Expected: {"status":"ok"}

# Check database tables exist
sqlite3 food_tracker.db ".tables"
# Expected: agent_reports, foods, meals, user_settings, ...

# Check settings
curl http://localhost:3456/api/settings
# Expected: JSON with weight_kg, height_cm, etc.
```

## Troubleshooting

### "Cannot find module 'better-sqlite3'"
```bash
npm install
```

### "SQLITE_ERROR: no such table"
```bash
sqlite3 food_tracker.db < schema.sql
```

### Dashboard not loading remotely
Set `HOST=0.0.0.0` in `.env` and restart server.

### DIQQ enrichment failing
Check your `USDA_API_KEY` is set correctly in `.env`.

## Next Steps

1. Tell your AI assistant: *"I'd like to set up nutrition tracking"*
2. The assistant will collect your info (age, weight, height, activity level)
3. Start logging meals: *"I had 2 eggs and toast for breakfast"*
4. Check your dashboard to see your daily fuel
