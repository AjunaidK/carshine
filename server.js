// Car Shine Service Station — website + booking + admin panel
// Run: npm start   (then open http://localhost:3000 and http://localhost:3000/admin)
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, getSettings, saveSettings } = require('./db');

const PORT = process.env.PORT || 3000;
const TZ = process.env.BUSINESS_TZ || 'Asia/Karachi';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// JWT secret: from env, or generated once and kept in data/secret.key
const SECRET_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'secret.key');
const JWT_SECRET = process.env.JWT_SECRET || (fs.existsSync(SECRET_FILE)
  ? fs.readFileSync(SECRET_FILE, 'utf8')
  : (() => { const s = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(SECRET_FILE, s); return s; })());

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---------- helpers ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype)),
});

function removeUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const p = path.join(UPLOAD_DIR, path.basename(url));
  fs.promises.unlink(p).catch(() => {});
}

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Current date/time at the business (not the server's timezone)
function nowLocal() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
const weekday = dateStr => new Date(dateStr + 'T12:00:00Z').getUTCDay();
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00Z'));

// Returns [{time, available}] for a date and service duration.
// A booking holds a bay for the service's duration; a slot is free if fewer than `bays` cars overlap it.
function computeSlots(date, durationMin, { ignoreId = null, allowPast = false } = {}) {
  const s = getSettings();
  const now = nowLocal();
  const maxDate = addDays(now.date, Number(s.booking_days_ahead) || 14);
  if (!allowPast && (date < now.date || date > maxDate)) return { closed: true, reason: 'Date is outside the booking window', slots: [] };
  const closedDates = (s.closed_dates || '').split(',').map(x => x.trim()).filter(Boolean);
  if (closedDates.includes(date)) return { closed: true, reason: 'Closed on this date', slots: [] };
  const h = s.hours[weekday(date)];
  if (!h || h.closed) return { closed: true, reason: 'Closed on this day', slots: [] };

  const step = Math.max(10, Number(s.slot_minutes) || 30);
  const bays = Math.max(1, Number(s.bays) || 1);
  const open = toMin(h.open), close = toMin(h.close);
  const dur = Math.max(step, Number(durationMin) || step);

  const appts = db.prepare(`SELECT id, time, duration_min FROM appointments WHERE date = ? AND status != 'cancelled'`).all(date)
    .filter(a => a.id !== ignoreId)
    .map(a => ({ start: toMin(a.time), end: toMin(a.time) + (a.duration_min || step) }));

  const slots = [];
  for (let t = open; t + Math.min(dur, close - open) <= close && t < close; t += step) {
    let available = true;
    if (!allowPast && date === now.date && t <= now.minutes + 15) available = false;
    if (available) {
      const end = t + dur;
      // check concurrency at the start and at every booking start inside [t, end)
      const points = [t, ...appts.filter(a => a.start > t && a.start < end).map(a => a.start)];
      for (const p of points) {
        const overlap = appts.filter(a => a.start <= p && a.end > p).length;
        if (overlap >= bays) { available = false; break; }
      }
    }
    slots.push({ time: toHHMM(t), available });
  }
  return { closed: false, slots };
}

function makeRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r;
  do { r = 'CS-' + Array.from(crypto.randomBytes(5)).map(b => chars[b % chars.length]).join(''); }
  while (db.prepare('SELECT 1 FROM appointments WHERE ref = ?').get(r));
  return r;
}
const cleanPhone = p => String(p || '').replace(/[^\d+]/g, '');
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

// Tiny in-memory rate limiter
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}

const PUBLIC_SETTING_KEYS = ['business_name', 'tagline', 'hero_title', 'hero_subtitle', 'hero_image', 'logo', 'about_title', 'about_text',
  'phone', 'whatsapp', 'email', 'address', 'map_lat', 'map_lng', 'facebook', 'instagram', 'tiktok', 'primary_color', 'accent_color',
  'currency', 'hours', 'booking_days_ahead', 'announcement', 'booking_enabled', 'closed_dates'];

// ---------- public API ----------
app.get('/api/site', (req, res) => {
  const s = getSettings();
  const pub = {}; PUBLIC_SETTING_KEYS.forEach(k => (pub[k] = s[k]));
  const today = nowLocal().date;
  res.json({
    settings: pub,
    today,
    services: db.prepare('SELECT id, name, description, price, duration_min, image FROM services WHERE active = 1 ORDER BY sort, id').all(),
    offers: db.prepare(`SELECT id, title, description, badge, image, valid_until FROM offers WHERE active = 1 AND (valid_until = '' OR valid_until >= ?) ORDER BY id DESC`).all(today),
    gallery: db.prepare('SELECT id, image, caption FROM gallery ORDER BY id DESC').all(),
  });
});

app.get('/api/slots', (req, res) => {
  const { date, service_id } = req.query;
  if (!validDate(date)) return res.status(400).json({ error: 'Invalid date' });
  const svc = db.prepare('SELECT duration_min FROM services WHERE id = ? AND active = 1').get(service_id);
  res.json(computeSlots(date, svc ? svc.duration_min : 30));
});

app.post('/api/appointments', (req, res) => {
  if (rateLimit('book:' + req.ip, 8, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many bookings from this device. Please call us instead.' });
  const s = getSettings();
  if (s.booking_enabled !== '1') return res.status(403).json({ error: 'Online booking is currently paused. Please call us.' });
  const b = req.body || {};
  const name = str(b.customer_name, 80), phone = cleanPhone(b.phone);
  if (!name || phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter your name and a valid phone number.' });
  if (!validDate(b.date) || !/^\d{2}:\d{2}$/.test(b.time || '')) return res.status(400).json({ error: 'Please pick a date and time.' });
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(b.service_id);
  if (!svc) return res.status(400).json({ error: 'Please pick a service.' });

  // Check + insert in one transaction so two people can't grab the last bay at once
  const result = db.transaction(() => {
    const { slots } = computeSlots(b.date, svc.duration_min);
    const slot = slots.find(x => x.time === b.time);
    if (!slot || !slot.available) return null;
    const ref = makeRef();
    db.prepare(`INSERT INTO appointments (ref, customer_name, phone, car, plate, service_id, service_name, price, duration_min, date, time, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(ref, name, phone, str(b.car, 80), str(b.plate, 20).toUpperCase(), svc.id, svc.name, svc.price,
      svc.duration_min, b.date, b.time, str(b.notes, 500));
    return ref;
  })();
  if (!result) return res.status(409).json({ error: 'Sorry, that time was just taken. Please pick another.' });
  res.json({ ok: true, appointment: db.prepare('SELECT ref, customer_name, service_name, price, date, time, status FROM appointments WHERE ref = ?').get(result) });
});

app.post('/api/appointments/lookup', (req, res) => {
  if (rateLimit('lookup:' + req.ip, 20, 15 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts, try later.' });
  const ref = str(req.body.ref, 20).toUpperCase(), phone = cleanPhone(req.body.phone);
  const a = db.prepare('SELECT ref, customer_name, phone, service_name, price, date, time, status FROM appointments WHERE ref = ?').get(ref);
  if (!a || a.phone.replace(/\D/g, '').slice(-10) !== phone.replace(/\D/g, '').slice(-10)) return res.status(404).json({ error: 'No booking found with that reference and phone number.' });
  delete a.phone;
  res.json({ appointment: a });
});

app.post('/api/appointments/cancel', (req, res) => {
  if (rateLimit('lookup:' + req.ip, 20, 15 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts, try later.' });
  const ref = str(req.body.ref, 20).toUpperCase(), phone = cleanPhone(req.body.phone);
  const a = db.prepare('SELECT id, phone, status FROM appointments WHERE ref = ?').get(ref);
  if (!a || a.phone.replace(/\D/g, '').slice(-10) !== phone.replace(/\D/g, '').slice(-10)) return res.status(404).json({ error: 'Booking not found.' });
  if (['completed', 'cancelled'].includes(a.status)) return res.status(400).json({ error: 'This booking can no longer be cancelled.' });
  db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(a.id);
  res.json({ ok: true });
});

// ---------- admin auth ----------
function requireAdmin(req, res, next) {
  try {
    req.admin = jwt.verify(req.cookies.cs_admin || '', JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Not logged in' }); }
}
const cookieOpts = req => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 24 * 3600 * 1000 });

app.post('/api/admin/login', (req, res) => {
  if (rateLimit('login:' + req.ip, 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM admins WHERE username = ?').get(str(username, 50));
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Wrong username or password' });
  res.cookie('cs_admin', jwt.sign({ id: u.id, username: u.username }, JWT_SECRET, { expiresIn: '7d' }), cookieOpts(req));
  res.json({ ok: true, username: u.username });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('cs_admin'); res.json({ ok: true }); });
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ username: req.admin.username }));

app.post('/api/admin/account', requireAdmin, (req, res) => {
  const { current_password, new_username, new_password } = req.body || {};
  const u = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!u || !bcrypt.compareSync(String(current_password || ''), u.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (new_password && String(new_password).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const username = str(new_username, 50) || u.username;
  const hash = new_password ? bcrypt.hashSync(String(new_password), 10) : u.password_hash;
  db.prepare('UPDATE admins SET username = ?, password_hash = ? WHERE id = ?').run(username, hash, u.id);
  res.cookie('cs_admin', jwt.sign({ id: u.id, username }, JWT_SECRET, { expiresIn: '7d' }), cookieOpts(req));
  res.json({ ok: true });
});

// ---------- admin: dashboard & appointments ----------
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const today = nowLocal().date;
  const weekStart = addDays(today, -6);
  const monthStart = today.slice(0, 8) + '01';
  const q = (sql, ...p) => db.prepare(sql).get(...p);
  res.json({
    today,
    today_total: q(`SELECT COUNT(*) c FROM appointments WHERE date = ? AND status != 'cancelled'`, today).c,
    pending: q(`SELECT COUNT(*) c FROM appointments WHERE status = 'pending' AND date >= ?`, today).c,
    upcoming: q(`SELECT COUNT(*) c FROM appointments WHERE date > ? AND status IN ('pending','confirmed')`, today).c,
    week_completed: q(`SELECT COUNT(*) c FROM appointments WHERE status = 'completed' AND date BETWEEN ? AND ?`, weekStart, today).c,
    month_revenue: q(`SELECT COALESCE(SUM(price),0) s FROM appointments WHERE status = 'completed' AND date BETWEEN ? AND ?`, monthStart, today).s,
    top_services: db.prepare(`SELECT service_name name, COUNT(*) c FROM appointments WHERE status != 'cancelled' AND date >= ? GROUP BY service_name ORDER BY c DESC LIMIT 5`).all(addDays(today, -30)),
  });
});

app.get('/api/admin/appointments', requireAdmin, (req, res) => {
  const { from, to, status, q } = req.query;
  const where = [], p = [];
  if (validDate(from)) { where.push('date >= ?'); p.push(from); }
  if (validDate(to)) { where.push('date <= ?'); p.push(to); }
  if (status && status !== 'all') { where.push('status = ?'); p.push(status); }
  if (q) { where.push('(customer_name LIKE ? OR phone LIKE ? OR ref LIKE ? OR plate LIKE ? OR car LIKE ?)'); const l = `%${q}%`; p.push(l, l, l, l, l); }
  const sql = `SELECT * FROM appointments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date, time LIMIT 1000`;
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/admin/appointments.csv', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT ref, date, time, customer_name, phone, car, plate, service_name, price, status, notes, created_at FROM appointments ORDER BY date DESC, time DESC').all();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = Object.keys(rows[0] || { ref: 0, date: 0, time: 0, customer_name: 0, phone: 0, car: 0, plate: 0, service_name: 0, price: 0, status: 0, notes: 0, created_at: 0 });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="appointments.csv"');
  res.send([head.join(','), ...rows.map(r => head.map(h => esc(r[h])).join(','))].join('\n'));
});

// Admin slot view (ignores booking window so admin can book walk-ins / reschedule)
app.get('/api/admin/slots', requireAdmin, (req, res) => {
  const { date, service_id, ignore_id } = req.query;
  if (!validDate(date)) return res.status(400).json({ error: 'Invalid date' });
  const svc = db.prepare('SELECT duration_min FROM services WHERE id = ?').get(service_id);
  res.json(computeSlots(date, svc ? svc.duration_min : 30, { ignoreId: Number(ignore_id) || null, allowPast: true }));
});

app.post('/api/admin/appointments', requireAdmin, (req, res) => {
  const b = req.body || {};
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(b.service_id);
  if (!svc || !str(b.customer_name) || !validDate(b.date) || !/^\d{2}:\d{2}$/.test(b.time || '')) return res.status(400).json({ error: 'Name, service, date and time are required' });
  const ref = makeRef();
  db.prepare(`INSERT INTO appointments (ref, customer_name, phone, car, plate, service_id, service_name, price, duration_min, date, time, notes, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ref, str(b.customer_name, 80), cleanPhone(b.phone), str(b.car, 80), str(b.plate, 20).toUpperCase(),
    svc.id, svc.name, b.price !== undefined && b.price !== '' ? Number(b.price) : svc.price, svc.duration_min, b.date, b.time, str(b.notes), b.status || 'confirmed');
  res.json({ ok: true, ref });
});

app.patch('/api/admin/appointments/:id', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const next = { ...a };
  if (b.status && ['pending', 'confirmed', 'completed', 'cancelled'].includes(b.status)) next.status = b.status;
  ['customer_name', 'car', 'notes'].forEach(k => { if (b[k] !== undefined) next[k] = str(b[k]); });
  if (b.plate !== undefined) next.plate = str(b.plate, 20).toUpperCase();
  if (b.phone !== undefined) next.phone = cleanPhone(b.phone);
  if (b.price !== undefined && b.price !== '') next.price = Number(b.price) || 0;
  if (b.service_id !== undefined && Number(b.service_id) !== a.service_id) {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(b.service_id);
    if (svc) Object.assign(next, { service_id: svc.id, service_name: svc.name, duration_min: svc.duration_min, price: b.price !== undefined && b.price !== '' ? next.price : svc.price });
  }
  if (validDate(b.date)) next.date = b.date;
  if (/^\d{2}:\d{2}$/.test(b.time || '')) next.time = b.time;
  db.prepare(`UPDATE appointments SET customer_name=?, phone=?, car=?, plate=?, service_id=?, service_name=?, price=?, duration_min=?, date=?, time=?, notes=?, status=? WHERE id=?`)
    .run(next.customer_name, next.phone, next.car, next.plate, next.service_id, next.service_name, next.price, next.duration_min, next.date, next.time, next.notes, next.status, a.id);
  res.json({ ok: true });
});

app.delete('/api/admin/appointments/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: services ----------
app.get('/api/admin/services', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM services ORDER BY sort, id').all()));

function serviceFields(b) {
  return [str(b.name, 80), str(b.description, 500), Number(b.price) || 0, Math.max(10, Number(b.duration_min) || 30), b.active === '0' || b.active === false ? 0 : 1, Number(b.sort) || 0];
}
app.post('/api/admin/services', requireAdmin, upload.single('image'), (req, res) => {
  const f = serviceFields(req.body);
  if (!f[0]) return res.status(400).json({ error: 'Name is required' });
  db.prepare('INSERT INTO services (name, description, price, duration_min, active, sort, image) VALUES (?,?,?,?,?,?,?)')
    .run(...f, req.file ? '/uploads/' + req.file.filename : '');
  res.json({ ok: true });
});
app.put('/api/admin/services/:id', requireAdmin, upload.single('image'), (req, res) => {
  const old = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const f = serviceFields(req.body);
  if (!f[0]) return res.status(400).json({ error: 'Name is required' });
  let image = old.image;
  if (req.file) { removeUpload(old.image); image = '/uploads/' + req.file.filename; }
  else if (req.body.remove_image === '1') { removeUpload(old.image); image = ''; }
  db.prepare('UPDATE services SET name=?, description=?, price=?, duration_min=?, active=?, sort=?, image=? WHERE id=?').run(...f, image, old.id);
  res.json({ ok: true });
});
app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT image FROM services WHERE id = ?').get(req.params.id);
  if (old) removeUpload(old.image);
  db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: offers ----------
app.get('/api/admin/offers', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM offers ORDER BY id DESC').all()));
function offerFields(b) {
  return [str(b.title, 120), str(b.description, 800), str(b.badge, 30), validDate(b.valid_until) ? b.valid_until : '', b.active === '0' ? 0 : 1];
}
app.post('/api/admin/offers', requireAdmin, upload.single('image'), (req, res) => {
  const f = offerFields(req.body);
  if (!f[0]) return res.status(400).json({ error: 'Title is required' });
  db.prepare('INSERT INTO offers (title, description, badge, valid_until, active, image) VALUES (?,?,?,?,?,?)').run(...f, req.file ? '/uploads/' + req.file.filename : '');
  res.json({ ok: true });
});
app.put('/api/admin/offers/:id', requireAdmin, upload.single('image'), (req, res) => {
  const old = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const f = offerFields(req.body);
  if (!f[0]) return res.status(400).json({ error: 'Title is required' });
  let image = old.image;
  if (req.file) { removeUpload(old.image); image = '/uploads/' + req.file.filename; }
  else if (req.body.remove_image === '1') { removeUpload(old.image); image = ''; }
  db.prepare('UPDATE offers SET title=?, description=?, badge=?, valid_until=?, active=?, image=? WHERE id=?').run(...f, image, old.id);
  res.json({ ok: true });
});
app.delete('/api/admin/offers/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT image FROM offers WHERE id = ?').get(req.params.id);
  if (old) removeUpload(old.image);
  db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: gallery ----------
app.get('/api/admin/gallery', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM gallery ORDER BY id DESC').all()));
app.post('/api/admin/gallery', requireAdmin, upload.array('images', 20), (req, res) => {
  const ins = db.prepare('INSERT INTO gallery (image, caption) VALUES (?, ?)');
  (req.files || []).forEach(f => ins.run('/uploads/' + f.filename, str(req.body.caption, 150)));
  res.json({ ok: true, added: (req.files || []).length });
});
app.patch('/api/admin/gallery/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE gallery SET caption = ? WHERE id = ?').run(str(req.body.caption, 150), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/gallery/:id', requireAdmin, (req, res) => {
  const g = db.prepare('SELECT image FROM gallery WHERE id = ?').get(req.params.id);
  if (g) removeUpload(g.image);
  db.prepare('DELETE FROM gallery WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: settings ----------
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(getSettings()));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const b = { ...(req.body || {}) };
  delete b.hero_image; delete b.logo; // images go through the upload endpoint
  if (b.hours) {
    const h = {};
    for (let d = 0; d < 7; d++) {
      const x = b.hours[d] || {};
      h[d] = { open: /^\d{2}:\d{2}$/.test(x.open) ? x.open : '08:00', close: /^\d{2}:\d{2}$/.test(x.close) ? x.close : '19:00', closed: !!x.closed };
    }
    b.hours = h;
  }
  if (b.whatsapp !== undefined) b.whatsapp = String(b.whatsapp).replace(/\D/g, '');
  saveSettings(b);
  res.json({ ok: true });
});
app.post('/api/admin/settings/image/:key', requireAdmin, upload.single('image'), (req, res) => {
  const key = req.params.key;
  if (!['hero_image', 'logo'].includes(key)) return res.status(400).json({ error: 'Bad key' });
  const s = getSettings();
  if (req.body.remove === '1') { removeUpload(s[key]); saveSettings({ [key]: '' }); return res.json({ ok: true, url: '' }); }
  if (!req.file) return res.status(400).json({ error: 'Please choose an image (JPG, PNG or WEBP, max 8MB)' });
  removeUpload(s[key]);
  const url = '/uploads/' + req.file.filename;
  saveSettings({ [key]: url });
  res.json({ ok: true, url });
});

// ---------- pages ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 8MB)' : 'Server error' });
});

app.listen(PORT, () => console.log(`Car Shine running → http://localhost:${PORT}  (admin: /admin)`));
