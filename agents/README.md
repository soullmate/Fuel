# FUEL Agents

Agents are **instruction sets for your personal assistant** -- structured prompts that tell an LLM how to behave when performing a specific role. Think of each agent as a job description: it defines the scope, rules, tone, and tools for one area of responsibility.

Some agents are interactive (you talk to them), others run as **background services** (cron jobs, health checks, data enrichment).

## Agent Directory

| Agent | Type | Role | Spec |
|-------|------|------|------|
| **LOGOS** | Interactive | Smart meal input via pipeline | `LOGOS.md` |
| **HAYDEN** | Background | System health + pipeline audit | `HAYDEN.md`, `hayden.js` |
| **DIQQ** | Background | Data quality & USDA enrichment | `DIQQ.md`, `../diqq.js` |
| **GERA** | Interactive | Consultation & motivation | `GERA.md` |
| **ZEUS** | Interactive | Meal planning & grocery | `ZEUS.md` |
| **RICKY** | Background | Record integrity checking | `RICKY.md` |

## Key References

- **Pipeline**: `MEAL_LOGGING_PIPELINE.md` -- two-phase commit flow via `lib/pipeline.js`
- **Schema**: `DATABASE_SCHEMA.md` -- canonical DB reference (amount = grams / 100)
- **Audit**: `lib/pigeon.js` -- ephemeral audit workers spawned by HAYDEN
- **Routing**: `lib/router.js` -- intent classification (log/correction/advice/query)
- **Parsing**: `lib/normalize.js` -- deterministic preprocessing, fuzzy matching, unit conversion

## How It Works

Each `.md` file is fed to an LLM as a system prompt. The LLM then acts according to the agent's instructions -- parsing meals, running audits, giving advice, etc. You can customize any agent by editing its spec file.

Background agents are triggered by cron or event hooks. Interactive agents respond to user messages routed by `lib/router.js`.

## Communication Model

Background agents (HAYDEN, DIQQ, RICKY) report to the **personal assistant**, not directly to the human.

```
Human ←→ Personal Assistant (you)
              ↑
         agent_reports table
              ↑
    HAYDEN, DIQQ, RICKY (cron jobs)
```

### How It Works

1. Background agents write to `agent_reports` table via `POST /api/reports`
2. PA scan cron (`agents/pa-scan.js`) runs every 15 minutes
3. PA scan reads pending reports, processes them, and acknowledges
4. Reports marked `for_human=1` are queued for the next human conversation
5. Reports marked `for_human=0` are handled autonomously (stored, logged, or noted)

### Report Categories

| Category | Description | Typical Action |
|----------|-------------|----------------|
| `health` | System health check results | Note or log for briefing |
| `data_quality` | USDA enrichment results | Log for briefing |
| `learning` | Learned preference about human | Store in PA memory |
| `preference` | Explicit preference | Store in PA memory |
| `anomaly` | Unusual data pattern detected | Review and potentially alert human |

### API Endpoints

```bash
POST /api/reports              # Agents write reports
GET  /api/reports/pending      # PA reads unacknowledged reports
PUT  /api/reports/:id/ack      # PA acknowledges after processing
GET  /api/reports              # List all reports (with filters)
```
