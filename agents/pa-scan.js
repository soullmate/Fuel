#!/usr/bin/env node
/**
 * PA Scan — Personal Assistant report processor
 *
 * Runs periodically (cron) to check for reports from background agents
 * (HAYDEN, DIQQ, RICKY) and processes them.
 *
 * Cron setup (every 15 min):
 *   0,15,30,45 * * * * cd /path/to/fuel-public && node agents/pa-scan.js >> logs/pa-scan.log 2>&1
 *
 * Reports are processed based on severity and category:
 * - critical/high with for_human=1: queued for human attention
 * - learning/preference: stored for PA memory
 * - health/data_quality: logged for daily briefing
 */

const API_BASE = process.env.FUEL_API_BASE || 'http://localhost:3456';

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] PA Scan starting...`);

  // Fetch pending reports
  let response;
  try {
    response = await fetch(`${API_BASE}/api/reports/pending`);
  } catch (err) {
    console.error('Cannot connect to FUEL server:', err.message);
    console.error('Is the server running? (node web/server.js)');
    process.exit(1);
  }

  if (!response.ok) {
    console.error('Failed to fetch pending reports:', await response.text());
    process.exit(1);
  }

  const { count, reports } = await response.json();

  if (count === 0) {
    console.log('No pending reports.');
    return;
  }

  console.log(`Processing ${count} pending report(s)...`);

  for (const report of reports) {
    const severityLabel = report.severity.toUpperCase().padEnd(8);
    console.log(`\n[${severityLabel}] ${report.agent}: ${report.summary}`);

    // Determine resolution based on category and for_human flag
    let resolution;

    if (report.for_human) {
      // Queue for next human interaction
      resolution = 'queued_for_human';
      console.log('  → Queued for human attention');
    } else {
      // PA handles autonomously based on category
      switch (report.category) {
        case 'health':
          if (report.severity === 'info') {
            resolution = 'noted';
          } else {
            resolution = 'logged_for_briefing';
          }
          break;

        case 'data_quality':
          resolution = 'logged_for_briefing';
          break;

        case 'learning':
        case 'preference':
          resolution = 'stored_in_memory';
          // Future: write to PA memory file
          // For now, the resolution is logged and can be queried
          if (report.details) {
            console.log(`  → Learning: ${JSON.stringify(report.details)}`);
          }
          break;

        case 'anomaly':
          resolution = report.severity === 'info' ? 'noted' : 'logged_for_briefing';
          break;

        default:
          resolution = 'acknowledged';
      }
      console.log(`  → ${resolution}`);
    }

    // Acknowledge the report
    try {
      const ackResponse = await fetch(`${API_BASE}/api/reports/${report.id}/ack`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution })
      });

      if (!ackResponse.ok) {
        console.error(`  ! Failed to acknowledge report ${report.id}:`, await ackResponse.text());
      }
    } catch (err) {
      console.error(`  ! Error acknowledging report ${report.id}:`, err.message);
    }
  }

  console.log(`\n[${new Date().toISOString()}] PA Scan complete. Processed ${count} report(s).`);
}

// Run
main().catch(err => {
  console.error('PA Scan error:', err);
  process.exit(1);
});
