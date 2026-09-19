const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// In-memory DB. Swap ':memory:' for a file path (e.g. './sahayak.db') to persist data.
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run(`PRAGMA foreign_keys = ON`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('senior_citizen', 'volunteer', 'police_admin')),
    name TEXT,
    phone_number TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS volunteers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    organisation_id TEXT,
    status TEXT DEFAULT 'registered' CHECK(status IN ('registered', 'under_review', 'verified', 'active', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS assistance_requests (
    id TEXT PRIMARY KEY,
    senior_citizen_id TEXT NOT NULL,
    assigned_volunteer_id TEXT,
    location TEXT NOT NULL,
    need TEXT NOT NULL,
    priority TEXT DEFAULT 'routine' CHECK(priority IN ('routine', 'urgent')),
    is_emergency BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'assigned', 'in_progress', 'completed', 'escalated', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS emergency_escalations (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    notified_112 BOOLEAN DEFAULT 1,
    status TEXT DEFAULT 'escalated' CHECK(status IN ('escalated', 'closed')),
    closed_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    FOREIGN KEY (request_id) REFERENCES assistance_requests(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS verification_records (
    id TEXT PRIMARY KEY,
    volunteer_id TEXT NOT NULL,
    reviewed_by TEXT,
    notes TEXT,
    decision TEXT DEFAULT 'pending' CHECK(decision IN ('pending', 'approved', 'rejected')),
    decided_at DATETIME,
    FOREIGN KEY (volunteer_id) REFERENCES volunteers(id)
  )`);

  // Seed a default police admin so /api/auth/login works immediately.
  const adminPhone = process.env.ADMIN_SEED_PHONE || '9900000000';
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'police123';
  const adminHash = bcrypt.hashSync(adminPassword, 12);

  db.run(
    `INSERT OR IGNORE INTO users (id, role, name, phone_number, password_hash) VALUES (?, ?, ?, ?, ?)`,
    ['usr-admin', 'police_admin', 'Default Admin', adminPhone, adminHash],
    (err) => {
      if (err) console.error('Failed to seed admin user:', err.message);
      else console.log(`Seeded police_admin user (phone: ${adminPhone})`);
    }
  );
});

module.exports = db;
