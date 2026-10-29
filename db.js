// Database setup: SQLite file stored in ./data/carshine.db
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'carshine.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER DEFAULT 0,
  duration_min INTEGER DEFAULT 30,
  image TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  badge TEXT DEFAULT '',
  image TEXT DEFAULT '',
  valid_until TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  car TEXT DEFAULT '',
  plate TEXT DEFAULT '',
  service_id INTEGER,
  service_name TEXT DEFAULT '',
  price INTEGER DEFAULT 0,
  duration_min INTEGER DEFAULT 30,
  date TEXT NOT NULL,        -- YYYY-MM-DD
  time TEXT NOT NULL,        -- HH:MM
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'pending', -- pending | confirmed | completed | cancelled
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, time);
`);

// Default settings (pre-filled with the business's public details)
const DEFAULT_SETTINGS = {
  business_name: 'Car Shine Service Station',
  tagline: 'Wash • Detailing • Oil Change',
  hero_title: 'Your car deserves to shine.',
  hero_subtitle: 'Professional car wash, detailing and quick oil change at Motorway Junction, Peshawar. Book online and skip the wait.',
  hero_image: '',
  logo: '',
  about_title: 'Why drivers choose Car Shine',
  about_text: 'We are a local service station on the Northern Bypass at Motorway Junction. Our team treats every car with care — quality work, fast delivery and reasonable rates.',
  phone: '',
  whatsapp: '', // international format, digits only e.g. 923001234567
  email: '',
  address: 'Service Road Northern Bypass, Motorway Junction, Overseas Pakistan Foundation Colony, Peshawar',
  map_lat: '34.0284143',
  map_lng: '71.6440857',
  facebook: '',
  instagram: '',
  tiktok: '',
  primary_color: '#0e7cff',
  accent_color: '#ffc21a',
  currency: 'Rs',
  // hours: JSON per weekday 0=Sun..6=Sat. closed=true to close the day
  hours: JSON.stringify({
    0: { open: '08:00', close: '19:00', closed: false },
    1: { open: '08:00', close: '19:00', closed: false },
    2: { open: '08:00', close: '19:00', closed: false },
    3: { open: '08:00', close: '19:00', closed: false },
    4: { open: '08:00', close: '19:00', closed: false },
    5: { open: '08:00', close: '12:00', closed: false },
    6: { open: '08:00', close: '19:00', closed: false },
  }),
  slot_minutes: '30',      // spacing between bookable times
  bays: '2',               // how many cars can be booked in the same slot
  booking_days_ahead: '14',
  closed_dates: '',        // comma separated YYYY-MM-DD (holidays)
  announcement: '',        // thin banner at top of site, blank = hidden
  booking_enabled: '1',
};

const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

// Seed services on first run
if (db.prepare('SELECT COUNT(*) c FROM services').get().c === 0) {
  const ins = db.prepare('INSERT INTO services (name, description, price, duration_min, sort) VALUES (?,?,?,?,?)');
  [
    ['Exterior Wash', 'Foam wash, rinse, hand dry and tyre shine.', 500, 30, 1],
    ['Full Wash (In & Out)', 'Exterior wash plus interior vacuum, dashboard and glass cleaning.', 900, 45, 2],
    ['Engine Wash', 'Safe degreasing and cleaning of the engine bay.', 700, 30, 3],
    ['Oil Change', 'Engine oil and filter change. Price is labour — oil charged separately.', 300, 30, 4],
    ['Full Detailing', 'Deep interior clean, seat shampoo, polish and wax.', 6000, 240, 5],
    ['Polish & Wax', 'Machine polish and wax for a deep gloss and protection.', 2500, 120, 6],
  ].forEach(r => ins.run(...r));
}

// Default admin on first run
if (db.prepare('SELECT COUNT(*) c FROM admins').get().c === 0) {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASSWORD || 'changeme123';
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(user, bcrypt.hashSync(pass, 10));
  console.log(`\n  Admin account created → username: ${user}  password: ${pass}\n  Change it in Admin → Settings → Account after logging in.\n`);
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => (s[r.key] = r.value));
  try { s.hours = JSON.parse(s.hours); } catch { s.hours = JSON.parse(DEFAULT_SETTINGS.hours); }
  return s;
}

function saveSettings(obj) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(o => {
    for (const [k, v] of Object.entries(o)) {
      if (!(k in DEFAULT_SETTINGS)) continue; // only known keys
      up.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
    }
  });
  tx(obj);
}

module.exports = { db, getSettings, saveSettings, DEFAULT_SETTINGS };
