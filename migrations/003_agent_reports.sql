-- Migration: Add agent_reports table for PA communication
-- Background agents (HAYDEN, DIQQ, RICKY) write reports here.
-- The PA scan cron reads pending reports and processes them.

CREATE TABLE IF NOT EXISTS agent_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,              -- 'hayden', 'diqq', 'ricky', 'gera', 'zeus'
    severity TEXT DEFAULT 'info',     -- 'critical', 'high', 'medium', 'low', 'info'
    category TEXT,                    -- 'health', 'data_quality', 'learning', 'anomaly', 'preference'
    summary TEXT NOT NULL,            -- One-line summary for PA
    details TEXT,                     -- JSON blob for structured data
    for_human INTEGER DEFAULT 0,      -- 1 = needs human decision, 0 = PA can handle
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME,         -- NULL until PA processes
    resolution TEXT                   -- What PA did with it
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_pending
    ON agent_reports(acknowledged_at) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_reports_agent ON agent_reports(agent);
CREATE INDEX IF NOT EXISTS idx_agent_reports_severity ON agent_reports(severity);
