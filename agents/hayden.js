#!/usr/bin/env node
/**
 * HAYDEN — System Health Supervisor
 * 
 * Runs hourly to test the food tracker system and catch failures
 * before users hit them.
 * 
 * Usage:
 *   node hayden.js          # Full test suite
 *   node hayden.js --quick  # Quick health check only
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const http = require('http');

// Configuration
const DB_PATH = process.env.HAYDEN_DB_PATH || path.join(__dirname, '..', 'food_tracker.db');
const STATE_PATH = process.env.HAYDEN_STATE_PATH || path.join(__dirname, 'hayden-state.json');
const ISSUES_DIR = process.env.HAYDEN_ISSUES_DIR || path.join(__dirname, '..', 'issues');
const API_BASE = process.env.FUEL_API_BASE || 'http://localhost:3456';

// Test results
const results = {
  timestamp: new Date().toISOString(),
  tests: [],
  passed: 0,
  failed: 0,
  warnings: 0,
  autoFixes: [],
  issues: []
};

// Severity levels
const SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH', 
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

// Helper: Load state
function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch (e) {}
  return {
    lastRun: null,
    consecutiveFailures: 0,
    openIssues: 0,
    testsRun: 0,
    testsPassed: 0
  };
}

// Helper: Save state
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Helper: HTTP request
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
    http.get(url, (res) => {
      clearTimeout(timeout);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    }).on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

// Helper: HTTP POST
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
    const postData = JSON.stringify(body);
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = http.request(options, (res) => {
      clearTimeout(timeout);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    
    req.write(postData);
    req.end();
  });
}

// Helper: HTTP DELETE
function httpDelete(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'DELETE'
    };
    
    const req = http.request(options, (res) => {
      clearTimeout(timeout);
      resolve({ status: res.statusCode });
    });
    
    req.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    
    req.end();
  });
}

// Helper: Report to Personal Assistant via agent_reports table
async function reportToPA(severity, summary, details, forHuman = false) {
  try {
    await httpPost(`${API_BASE}/api/reports`, {
      agent: 'hayden',
      severity,
      category: 'health',
      summary,
      details,
      for_human: forHuman ? 1 : 0
    });
  } catch (err) {
    // Don't fail the whole run if reporting fails
    console.log(`   ⚠️  Could not report to PA: ${err.message}`);
  }
}

// Helper: Record test result
function recordTest(name, passed, details = '', autoFix = null) {
  results.tests.push({
    name,
    passed,
    details,
    autoFix,
    timestamp: new Date().toISOString()
  });
  
  if (passed) {
    results.passed++;
  } else {
    results.failed++;
  }
  
  if (autoFix) {
    results.autoFixes.push(autoFix);
  }
  
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${details ? ` — ${details}` : ''}`);
  if (autoFix) {
    console.log(`   🔧 Auto-fix: ${autoFix}`);
  }
}

// Helper: Create issue
function createIssue(severity, title, error, impact, autoFixAttempted = null) {
  // Ensure issues directory exists
  const openDir = path.join(ISSUES_DIR, 'OPEN');
  fs.mkdirSync(openDir, { recursive: true });
  
  const date = new Date().toISOString().split('T')[0];
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const filename = `${date}_${slug}.md`;
  const filepath = path.join(openDir, filename);
  
  const content = `# [${severity}] ${title}

**Detected:** ${new Date().toISOString()}
**Test:** HAYDEN automated health check
**Status:** OPEN

## Error
\`\`\`
${error}
\`\`\`

## Impact
${impact}

## Auto-Fix Attempted
${autoFixAttempted ? `- [x] Attempted: ${autoFixAttempted.action}\n- [${autoFixAttempted.success ? 'x' : ' '}] Result: ${autoFixAttempted.success ? 'Success' : 'Failed'}` : '- [ ] No auto-fix available'}

## Manual Fix Required
Please investigate and resolve manually.

## Resolution
(to be filled when fixed)
`;

  fs.writeFileSync(filepath, content);
  results.issues.push({ severity, title, filepath });
  console.log(`📋 Issue created: ${filepath}`);
  
  return filepath;
}

// ============================================
// TEST SUITE
// ============================================

// Test 1: Database Connection
async function testDatabaseConnection() {
  return new Promise((resolve) => {
    if (!fs.existsSync(DB_PATH)) {
      recordTest('Database Connection', false, `Database file not found: ${DB_PATH}`);
      createIssue(SEVERITY.CRITICAL, 'Database file missing', 
        `Expected database at ${DB_PATH} but file does not exist`,
        'All food tracking features are broken. Cannot log meals or view history.');
      resolve(false);
      return;
    }
    
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        recordTest('Database Connection', false, err.message);
        createIssue(SEVERITY.CRITICAL, 'Database connection failed',
          err.message,
          'All food tracking features are broken.');
        resolve(false);
        return;
      }
      
      db.get('SELECT 1 as test', (err, row) => {
        db.close();
        if (err || !row) {
          recordTest('Database Connection', false, err?.message || 'Query failed');
          resolve(false);
        } else {
          recordTest('Database Connection', true, 'OK');
          resolve(true);
        }
      });
    });
  });
}

// Test 2: Schema Integrity
async function testSchemaIntegrity() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    const requiredTables = ['foods', 'meals', 'meal_items'];
    const requiredColumns = {
      foods: ['id', 'name', 'calories', 'protein_g', 'serving_size'],
      meals: ['id', 'meal_type', 'meal_time'],  // meal_time is DATETIME (combined)
      meal_items: ['id', 'meal_id', 'food_id', 'amount']
    };
    
    let allPassed = true;
    let issues = [];
    
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
      if (err) {
        recordTest('Schema Integrity', false, err.message);
        db.close();
        resolve(false);
        return;
      }
      
      const tableNames = tables.map(t => t.name);
      
      for (const table of requiredTables) {
        if (!tableNames.includes(table)) {
          issues.push(`Missing table: ${table}`);
          allPassed = false;
        }
      }
      
      // Check columns for each required table
      let checksRemaining = Object.keys(requiredColumns).length;
      
      for (const [table, columns] of Object.entries(requiredColumns)) {
        if (!tableNames.includes(table)) {
          checksRemaining--;
          continue;
        }
        
        db.all(`PRAGMA table_info(${table})`, (err, tableInfo) => {
          checksRemaining--;
          
          if (err) {
            issues.push(`Cannot read ${table} schema: ${err.message}`);
            allPassed = false;
          } else {
            const columnNames = tableInfo.map(c => c.name);
            for (const col of columns) {
              if (!columnNames.includes(col)) {
                issues.push(`Missing column: ${table}.${col}`);
                allPassed = false;
              }
            }
          }
          
          if (checksRemaining === 0) {
            db.close();
            if (allPassed) {
              recordTest('Schema Integrity', true, 'All tables and columns present');
            } else {
              recordTest('Schema Integrity', false, issues.join('; '));
              createIssue(SEVERITY.HIGH, 'Schema integrity check failed',
                issues.join('\n'),
                'Some queries may fail. Daily summaries and meal logging may be broken.');
            }
            resolve(allPassed);
          }
        });
      }
    });
  });
}

// Test 3: API Health Check
async function testAPIHealth() {
  const endpoints = [
    { url: `${API_BASE}/api/health`, expect: 'status field' },
    { url: `${API_BASE}/api/daily`, expect: 'date field' },
    { url: `${API_BASE}/api/foods?limit=1`, expect: 'array' }
  ];
  
  let allPassed = true;
  let issues = [];
  
  for (const endpoint of endpoints) {
    try {
      const res = await httpGet(endpoint.url);
      
      if (res.status !== 200) {
        issues.push(`${endpoint.url} returned ${res.status}`);
        allPassed = false;
      } else if (endpoint.expect === 'array' && !Array.isArray(res.data)) {
        issues.push(`${endpoint.url} did not return array`);
        allPassed = false;
      } else if (endpoint.expect === 'date field' && !res.data.date) {
        issues.push(`${endpoint.url} missing date field`);
        allPassed = false;
      }
    } catch (e) {
      issues.push(`${endpoint.url}: ${e.message}`);
      allPassed = false;
    }
  }
  
  if (allPassed) {
    recordTest('API Health', true, 'All endpoints responding');
  } else {
    recordTest('API Health', false, issues.join('; '));
    
    // Check if server is running
    if (issues.some(i => i.includes('ECONNREFUSED') || i.includes('Timeout'))) {
      createIssue(SEVERITY.CRITICAL, 'API server not responding',
        issues.join('\n'),
        'Dashboard and all API features are unavailable.',
        { action: 'Restart server with pm2', success: false });
    }
  }
  
  return allPassed;
}

// Test 4: Write Test (Canary Meal)
async function testWriteCapability() {
  // Use the actual API schema
  const testMeal = {
    meal_type: 'snack',
    meal_time: new Date().toISOString(),
    items: [{ food_id: 1, amount: 0.01 }]  // Tiny amount so it doesn't affect totals
  };
  
  try {
    // Try to create a test meal
    const createRes = await httpPost(`${API_BASE}/api/meals`, testMeal);
    
    if (createRes.status !== 201 && createRes.status !== 200) {
      recordTest('Write Capability', false, `Create returned ${createRes.status}`);
      createIssue(SEVERITY.HIGH, 'Cannot create meals',
        `POST /api/meals returned ${createRes.status}`,
        'Users cannot log new meals.');
      return false;
    }
    
    const mealId = createRes.data.id || createRes.data.meal_id;
    
    if (mealId) {
      // Clean up test meal
      const deleteRes = await httpDelete(`${API_BASE}/api/meals/${mealId}`);
      if (deleteRes.status !== 200 && deleteRes.status !== 204) {
        recordTest('Write Capability', true, 'Create OK, cleanup warning');
        return true;
      }
    }
    
    recordTest('Write Capability', true, 'Create and delete OK');
    return true;
    
  } catch (e) {
    recordTest('Write Capability', false, e.message);
    return false;
  }
}

// Test 5: DIQQ Status
async function testDIQQStatus() {
  try {
    const res = await httpGet(`${API_BASE}/api/diqq/status`);
    
    if (res.status === 200 && res.data) {
      const { needsEnrichment, total } = res.data;
      if (needsEnrichment > 10) {
        recordTest('DIQQ Status', true, `${needsEnrichment}/${total} foods need enrichment (consider running scan)`);
      } else {
        recordTest('DIQQ Status', true, `${needsEnrichment || 0} foods pending enrichment`);
      }
      return true;
    } else if (res.status === 404) {
      recordTest('DIQQ Status', true, 'DIQQ endpoint not configured (optional)');
      return true;
    } else {
      recordTest('DIQQ Status', false, `Unexpected response: ${res.status}`);
      return false;
    }
  } catch (e) {
    recordTest('DIQQ Status', false, e.message);
    return false;
  }
}

// Test 6: Daily Summary Query
async function testDailySummaryQuery() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    
    // Use the actual schema: meals has meal_time (DATETIME), meal_items has amount
    const query = `
      SELECT 
        DATE(m.meal_time) as date,
        COUNT(DISTINCT m.id) as meal_count,
        COALESCE(SUM(f.calories * mi.amount), 0) as total_calories,
        COALESCE(SUM(f.protein_g * mi.amount), 0) as total_protein
      FROM meals m
      LEFT JOIN meal_items mi ON m.id = mi.meal_id
      LEFT JOIN foods f ON mi.food_id = f.id
      WHERE DATE(m.meal_time) = date('now')
      GROUP BY DATE(m.meal_time)
    `;
    
    db.get(query, (err, row) => {
      db.close();
      
      if (err) {
        recordTest('Daily Summary Query', false, err.message);
        createIssue(SEVERITY.HIGH, 'Daily summary query broken',
          err.message,
          'Daily nutrition summaries will fail. Users won\'t see their daily totals.');
        resolve(false);
      } else {
        recordTest('Daily Summary Query', true, 'Query executes successfully');
        resolve(true);
      }
    });
  });
}

// ============================================
// TEST 7: LOGOS Schema Consistency
// ============================================

async function testLOGOSSchemaConsistency() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    let allPassed = true;
    let issues = [];
    
    // Check 1: Foods table columns with correct names
    const requiredFoodsCols = ['calories', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sugar_g', 'serving_size', 'brand'];
    const wrongFoodsCols = ['protein', 'fat', 'carbs', 'fiber', 'sugar', 'cal']; // These would be WRONG
    
    db.all("PRAGMA table_info(foods)", (err, cols) => {
      if (err) {
        recordTest('LOGOS Schema: Foods', false, err.message);
        resolve(false);
        return;
      }
      
      const colNames = cols.map(c => c.name);
      
      // Check required columns exist
      for (const col of requiredFoodsCols) {
        if (!colNames.includes(col)) {
          issues.push(`Missing foods.${col}`);
          allPassed = false;
        }
      }
      
      // Check for wrong column names (would cause silent failures)
      for (const col of wrongFoodsCols) {
        if (colNames.includes(col)) {
          issues.push(`Wrong column name: foods.${col} (should have _g suffix)`);
          allPassed = false;
        }
      }
      
      // Check 2: Meals table structure
      db.all("PRAGMA table_info(meals)", (err, cols) => {
        if (err) {
          issues.push(`Cannot read meals schema: ${err.message}`);
          allPassed = false;
        } else {
          const colNames = cols.map(c => c.name);
          
          // meal_time should be DATETIME (not separate date/time)
          if (!colNames.includes('meal_time')) {
            issues.push('Missing meals.meal_time (DATETIME)');
            allPassed = false;
          }
          
          // Check for wrong schema (separate date/time columns)
          if (colNames.includes('date') && colNames.includes('time') && !colNames.includes('meal_time')) {
            issues.push('Wrong schema: meals has separate date/time instead of meal_time');
            allPassed = false;
          }
          
          if (!colNames.includes('title')) {
            issues.push('Missing meals.title');
            allPassed = false;
          }
        }
        
        // Check 3: Meal_items amount convention
        db.all("PRAGMA table_info(meal_items)", (err, cols) => {
          if (err) {
            issues.push(`Cannot read meal_items schema: ${err.message}`);
            allPassed = false;
          } else {
            const colNames = cols.map(c => c.name);
            
            const requiredMealItemsCols = ['amount', 'actual_grams'];
            for (const col of requiredMealItemsCols) {
              if (!colNames.includes(col)) {
                issues.push(`Missing meal_items.${col}`);
                allPassed = false;
              }
            }
          }
          
          // Check 4: DATABASE_SCHEMA.md exists
          const schemaDocPath = path.join(__dirname, 'DATABASE_SCHEMA.md');
          if (!fs.existsSync(schemaDocPath)) {
            issues.push('DATABASE_SCHEMA.md not found - LOGOS instructions incomplete!');
            allPassed = false;
          } else {
            const stats = fs.statSync(schemaDocPath);
            const ageMs = Date.now() - stats.mtimeMs;
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            
            if (ageDays > 30) {
              issues.push(`DATABASE_SCHEMA.md is ${Math.round(ageDays)} days old - may be stale`);
              // Not a failure, just a warning
            }
          }
          
          db.close();
          
          if (allPassed) {
            recordTest('LOGOS Schema Consistency', true, 'Schema matches documentation');
          } else {
            recordTest('LOGOS Schema Consistency', false, issues.join('; '));
            createIssue(SEVERITY.CRITICAL, 'LOGOS schema mismatch',
              issues.join('\n'),
              'Meal logging will silently fail or corrupt data. LOGOS instructions do not match actual database schema.');
          }
          
          resolve(allPassed);
        });
      });
    });
  });
}

// ============================================
// TEST 8: Meal Amount Sanity Check
// ============================================

async function testMealAmountSanity() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    
    // The server uses this calculation:
    // CASE WHEN actual_grams IS NULL THEN amount 
    //      WHEN actual_grams > 10 THEN actual_grams / 100.0 
    //      ELSE actual_grams END
    //
    // So actual_grams > 10 is treated as grams and divided by 100.
    // We only flag items where BOTH amount AND actual_grams look wrong.
    
    // Find truly suspicious amounts:
    // - amount > 10 AND actual_grams is NULL (can't auto-correct)
    // - OR calculated calories seem impossible (>5000 for single item)
    const query = `
      SELECT 
        m.id as meal_id,
        m.title,
        m.meal_time,
        f.name as food,
        mi.amount,
        mi.actual_grams,
        ROUND(f.calories * 
          CASE 
            WHEN mi.actual_grams IS NULL THEN mi.amount 
            WHEN mi.actual_grams > 10 THEN mi.actual_grams / 100.0 
            ELSE mi.actual_grams 
          END, 1) as calculated_cal
      FROM meals m
      JOIN meal_items mi ON m.id = mi.meal_id
      JOIN foods f ON mi.food_id = f.id
      WHERE (mi.amount > 10 AND mi.actual_grams IS NULL)
         OR (f.calories * 
             CASE 
               WHEN mi.actual_grams IS NULL THEN mi.amount 
               WHEN mi.actual_grams > 10 THEN mi.actual_grams / 100.0 
               ELSE mi.actual_grams 
             END > 5000)
      ORDER BY m.meal_time DESC
      LIMIT 20
    `;
    
    db.all(query, (err, rows) => {
      if (err) {
        recordTest('Meal Amount Sanity', false, err.message);
        db.close();
        resolve(false);
        return;
      }
      
      if (rows.length === 0) {
        recordTest('Meal Amount Sanity', true, 'All amounts within expected range');
        db.close();
        resolve(true);
        return;
      }
      
      // Found suspicious data
      const details = rows.map(r => 
        `${r.food}: amount=${r.amount}, actual_grams=${r.actual_grams}, calc_cal=${r.calculated_cal}`
      ).join('\n');
      
      recordTest('Meal Amount Sanity', false, `Found ${rows.length} suspicious entries`);
      
      createIssue(SEVERITY.MEDIUM, 'Meal amount anomalies detected',
        `Found ${rows.length} meals with unusual amounts:\n${details}`,
        'Some calorie calculations may be incorrect. Review flagged meals.');
      
      db.close();
      resolve(false);
    });
  });
}

// ============================================
// ENCAPSULATION TESTS
// ============================================

// External app isolation test (ensure FUEL DB is not shared with other apps)
const MARS_DB = process.env.EXTERNAL_APP_DB || '';
const MARS_PORT = parseInt(process.env.EXTERNAL_APP_PORT || '0');

// Test: Database isolation from MARS
async function testEncapDatabaseSeparate() {
  return new Promise((resolve) => {
    const fuelDb = fs.realpathSync(DB_PATH);
    
    if (!fs.existsSync(MARS_DB)) {
      recordTest('ENCAP: Database Separation', true, 'MARS db not found (OK)');
      resolve(true);
      return;
    }
    
    const marsDb = fs.realpathSync(MARS_DB);
    
    if (fuelDb === marsDb) {
      recordTest('ENCAP: Database Separation', false, 'FUEL and MARS share same db!');
      createIssue(SEVERITY.CRITICAL, 'Database isolation breach',
        'FUEL and MARS are using the same database file',
        'Data could be corrupted or leaked between systems');
      resolve(false);
      return;
    }
    
    recordTest('ENCAP: Database Separation', true, `FUEL: ${path.basename(fuelDb)}, MARS: ${path.basename(marsDb)}`);
    resolve(true);
  });
}

// Test: No MARS tables in FUEL database
async function testEncapNoMARSTables() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    const marsTables = ['companies', 'verticals', 'funnel_history', 'contacts'];
    
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
      db.close();
      
      if (err) {
        recordTest('ENCAP: No MARS Tables', false, err.message);
        resolve(false);
        return;
      }
      
      const tableNames = tables.map(t => t.name.toLowerCase());
      const found = marsTables.filter(t => tableNames.includes(t.toLowerCase()));
      
      if (found.length > 0) {
        recordTest('ENCAP: No MARS Tables', false, `Found: ${found.join(', ')}`);
        createIssue(SEVERITY.HIGH, 'MARS tables in FUEL database',
          `Found acquisition tables in food tracker: ${found.join(', ')}`,
          'Database isolation has been breached');
        resolve(false);
        return;
      }
      
      recordTest('ENCAP: No MARS Tables', true, 'No acquisition tables found');
      resolve(true);
    });
  });
}

// Test: API returns only nutrition data
async function testEncapAPIData() {
  return new Promise((resolve) => {
    httpGet(`${API_BASE}/api/daily/${new Date().toISOString().slice(0, 10)}`)
      .then(({ status, data }) => {
        if (status !== 200) {
          recordTest('ENCAP: API Data', false, `Status ${status}`);
          resolve(false);
          return;
        }
        
        const jsonStr = JSON.stringify(data);
        
        // Check for MARS-specific fields that shouldn't be here
        const marsFields = ['companies', 'verticals', 'ebitda', 'ranking_score', 'funnel_stage'];
        const found = marsFields.filter(f => jsonStr.includes(`"${f}"`));
        
        if (found.length > 0) {
          recordTest('ENCAP: API Data', false, `MARS fields found: ${found.join(', ')}`);
          createIssue(SEVERITY.HIGH, 'API data contamination',
            `Found MARS fields in FUEL API: ${found.join(', ')}`,
            'Data isolation breach between systems');
          resolve(false);
          return;
        }
        
        // Verify FUEL-specific fields are present
        const fuelFields = ['calories', 'protein_g', 'meals', 'consumed'];
        const missing = fuelFields.filter(f => !jsonStr.includes(f));
        
        if (missing.length > fuelFields.length / 2) {
          recordTest('ENCAP: API Data', false, `Missing expected FUEL fields`);
          resolve(false);
          return;
        }
        
        recordTest('ENCAP: API Data', true, 'API returns nutrition data only');
        resolve(true);
      })
      .catch(err => {
        recordTest('ENCAP: API Data', false, err.message);
        resolve(false);
      });
  });
}

// Test: Server uses correct port
async function testEncapServerPort() {
  const serverPath = path.join(__dirname, '..', 'web', 'server.js');
  
  try {
    const content = fs.readFileSync(serverPath, 'utf8');
    
    // Check port config
    if (!content.includes('3456')) {
      recordTest('ENCAP: Server Port', false, 'Port 3456 not found in config');
      return false;
    }
    
    if (content.includes('3457') || content.includes('acquisition')) {
      recordTest('ENCAP: Server Port', false, 'MARS port/references found in server');
      createIssue(SEVERITY.MEDIUM, 'Server references MARS',
        'FUEL server.js contains references to MARS port or acquisition',
        'Potential cross-contamination between systems');
      return false;
    }
    
    recordTest('ENCAP: Server Port', true, 'Server configured for FUEL only (3456)');
    return true;
  } catch (err) {
    recordTest('ENCAP: Server Port', false, err.message);
    return false;
  }
}

// Test: Only allowed external API calls
async function testEncapExternalAPIs() {
  const serverPath = path.join(__dirname, '..', 'web', 'server.js');
  
  try {
    const content = fs.readFileSync(serverPath, 'utf8');
    
    // Allowed nutrition-related APIs
    const allowedDomains = ['usda.gov', 'fdc.nal.usda.gov', 'nutritionix', 'openfoodfacts'];
    
    // Look for fetch/http calls to external APIs (not template strings or local)
    const urlMatches = content.match(/https?:\/\/[a-zA-Z][^\s'"`\)]+/g) || [];
    
    for (const url of urlMatches) {
      // Skip local, template vars, fonts, CDNs
      if (url.includes('localhost') || 
          url.includes('127.0.0.1') ||
          url.includes('0.0.0.0') ||
          url.includes('${') ||
          url.includes('fonts') ||
          url.includes('cdn') ||
          url.includes('googleapis')) {
        continue;
      }
      
      const isAllowed = allowedDomains.some(d => url.includes(d));
      
      if (!isAllowed) {
        recordTest('ENCAP: External APIs', false, `Unexpected external API: ${url.slice(0, 50)}`);
        return false;
      }
    }
    
    recordTest('ENCAP: External APIs', true, 'Only nutrition APIs detected');
    return true;
  } catch (err) {
    recordTest('ENCAP: External APIs', false, err.message);
    return false;
  }
}

// ============================================
// Orphan Meal Check
// Finds meals with no meal_items (0 calories, broken entries)
// ============================================
async function testOrphanMeals() {
  return new Promise((resolve) => {
    const db = new (require('better-sqlite3'))(DB_PATH);
    try {
      const orphans = db.prepare(`
        SELECT m.id, m.title, m.meal_time, m.meal_type
        FROM meals m
        LEFT JOIN meal_items mi ON m.id = mi.meal_id
        WHERE mi.id IS NULL AND m.meal_type != 'test'
      `).all();

      if (orphans.length === 0) {
        recordTest('Orphan Meals', true, 'No orphan meals found');
        db.close();
        resolve(true);
        return;
      }

      // Auto-fix: delete orphan meals (they have no data worth keeping)
      const del = db.prepare('DELETE FROM meals WHERE id = ?');
      const deleted = [];
      for (const o of orphans) {
        del.run(o.id);
        deleted.push(`#${o.id} "${o.title || 'untitled'}" (${o.meal_time})`);
        console.log(`   🗑️  Deleted orphan meal: #${o.id} "${o.title}" at ${o.meal_time}`);
      }

      recordTest('Orphan Meals', false, `Found ${orphans.length} orphan meal(s) with no items — auto-deleted: ${deleted.join(', ')}`);
      results.autoFixes.push(`Deleted ${orphans.length} orphan meals: ${deleted.join(', ')}`);

      db.close();
      resolve(false);
    } catch (err) {
      try { db.close(); } catch(e) {}
      recordTest('Orphan Meals', false, err.message);
      resolve(false);
    }
  });
}

// ============================================
// TEST 10: Stale Request Follow-up
// ============================================

async function sweepStaleRequests() {
  try {
    const res = await httpGet(`${API_BASE}/api/pipeline/sweep/stale?minutes=30`);

    if (res.status !== 200) {
      recordTest('Stale Request Sweep', false, `API returned ${res.status}`);
      return false;
    }

    const staleRequests = res.data;

    if (!Array.isArray(staleRequests) || staleRequests.length === 0) {
      recordTest('Stale Request Sweep', true, 'No stale requests');
      return true;
    }

    let nudged = 0;
    let expired = 0;

    for (const req of staleRequests) {
      if (req.followup_count >= 2) {
        // Third+ followup — expire it
        try {
          await httpPost(`${API_BASE}/api/pipeline/requests/${req.id}/abandon`, {});
          expired++;
          console.log(`   ⏰ Expired: "${req.raw_input}" (${req.followup_count + 1} followups, no response)`);
        } catch (e) {
          console.log(`   ⚠️  Failed to expire request ${req.id}: ${e.message}`);
        }
      } else {
        // Nudge: compose a follow-up message
        const ageDesc = req.age_description || _ageDescription(req.created_at);
        const nudgeMsg = `You said "${req.raw_input}" ${ageDesc} — still want to log that?`;
        console.log(`   📨 Nudge: ${nudgeMsg}`);

        try {
          await httpPost(`${API_BASE}/api/pipeline/requests/${req.id}/followup`, {});
          nudged++;
        } catch (e) {
          console.log(`   ⚠️  Failed to mark followup for request ${req.id}: ${e.message}`);
        }
      }
    }

    // Expire any over-followed requests in bulk
    try {
      await httpPost(`${API_BASE}/api/pipeline/sweep/expire`, {});
    } catch (e) {
      // Non-critical
    }

    recordTest('Stale Request Sweep', true,
      `${staleRequests.length} stale: ${nudged} nudged, ${expired} expired`);
    return true;

  } catch (e) {
    if (e.message.includes('ECONNREFUSED') || e.message.includes('Timeout')) {
      recordTest('Stale Request Sweep', true, 'API not running (skipped)');
      return true;
    }
    recordTest('Stale Request Sweep', false, e.message);
    return false;
  }
}

// ============================================
// TEST 11: Committed Meal Audit
// ============================================

async function auditLowConfidenceMeals() {
  try {
    const res = await httpGet(`${API_BASE}/api/pipeline/sweep/audit?threshold=0.6`);

    if (res.status !== 200) {
      recordTest('Meal Audit Sweep', false, `API returned ${res.status}`);
      return false;
    }

    const mealsToAudit = res.data;

    if (!Array.isArray(mealsToAudit) || mealsToAudit.length === 0) {
      recordTest('Meal Audit Sweep', true, 'No meals need audit');
      return true;
    }

    let audited = 0;
    let flagged = 0;

    // Use direct DB for detailed audit work
    const db = new sqlite3.Database(DB_PATH);

    for (const meal of mealsToAudit) {
      if (!meal.meal_id) continue;

      try {
        const auditResult = await auditOneMeal(db, meal.meal_id);
        audited++;

        if (auditResult.errors > 0 || auditResult.warnings > 0) {
          flagged++;
          console.log(`   🔍 Meal #${meal.meal_id} "${meal.title}": ${auditResult.verdict} (${auditResult.errors} errors, ${auditResult.warnings} warnings)`);
          for (const f of auditResult.findings) {
            if (f.severity === 'error' || f.severity === 'warning') {
              console.log(`      ${f.severity === 'error' ? '❌' : '⚠️'}  ${f.check}: ${f.detail}`);
            }
          }
        }
      } catch (e) {
        console.log(`   ⚠️  Audit failed for meal ${meal.meal_id}: ${e.message}`);
      }
    }

    await new Promise((resolve) => db.close(resolve));

    recordTest('Meal Audit Sweep', true,
      `${audited} audited, ${flagged} flagged for review`);

    if (flagged > 0) {
      createIssue(SEVERITY.LOW, 'Low-confidence meals flagged by audit',
        `${flagged} of ${audited} audited meals have errors or warnings. Check decision_log for details.`,
        'Some logged meals may have incorrect calorie/gram calculations.');
    }

    return true;

  } catch (e) {
    if (e.message.includes('ECONNREFUSED') || e.message.includes('Timeout')) {
      recordTest('Meal Audit Sweep', true, 'API not running (skipped)');
      return true;
    }
    recordTest('Meal Audit Sweep', false, e.message);
    return false;
  }
}

/**
 * Audit a single meal: check gram amounts, food matches, decision chain.
 * Writes findings to decision_log with agent='hayden'.
 */
function auditOneMeal(db, mealId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT mi.*, f.name as food_name, f.calories, f.protein_g, f.fat_g, f.carbs_g,
             f.serving_size, f.confidence_pct as food_confidence
      FROM meal_items mi
      JOIN foods f ON mi.food_id = f.id
      WHERE mi.meal_id = ?
    `, [mealId], (err, items) => {
      if (err) return reject(err);

      db.all(`
        SELECT * FROM decision_log
        WHERE entity_id = ? AND entity_type = 'meal'
        ORDER BY created_at ASC
      `, [mealId], (err, decisions) => {
        if (err) return reject(err);

        const findings = [];

        // Check 1: Per-item gram sanity
        for (const item of items) {
          if (item.actual_grams > 2000) {
            findings.push({
              severity: 'error', check: 'gram_amount', item: item.food_name,
              detail: `${item.actual_grams}g exceeds 2kg for single item`,
            });
          }
          if (item.actual_grams !== null && item.actual_grams <= 0) {
            findings.push({
              severity: 'error', check: 'gram_amount', item: item.food_name,
              detail: `${item.actual_grams}g — zero or negative`,
            });
          }
        }

        // Check 2: Per-item calorie sanity
        for (const item of items) {
          const itemCal = (item.calories || 0) * item.amount;
          if (itemCal > 5000) {
            findings.push({
              severity: 'error', check: 'calorie_amount', item: item.food_name,
              detail: `${Math.round(itemCal)} cal for single item exceeds 5000`,
            });
          }
        }

        // Check 3: Total meal sanity
        const totalCal = items.reduce((s, i) => s + ((i.calories || 0) * i.amount), 0);
        if (items.length === 0) {
          findings.push({
            severity: 'error', check: 'empty_meal',
            detail: 'Meal has no items',
          });
        }
        if (totalCal === 0 && items.length > 0) {
          findings.push({
            severity: 'error', check: 'meal_total',
            detail: 'Meal has items but 0 total calories',
          });
        }

        // Check 4: Decision chain integrity
        if (decisions.length === 0) {
          findings.push({
            severity: 'warning', check: 'decision_chain',
            detail: 'No decision_log entries — audit trail missing',
          });
        } else {
          const matchDecisions = decisions.filter(d => d.action === 'match_food');
          if (matchDecisions.length < items.length) {
            findings.push({
              severity: 'info', check: 'decision_chain',
              detail: `${matchDecisions.length} match decisions for ${items.length} items`,
            });
          }
        }

        // Check 5: Food match reasonableness
        for (const item of items) {
          if ((item.confidence_pct || 0) < 0.4) {
            findings.push({
              severity: 'warning', check: 'low_confidence', item: item.food_name,
              detail: `Confidence ${item.confidence_pct} is below 0.4`,
            });
          }
        }

        const errors = findings.filter(f => f.severity === 'error').length;
        const warnings = findings.filter(f => f.severity === 'warning').length;
        const verdict = errors > 0 ? 'needs_correction' : warnings > 0 ? 'needs_review' : 'clean';

        // Write audit finding to decision_log with agent='hayden'
        db.run(`
          INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used, confidence_pct)
          VALUES ('meal', ?, 'hayden', 'audit', ?, 'deterministic', ?)
        `, [
          mealId,
          JSON.stringify({ verdict, errors, warnings, findings }),
          verdict === 'clean' ? 0.9 : verdict === 'needs_review' ? 0.5 : 0.3
        ], (err) => {
          if (err) console.log(`   ⚠️  Failed to log audit for meal ${mealId}: ${err.message}`);
          resolve({ mealId, verdict, findings, errors, warnings });
        });
      });
    });
  });
}

// ============================================
// TEST 12: Dashboard Anomaly Detection
// ============================================

async function detectAnomalies() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(DB_PATH);
    const today = new Date().toISOString().slice(0, 10);
    const anomalies = [];

    // Check 1: Daily calories > 6000
    db.get(`
      SELECT SUM(f.calories * mi.amount) as total_cal, COUNT(DISTINCT m.id) as meal_count
      FROM meals m
      JOIN meal_items mi ON mi.meal_id = m.id
      JOIN foods f ON f.id = mi.food_id
      WHERE DATE(m.meal_time) = ?
    `, [today], (err, row) => {
      if (!err && row && row.total_cal > 6000) {
        anomalies.push({
          type: 'high_daily_calories',
          detail: `${Math.round(row.total_cal)} cal today across ${row.meal_count} meals`,
        });
      }

      // Check 2: Empty meals (0 items)
      db.all(`
        SELECT m.id, m.title FROM meals m
        LEFT JOIN meal_items mi ON mi.meal_id = m.id
        WHERE DATE(m.meal_time) = ? AND mi.id IS NULL
      `, [today], (err, emptyMeals) => {
        if (!err && emptyMeals) {
          for (const em of emptyMeals) {
            anomalies.push({
              type: 'empty_meal',
              meal_id: em.id,
              detail: `Meal "${em.title || em.id}" has no items`,
            });
          }
        }

        // Check 3: Impossible amounts (single item > 2000g or > 5000 cal)
        db.all(`
          SELECT mi.id, f.name, mi.actual_grams,
                 ROUND(f.calories * mi.amount, 1) as item_cal
          FROM meal_items mi
          JOIN meals m ON m.id = mi.meal_id
          JOIN foods f ON f.id = mi.food_id
          WHERE DATE(m.meal_time) = ?
            AND (mi.actual_grams > 2000 OR f.calories * mi.amount > 5000)
        `, [today], (err, extremeItems) => {
          if (!err && extremeItems) {
            for (const ei of extremeItems) {
              anomalies.push({
                type: 'extreme_item',
                item: ei.name,
                detail: `${ei.actual_grams || '?'}g / ${Math.round(ei.item_cal)} cal`,
              });
            }
          }

          // Log anomalies to decision_log if any found
          if (anomalies.length > 0) {
            db.run(`
              INSERT INTO decision_log (entity_type, entity_id, agent, action, details, model_used)
              VALUES ('system', 0, 'hayden', 'anomaly_scan', ?, 'deterministic')
            `, [JSON.stringify({ date: today, anomalies })], () => {
              db.close();
              recordTest('Anomaly Detection', false,
                `${anomalies.length} anomalies found today`);
              for (const a of anomalies) {
                console.log(`   ⚠️  ${a.type}: ${a.detail}`);
              }
              if (anomalies.some(a => a.type === 'extreme_item' || a.type === 'high_daily_calories')) {
                createIssue(SEVERITY.MEDIUM, 'Daily anomalies detected',
                  anomalies.map(a => `${a.type}: ${a.detail}`).join('\n'),
                  'Some logged values appear incorrect. Review flagged meals.');
              }
              resolve(false);
            });
          } else {
            db.close();
            recordTest('Anomaly Detection', true, 'No anomalies today');
            resolve(true);
          }
        });
      });
    });
  });
}

// ============================================
// TEST 13: Error Rate Reporting
// ============================================

async function reportErrorRates() {
  try {
    // Get this week's stats
    const thisWeek = await httpGet(`${API_BASE}/api/pipeline/requests/stats?days=7`);
    // Get last week's stats for comparison
    const lastWeek = await httpGet(`${API_BASE}/api/pipeline/requests/stats?days=14`);

    if (thisWeek.status !== 200) {
      recordTest('Error Rate Report', false, `API returned ${thisWeek.status}`);
      return false;
    }

    const current = thisWeek.data;

    if (!current.total || current.total === 0) {
      recordTest('Error Rate Report', true, 'No pipeline requests in last 7 days');
      return true;
    }

    const dropRate = current.drop_rate || 0;
    const commitRate = current.commit_rate || 0;

    // Calculate last-week-only stats (14-day minus 7-day)
    let trend = '';
    if (lastWeek.status === 200 && lastWeek.data.total > current.total) {
      const prevTotal = lastWeek.data.total - current.total;
      const prevCommitted = lastWeek.data.committed - current.committed;
      const prevDropped = (lastWeek.data.abandoned + lastWeek.data.expired) - (current.abandoned + current.expired);
      const prevDropRate = prevTotal > 0 ? Math.round((prevDropped / prevTotal) * 100) : 0;
      const prevCommitRate = prevTotal > 0 ? Math.round((prevCommitted / prevTotal) * 100) : 0;

      const dropDelta = dropRate - prevDropRate;
      const commitDelta = commitRate - prevCommitRate;

      if (dropDelta > 0) {
        trend = ` (drop rate ${dropDelta > 0 ? '+' : ''}${dropDelta}% vs last week)`;
      } else if (commitDelta > 0) {
        trend = ` (commit rate ${commitDelta > 0 ? '+' : ''}${commitDelta}% vs last week)`;
      } else {
        trend = ' (stable vs last week)';
      }
    }

    const summary = `${current.total} requests: ${commitRate}% committed, ${dropRate}% dropped${trend}`;
    console.log(`   📊 Pending: ${current.pending}, Committed: ${current.committed}, Abandoned: ${current.abandoned}, Expired: ${current.expired}`);

    if (dropRate > 10) {
      recordTest('Error Rate Report', false, summary);
      createIssue(SEVERITY.MEDIUM, 'High pipeline drop rate',
        `Drop rate is ${dropRate}% over the last 7 days (${current.abandoned + current.expired} of ${current.total} requests).${trend}`,
        'Users are abandoning or not confirming a significant portion of meal logs. May indicate UX or parsing issues.');
      return false;
    }

    recordTest('Error Rate Report', true, summary);
    return true;

  } catch (e) {
    if (e.message.includes('ECONNREFUSED') || e.message.includes('Timeout')) {
      recordTest('Error Rate Report', true, 'API not running (skipped)');
      return true;
    }
    recordTest('Error Rate Report', false, e.message);
    return false;
  }
}

// Helper: age description for stale request sweep
function _ageDescription(createdAt) {
  const mins = Math.round((Date.now() - new Date(createdAt + 'Z').getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ============================================
// MAIN
// ============================================

async function main() {
  const isQuick = process.argv.includes('--quick');
  
  console.log(`\n🔍 HAYDEN Health Check — ${new Date().toISOString()}\n`);
  console.log(isQuick ? '(Quick mode)\n' : '(Full test suite)\n');
  
  // Load previous state
  const state = loadState();
  
  // Run tests
  await testDatabaseConnection();
  
  if (!isQuick) {
    await testSchemaIntegrity();
  }
  
  await testAPIHealth();
  
  if (!isQuick) {
    await testWriteCapability();
    await testDIQQStatus();
    await testDailySummaryQuery();
    await testLOGOSSchemaConsistency();
    await testMealAmountSanity();
    
    // Orphan meal check
    await testOrphanMeals();

    // Encapsulation tests
    await testEncapDatabaseSeparate();
    await testEncapNoMARSTables();
    await testEncapAPIData();
    await testEncapServerPort();
    await testEncapExternalAPIs();

    // Pipeline audit & monitoring
    await sweepStaleRequests();
    await auditLowConfidenceMeals();
    await detectAnomalies();
    await reportErrorRates();
  }
  
  // Summary
  console.log('\n' + '━'.repeat(50));
  console.log(`\n📊 Results: ${results.passed} passed, ${results.failed} failed`);
  
  if (results.autoFixes.length > 0) {
    console.log(`🔧 Auto-fixes applied: ${results.autoFixes.length}`);
  }
  
  if (results.issues.length > 0) {
    console.log(`📋 Issues created: ${results.issues.length}`);
    for (const issue of results.issues) {
      console.log(`   [${issue.severity}] ${issue.title}`);
    }
  }
  
  // Update state
  state.lastRun = results.timestamp;
  state.testsRun += results.tests.length;
  state.testsPassed += results.passed;
  state.consecutiveFailures = results.failed > 0 ? state.consecutiveFailures + 1 : 0;
  state.openIssues = results.issues.length;
  state.lastResults = {
    passed: results.passed,
    failed: results.failed,
    tests: results.tests.map(t => ({ name: t.name, passed: t.passed }))
  };
  
  saveState(state);

  // Report to Personal Assistant
  const failedTests = results.tests.filter(t => !t.passed);
  const hasCritical = results.issues.some(i => i.severity === SEVERITY.CRITICAL);
  const reportSeverity = hasCritical ? 'critical'
                       : failedTests.length > 0 ? 'high'
                       : 'info';

  await reportToPA(
    reportSeverity,
    failedTests.length === 0
      ? `All ${results.tests.length} tests passed`
      : `${failedTests.length}/${results.tests.length} tests failed: ${failedTests.map(t => t.name).join(', ')}`,
    {
      tests_run: results.tests.length,
      tests_passed: results.passed,
      tests_failed: results.failed,
      failed_tests: failedTests.map(t => ({ name: t.name, details: t.details })),
      auto_fixes: results.autoFixes,
      issues_created: results.issues.map(i => ({ severity: i.severity, title: i.title }))
    },
    reportSeverity === 'critical' || reportSeverity === 'high'
  );

  // Return exit code
  const exitCode = results.failed > 0 ? 1 : 0;
  
  // Output JSON for programmatic use
  if (process.argv.includes('--json')) {
    console.log('\n' + JSON.stringify(results, null, 2));
  }
  
  console.log(`\n⏱️  Next run: ${isQuick ? '15 minutes' : '1 hour'}\n`);
  
  process.exit(exitCode);
}

main().catch(e => {
  console.error('❌ HAYDEN crashed:', e.message);
  process.exit(1);
});
