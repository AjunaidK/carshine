// Public website logic
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let SITE = null;
const state = { serviceId: null, date: null, time: null };

const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const money = n => `${SITE.settings.currency || 'Rs'} ${Number(n).toLocaleString('en-PK')}`;
const dur = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m} min`);
const prettyDate = d => { const x = new Date(d + 'T12:00:00'); return `${DAYS[x.getDay()].slice(0, 3)}, ${x.getDate()} ${MONTHS[x.getMonth()]}`; };
function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const waLink = (num, text) => `https://wa.me/${num}?text=${encodeURIComponent(text)}`;

const ICON_CAR = `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h-1a1 1 0 0 1-1-1v-3.5l2-5A2 2 0 0 1 6.9 6h10.2a2 2 0 0 1 1.9 1.5l2 5V16a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5M3 12.5h18"/></svg>`;

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

async function init() {
  SITE = await api('/api/site');
  const s = SITE.settings;

  // theme
  document.documentElement.style.setProperty('--primary', s.primary_color || '#0e7cff');
  document.documentElement.style.setProperty('--accent', s.accent_color || '#ffc21a');
  document.title = `${s.business_name} — Car Wash & Detailing`;

  // header / hero
  $('#brandName').textContent = s.business_name;
  $('#brandMark').innerHTML = s.logo ? `<img src="${esc(s.logo)}" alt="">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12z"/></svg>`;
  $('#tagline').textContent = s.tagline;
  $('#heroTitle').textContent = s.hero_title;
  $('#heroSub').textContent = s.hero_subtitle;
  if (s.hero_image) { const bg = $('#heroBg'); bg.style.backgroundImage = `url("${s.hero_image}")`; bg.classList.add('has-img'); }
  if (s.phone) { const c = $('#heroCall'); c.href = `tel:${s.phone}`; c.hidden = false; c.textContent = `Call ${s.phone}`; }
  if (s.announcement) { const a = $('#announce'); a.textContent = s.announcement; a.hidden = false; }

  const todayH = s.hours[new Date(SITE.today + 'T12:00:00').getDay()];
  $('#todayHours').textContent = todayH && !todayH.closed ? `${fmt12(todayH.open)} – ${fmt12(todayH.close)}` : 'Closed';

  renderOffers(); renderServices(); renderGallery(); renderVisit(); initBooking();

  if (s.whatsapp) { const w = $('#waFloat'); w.href = waLink(s.whatsapp, `Hi ${s.business_name}, I'd like to ask about a service.`); w.hidden = false; }
  $('#year').textContent = new Date().getFullYear();
}

function renderOffers() {
  const list = SITE.offers;
  if (!list.length) { $('#navOffers').hidden = true; return; }
  $('#offers').hidden = false;
  $('#offersList').innerHTML = list.map(o => `
    <article class="offer">
      ${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">` : ''}
      ${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ''}
      <div class="offer-body">
        <h3>${esc(o.title)}</h3>
        <p>${esc(o.description)}</p>
        ${o.valid_until ? `<div class="until">Valid until ${prettyDate(o.valid_until)}</div>` : ''}
        <a href="#book" class="btn btn-accent">Book this offer</a>
      </div>
    </article>`).join('');
}

function renderServices() {
  $('#servicesList').innerHTML = SITE.services.map(v => `
    <article class="card svc">
      <div class="svc-img">${v.image ? `<img src="${esc(v.image)}" alt="${esc(v.name)}" loading="lazy">` : ICON_CAR}</div>
      <div class="svc-body">
        <h3>${esc(v.name)}</h3>
        <p>${esc(v.description)}</p>
        <div class="svc-foot">
          <span class="price">${money(v.price)}<small>~${dur(v.duration_min)}</small></span>
          <button class="btn btn-primary" data-book="${v.id}">Book</button>
        </div>
      </div>
    </article>`).join('');
  document.querySelectorAll('[data-book]').forEach(b => b.addEventListener('click', () => {
    $('#bService').value = b.dataset.book; onServiceChange(); $('#book').scrollIntoView();
  }));
}

function renderGallery() {
  if (!SITE.gallery.length) { $('#navGallery').hidden = true; return; }
  $('#gallery').hidden = false;
  $('#galleryList').innerHTML = SITE.gallery.map(g => `
    <figure data-src="${esc(g.image)}" data-cap="${esc(g.caption)}"><img src="${esc(g.image)}" alt="${esc(g.caption)}" loading="lazy">${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('');
  document.querySelectorAll('.gallery figure').forEach(f => f.addEventListener('click', () => {
    $('#lbImg').src = f.dataset.src; $('#lbCap').textContent = f.dataset.cap; $('#lightbox').hidden = false;
  }));
  $('#lightbox').addEventListener('click', () => ($('#lightbox').hidden = true));
}

function renderVisit() {
  const s = SITE.settings;
  $('#aboutTitle').textContent = s.about_title;
  $('#aboutText').textContent = s.about_text;
  const items = [];
  items.push(`<div><span class="ic">📍</span><span>${esc(s.address)}</span></div>`);
  if (s.phone) items.push(`<a href="tel:${esc(s.phone)}"><span class="ic">📞</span><span>${esc(s.phone)}</span></a>`);
  if (s.whatsapp) items.push(`<a href="${waLink(s.whatsapp, 'Hi!')}" target="_blank" rel="noopener"><span class="ic">💬</span><span>WhatsApp us</span></a>`);
  if (s.email) items.push(`<a href="mailto:${esc(s.email)}"><span class="ic">✉️</span><span>${esc(s.email)}</span></a>`);
  $('#contactList').innerHTML = items.join('');

  const todayIdx = new Date(SITE.today + 'T12:00:00').getDay();
  const order = [1, 2, 3, 4, 5, 6, 0];
  $('#hoursTable').innerHTML = order.map(d => {
    const h = s.hours[d];
    return `<tr class="${d === todayIdx ? 'today' : ''}"><td>${DAYS[d]}</td><td>${h && !h.closed ? `${fmt12(h.open)} – ${fmt12(h.close)}` : 'Closed'}</td></tr>`;
  }).join('');

  $('#map').src = `https://maps.google.com/maps?q=${s.map_lat},${s.map_lng}&z=16&output=embed`;
  $('#directions').href = `https://www.google.com/maps/dir/?api=1&destination=${s.map_lat},${s.map_lng}`;

  $('#footName').textContent = s.business_name; $('#footName2').textContent = s.business_name;
  $('#footAddr').textContent = s.address;
  const soc = [['facebook', 'f'], ['instagram', 'ig'], ['tiktok', 'tt']].filter(([k]) => s[k]);
  $('#socials').innerHTML = soc.map(([k, l]) => `<a href="${esc(s[k])}" target="_blank" rel="noopener" aria-label="${k}">${l}</a>`).join('');
}

// ---------- booking ----------
function initBooking() {
  const s = SITE.settings;
  if (s.booking_enabled !== '1') { $('#bookPaused').hidden = false; $('#bSubmit').disabled = true; }
  $('#bService').innerHTML = `<option value="">Select a service…</option>` + SITE.services.map(v => `<option value="${v.id}">${esc(v.name)} — ${money(v.price)}</option>`).join('');
  $('#bService').addEventListener('change', onServiceChange);

  // date strip
  const days = Number(s.booking_days_ahead) || 14;
  const closed = (s.closed_dates || '').split(',').map(x => x.trim());
  let html = '';
  for (let i = 0; i <= days; i++) {
    const d = addDays(SITE.today, i);
    const wd = new Date(d + 'T12:00:00').getDay();
    const h = s.hours[wd];
    const off = !h || h.closed || closed.includes(d);
    html += `<button type="button" class="date" data-date="${d}" ${off ? 'disabled title="Closed"' : ''}>
      <span>${i === 0 ? 'Today' : DAYS[wd].slice(0, 3)}</span><b>${Number(d.slice(8))}</b><span>${MONTHS[Number(d.slice(5, 7)) - 1]}</span></button>`;
  }
  $('#bDates').innerHTML = html;
  $('#bDates').addEventListener('click', e => {
    const b = e.target.closest('.date'); if (!b || b.disabled) return;
    document.querySelectorAll('.date').forEach(x => x.classList.toggle('on', x === b));
    state.date = b.dataset.date; state.time = null; loadTimes();
  });

  $('#bTimes').addEventListener('click', e => {
    const b = e.target.closest('.time'); if (!b || b.disabled) return;
    document.querySelectorAll('.time').forEach(x => x.classList.toggle('on', x === b));
    state.time = b.dataset.time; updateSummary();
  });

  $('#bookForm').addEventListener('submit', submitBooking);
}

function onServiceChange() {
  state.serviceId = $('#bService').value || null;
  const v = SITE.services.find(x => String(x.id) === state.serviceId);
  $('#bServiceInfo').textContent = v ? `${v.description} · takes about ${dur(v.duration_min)}` : '';
  state.time = null;
  if (state.date) loadTimes();
  updateSummary();
}

async function loadTimes() {
  const box = $('#bTimes');
  if (!state.serviceId) { box.innerHTML = `<p class="hint">Choose a service first.</p>`; return; }
  box.innerHTML = `<p class="hint">Loading times…</p>`;
  try {
    const r = await api(`/api/slots?date=${state.date}&service_id=${state.serviceId}`);
    if (r.closed || !r.slots.length) { box.innerHTML = `<p class="hint">${esc(r.reason || 'No times available on this day.')}</p>`; return; }
    if (!r.slots.some(x => x.available)) { box.innerHTML = `<p class="hint">Fully booked — please try another day.</p>`; return; }
    box.innerHTML = r.slots.map(x => `<button type="button" class="time" data-time="${x.time}" ${x.available ? '' : 'disabled'}>${fmt12(x.time)}</button>`).join('');
  } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  updateSummary();
}

function updateSummary() {
  const v = SITE.services.find(x => String(x.id) === state.serviceId);
  const el = $('#bSummary');
  if (v && state.date && state.time) {
    el.hidden = false;
    el.innerHTML = `<strong>${esc(v.name)}</strong> · ${prettyDate(state.date)} at ${fmt12(state.time)} · <strong>${money(v.price)}</strong>`;
  } else el.hidden = true;
}

async function submitBooking(e) {
  e.preventDefault();
  const err = $('#bError'); err.hidden = true;
  const body = {
    service_id: state.serviceId, date: state.date, time: state.time,
    customer_name: $('#bName').value, phone: $('#bPhone').value, car: $('#bCar').value, plate: $('#bPlate').value, notes: $('#bNotes').value,
  };
  const missing = !body.service_id ? 'a service' : !body.date ? 'a date' : !body.time ? 'a time' : !body.customer_name.trim() ? 'your name' : !body.phone.trim() ? 'your phone number' : null;
  if (missing) { err.textContent = `Please choose ${missing}.`; err.hidden = false; return; }
  const btn = $('#bSubmit'); btn.disabled = true; btn.textContent = 'Booking…';
  try {
    const { appointment: a } = await api('/api/appointments', { method: 'POST', body: JSON.stringify(body) });
    $('#sRef').textContent = a.ref;
    $('#sDetails').textContent = `${a.service_name} · ${prettyDate(a.date)} at ${fmt12(a.time)} · ${money(a.price)}`;
    const s = SITE.settings;
    if (s.whatsapp) {
      const wa = $('#sWa'); wa.hidden = false;
      wa.href = waLink(s.whatsapp, `Hi ${s.business_name}! I just booked online.\nRef: ${a.ref}\n${a.service_name}\n${prettyDate(a.date)} at ${fmt12(a.time)}\nName: ${a.customer_name}`);
    }
    $('#successModal').hidden = false;
    $('#bookForm').reset(); state.time = null; state.serviceId = null; $('#bServiceInfo').textContent = '';
    document.querySelectorAll('.date.on').forEach(x => x.classList.remove('on')); state.date = null;
    $('#bTimes').innerHTML = `<p class="hint">Choose a date to see free times.</p>`; updateSummary();
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    if (state.date) loadTimes();
  } finally { btn.disabled = SITE.settings.booking_enabled !== '1'; btn.textContent = 'Confirm booking'; }
}

// ---------- manage booking ----------
let lastLookup = null;
$('#manageForm').addEventListener('submit', async e => {
  e.preventDefault();
  const out = $('#manageResult');
  lastLookup = { ref: $('#mRef').value.trim(), phone: $('#mPhone').value.trim() };
  try {
    const { appointment: a } = await api('/api/appointments/lookup', { method: 'POST', body: JSON.stringify(lastLookup) });
    const canCancel = ['pending', 'confirmed'].includes(a.status);
    out.innerHTML = `<div class="result">
      <p><strong>${esc(a.ref)}</strong> <span class="status ${a.status}">${a.status}</span></p>
      <p>${esc(a.service_name)} · ${money(a.price)}</p>
      <p>${prettyDate(a.date)} at ${fmt12(a.time)}</p>
      ${canCancel ? `<button class="btn btn-ghost-dark btn-block" id="cancelBtn" style="margin-top:.8rem">Cancel this booking</button>` : ''}
    </div>`;
    const cb = $('#cancelBtn');
    if (cb) cb.addEventListener('click', async () => {
      if (!confirm('Cancel this booking?')) return;
      try { await api('/api/appointments/cancel', { method: 'POST', body: JSON.stringify(lastLookup) }); out.innerHTML = `<div class="result">Your booking has been cancelled.</div>`; }
      catch (ex) { out.innerHTML = `<p class="error">${esc(ex.message)}</p>`; }
    });
  } catch (ex) { out.innerHTML = `<p class="error" style="margin-top:1rem">${esc(ex.message)}</p>`; }
});

// ---------- modals & nav ----------
document.querySelectorAll('[data-open="manage"]').forEach(b => b.addEventListener('click', () => { $('#links').classList.remove('open'); $('#manageModal').hidden = false; }));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; }));
$('#burger').addEventListener('click', () => $('#links').classList.toggle('open'));
$('#links').addEventListener('click', e => { if (e.target.tagName === 'A') $('#links').classList.remove('open'); });

init().catch(e => { console.error(e); document.body.insertAdjacentHTML('afterbegin', `<p class="error">Could not load the site. Please refresh.</p>`); });
