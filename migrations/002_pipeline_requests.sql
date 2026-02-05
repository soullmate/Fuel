-- Migration 002: Pipeline request logging
-- Tracks every pipeline process() call — confirmed or not.

CREATE TABLE IF NOT EXISTS pipeline_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_input TEXT NOT NULL,
    intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    meal_id INTEGER REFERENCES meals(id),
    result_summary TEXT,
    incomplete_reason TEXT,
    confidence_pct REAL,
    followup_count INTEGER DEFAULT 0,
    last_followup_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME,
    committed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_pipeline_requests_status ON pipeline_requests(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_created ON pipeline_requests(created_at);
