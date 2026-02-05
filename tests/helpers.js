/**
 * E2E Test Helpers — Server boot, DB setup, HTTP utilities
 */
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SERVER_PATH = path.join(__dirname, '..', 'web', 'server.js');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Start a test server on a random port with a fresh temp database.
 * Returns { baseUrl, db, cleanup, port }
 */
async function startServer() {
  const tmpDb = path.join(__dirname, `fuel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

  // Create fresh DB from schema + migrations
  const db = new Database(tmpDb);
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  if (fs.existsSync(MIGRATIONS_DIR)) {
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    for (const file of migrationFiles) {
      try {
        db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      } catch (e) {
        // Already applied
      }
    }
  }

  // Ensure default settings row
  db.prepare(`INSERT OR IGNORE INTO user_settings (id, weight_kg, height_cm, age, sex) VALUES (1, 70, 170, 30, 'female')`).run();

  // Find a free port by binding to 0
  const net = require('net');
  const port = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  // Fork server as child process
  const child = fork(SERVER_PATH, [], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: tmpDb,
      USER_TIMEZONE: 'UTC',
      NODE_ENV: 'test',
      // No ACCESS_TOKEN — bypass auth
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    silent: true,
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    child.stdout.on('data', (data) => {
      if (data.toString().includes('FUEL v3 running')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (data) => {
      // Ignore stderr noise
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null) reject(new Error(`Server exited with code ${code}`));
    });
  });

  const cleanup = () => {
    try { child.kill('SIGTERM'); } catch (e) {}
    try { db.close(); } catch (e) {}
    try { fs.unlinkSync(tmpDb); } catch (e) {}
    try { fs.unlinkSync(tmpDb + '-wal'); } catch (e) {}
    try { fs.unlinkSync(tmpDb + '-shm'); } catch (e) {}
  };

  return { baseUrl, db, cleanup, port, child, tmpDb };
}

/**
 * HTTP helper — wraps fetch with JSON defaults
 */
async function api(baseUrl, method, urlPath, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${urlPath}`, opts);
  let data;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

/**
 * Seed a food directly into the DB, returns the food row
 */
function seedFood(db, overrides = {}) {
  const defaults = {
    name: 'Test Chicken Breast',
    serving_unit: 'g',
    calories: 165,
    protein_g: 31,
    fat_g: 3.6,
    carbs_g: 0,
    fiber_g: 0,
    sugar_g: 0,
  };
  const food = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO foods (name, serving_unit, calories, protein_g, fat_g, carbs_g, fiber_g, sugar_g)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(food.name, food.serving_unit, food.calories, food.protein_g, food.fat_g, food.carbs_g, food.fiber_g, food.sugar_g);
  return db.prepare('SELECT * FROM foods WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Log a test meal via the API, returns the meal response
 */
async function seedMeal(baseUrl, foodId, overrides = {}) {
  const defaults = {
    meal_type: 'lunch',
    meal_time: '2026-02-05 12:00:00',
    title: 'Test Meal',
    items: [{ food_id: foodId, amount: 1.5 }],
  };
  const body = { ...defaults, ...overrides };
  const { data } = await api(baseUrl, 'POST', '/api/meals', body);
  return data;
}

module.exports = { startServer, api, seedFood, seedMeal };
