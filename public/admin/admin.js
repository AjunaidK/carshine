// Admin panel logic
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const pDate = d => { const x = new Date(d + 'T12:00:00'); return `${DAYS[x.getDay()].slice(0, 3)} ${x.getDate()} ${MON[x.getMonth()]}`; };
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
let CUR = 'Rs', TODAY = new Date().toISOString().slice(0, 10), SERVICES = [], BIZ = 'Car Shine';
const money = n => `${CUR} ${Number(n || 0).toLocaleString('en-PK')}`;

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch(url, { ...opts, headers: isForm ? {} : { 'Content-Type': 'application/json' }, body: isForm ? opts.body : opts.body && JSON.stringify(opts.body) });
  if (r.status === 401 && !url.includes('/login')) { showLogin(); throw new Error('Please log in'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
let toastT;
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; return $('#modalBody'); }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

// ---------- auth ----------
function showLogin() { $('#appView').hidden = true; $('#loginView').hidden = false; }
async function boot() {
  try { await api('/api/admin/me'); } catch { return showLogin(); }
  $('#loginView').hidden = true; $('#appView').hidden = false;
  const site = await api('/api/site');
  CUR = site.settings.currency || 'Rs'; TODAY = site.today; BIZ = site.settings.business_name;
  document.documentElement.style.setProperty('--p', site.settings.primary_color || '#0e7cff');
  SERVICES = await api('/api/admin/services');
  go(location.hash.slice(1) || 'dashboard');
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#lErr').hidden = true;
  try { await api('/api/admin/login', { method: 'POST', body: { username: $('#lUser').value, password: $('#lPass').value } }); boot(); }
  catch (ex) { $('#lErr').textContent = ex.message; $('#lErr').hidden = false; }
});
$('#logoutBtn').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); showLogin(); });

// ---------- navigation ----------
const TITLES = { dashboard: 'Dashboard', appointments: 'Appointments', services: 'Services & prices', offers: 'Offers', gallery: 'Gallery', settings: 'Website settings' };
function go(view) {
  if (!TITLES[view]) view = 'dashboard';
  location.hash = view;
  $$('.side nav a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  $$('.view').forEach(v => (v.hidden = v.id !== 'v-' + view));
  $('#viewTitle').textContent = TITLES[view];
  $('#side').classList.remove('open');
  const ta = $('#topActions'); ta.innerHTML = '';
  ({ dashboard: loadDashboard, appointments: loadAppointments, services: loadServices, offers: loadOffers, gallery: loadGallery, settings: loadSettings })[view]();
}
$$('.side nav a').forEach(a => a.addEventListener('click', () => go(a.dataset.view)));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });
$('#burger').addEventListener('click', () => $('#side').classList.toggle('open'));

function topBtn(label, fn, cls = 'primary') { if (topBtn.reset) { $('#topActions').innerHTML = ''; topBtn.reset = false; } const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; $('#topActions').append(b); }

// ---------- dashboard ----------
async function loadDashboard() {
  topBtn.reset = true;
  topBtn('+ New booking', () => apptForm());
  const s = await api('/api/admin/stats');
  $('#pendingPill').hidden = !s.pending; $('#pendingPill').textContent = s.pending;
  $('#stats').innerHTML = [
    ['Today', s.today_total], ['Awaiting confirmation', s.pending], ['Upcoming', s.upcoming],
    ['Completed (7 days)', s.week_completed], ['Revenue this month', money(s.month_revenue)],
  ].map(([l, v]) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`).join('');
  const list = await api(`/api/admin/appointments?from=${TODAY}&to=${TODAY}`);
  $('#todayList').innerHTML = list.length ? list.map(apptRow).join('') : `<div class="empty">No bookings today yet.</div>`;
  bindApptRows($('#todayList'), loadDashboard);
  const max = Math.max(1, ...s.top_services.map(x => x.c));
  $('#topServices').innerHTML = s.top_services.length ? s.top_services.map(x => `<div class="bar"><span class="n">${esc(x.name)}</span><span class="t"><i style="width:${(x.c / max) * 100}%"></i></span><b>${x.c}</b></div>`).join('') : `<div class="empty">No data yet.</div>`;
}

// ---------- appointments ----------
const af = { range: 'today', date: '', status: 'all', q: '' };
function apptRow(a) {
  const phone = a.phone.replace(/\D/g, '');
  const intl = phone.startsWith('0') ? '92' + phone.slice(1) : phone;
  return `<div class="appt" data-id="${a.id}">
    <div class="when"><b>${fmt12(a.time)}</b><span>${pDate(a.date)}</span></div>
    <div class="who"><b>${esc(a.customer_name)}</b> <span class="status ${a.status}">${a.status}</span>
      <div>${esc(a.service_name)} · ${money(a.price)}${a.car ? ' · ' + esc(a.car) : ''}${a.plate ? ' · ' + esc(a.plate) : ''}</div>
      <div>📞 <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · Ref ${esc(a.ref)}${a.notes ? ' · 📝 ' + esc(a.notes) : ''}</div></div>
    <div class="acts">
      ${a.status === 'pending' ? `<button class="btn sm primary" data-act="confirmed">Confirm</button>` : ''}
      ${['pending', 'confirmed'].includes(a.status) ? `<button class="btn sm" data-act="completed">Done ✓</button>` : ''}
      ${phone ? `<a class="btn sm wa" target="_blank" rel="noopener" href="https://wa.me/${intl}?text=${encodeURIComponent(`Assalam o Alaikum ${a.customer_name}, your booking at ${BIZ} for ${a.service_name} on ${pDate(a.date)} at ${fmt12(a.time)} is ${a.status === 'pending' ? 'confirmed' : a.status}. Ref: ${a.ref}`)}">WhatsApp</a>` : ''}
      <button class="btn sm" data-act="edit">Edit</button>
      ${['pending', 'confirmed'].includes(a.status) ? `<button class="btn sm danger" data-act="cancelled">Cancel</button>` : ''}
    </div></div>`;
}
let apptCache = [];
function bindApptRows(root, reload) {
  root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.appt').dataset.id, act = b.dataset.act;
    if (act === 'edit') {
      const list = await api('/api/admin/appointments'); const a = list.find(x => String(x.id) === id);
      return apptForm(a, reload);
    }
    if (act === 'cancelled' && !confirm('Cancel this booking?')) return;
    await api(`/api/admin/appointments/${id}`, { method: 'PATCH', body: { status: act } });
    toast(`Marked as ${act}`); reload();
  }));
}
async function loadAppointments() {
  topBtn.reset = true;
  topBtn('Export CSV', () => (location.href = '/api/admin/appointments.csv'), '');
  topBtn('+ New booking', () => apptForm());
  const p = new URLSearchParams();
  if (af.date) { p.set('from', af.date); p.set('to', af.date); }
  else if (af.range === 'today') { p.set('from', TODAY); p.set('to', TODAY); }
  else if (af.range === 'tomorrow') { const t = addDays(TODAY, 1); p.set('from', t); p.set('to', t); }
  else if (af.range === 'upcoming') p.set('from', TODAY);
  else if (af.range === 'past') p.set('to', addDays(TODAY, -1));
  if (af.status !== 'all') p.set('status', af.status);
  if (af.q) p.set('q', af.q);
  let list = await api('/api/admin/appointments?' + p);
  if (af.range === 'past' && !af.date) list = list.reverse();
  apptCache = list;
  let html = '', lastDay = '';
  list.forEach(a => { if (a.date !== lastDay) { html += `<div class="day-h">${pDate(a.date)}${a.date === TODAY ? ' · Today' : ''}</div>`; lastDay = a.date; } html += apptRow(a); });
  $('#apptList').innerHTML = html || `<div class="empty">No appointments match.</div>`;
  bindApptRows($('#apptList'), loadAppointments);
}
$('#rangeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#rangeSeg button').forEach(x => x.classList.toggle('on', x === b));
  af.range = b.dataset.range; af.date = ''; $('#fDate').value = ''; loadAppointments();
});
$('#fDate').addEventListener('change', e => { af.date = e.target.value; $$('#rangeSeg button').forEach(x => x.classList.remove('on')); loadAppointments(); });
$('#fStatus').addEventListener('change', e => { af.status = e.target.value; loadAppointments(); });
let sT; $('#fSearch').addEventListener('input', e => { clearTimeout(sT); sT = setTimeout(() => { af.q = e.target.value.trim(); loadAppointments(); }, 300); });

function apptForm(a = null, reload = () => go(location.hash.slice(1))) {
  const m = openModal(`<h3>${a ? 'Edit booking ' + esc(a.ref) : 'New booking (walk-in / phone)'}</h3>
    <form id="af">
      <div class="row2">
        <label>Customer name<input name="customer_name" required value="${esc(a?.customer_name)}"></label>
        <label>Phone<input name="phone" value="${esc(a?.phone)}"></label>
        <label>Car<input name="car" value="${esc(a?.car)}"></label>
        <label>Plate<input name="plate" value="${esc(a?.plate)}"></label>
      </div>
      <label>Service<select name="service_id" required>${SERVICES.map(s => `<option value="${s.id}" ${a?.service_id === s.id ? 'selected' : ''}>${esc(s.name)} — ${money(s.price)}</option>`).join('')}</select></label>
      <div class="row2">
        <label>Date<input type="date" name="date" required value="${a?.date || TODAY}"></label>
        <label>Price charged<input type="number" name="price" placeholder="Default service price" value="${a ? a.price : ''}"></label>
      </div>
      <label>Time <span class="muted">(red dashed = bays full, you can still overbook)</span></label>
      <div class="slots" id="afSlots"></div>
      <input type="hidden" name="time" value="${a?.time || ''}">
      <label>Status<select name="status">${['pending', 'confirmed', 'completed', 'cancelled'].map(s => `<option ${(a?.status || 'confirmed') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Notes<textarea name="notes" rows="2">${esc(a?.notes)}</textarea></label>
      <div class="mfoot">${a ? `<button type="button" class="btn danger" id="afDel">Delete</button>` : ''}<span style="flex:1"></span><button type="button" class="btn" data-close>Close</button><button class="btn primary">Save</button></div>
    </form>`);
  const f = m.querySelector('#af');
  async function slots() {
    const r = await api(`/api/admin/slots?date=${f.date.value}&service_id=${f.service_id.value}${a ? '&ignore_id=' + a.id : ''}`);
    const box = m.querySelector('#afSlots');
    if (r.closed && !r.slots.length) { box.innerHTML = `<span class="muted">${esc(r.reason)}</span> <input type="time" id="afManual" style="width:auto" value="${f.time.value}">`;
      m.querySelector('#afManual').onchange = e => (f.time.value = e.target.value); return; }
    box.innerHTML = r.slots.map(s => `<button type="button" data-t="${s.time}" class="${s.available ? '' : 'full'} ${f.time.value === s.time ? 'on' : ''}">${fmt12(s.time)}</button>`).join('');
    box.querySelectorAll('button').forEach(b => (b.onclick = () => { f.time.value = b.dataset.t; box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }));
  }
  f.date.onchange = slots; f.service_id.onchange = slots; slots();
  f.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    if (!body.time) return toast('Pick a time', true);
    try {
      if (a) await api(`/api/admin/appointments/${a.id}`, { method: 'PATCH', body });
      else await api('/api/admin/appointments', { method: 'POST', body });
      closeModal(); toast('Saved'); reload();
    } catch (ex) { toast(ex.message, true); }
  };
  const del = m.querySelector('#afDel');
  if (del) del.onclick = async () => { if (!confirm('Delete this booking permanently?')) return; await api(`/api/admin/appointments/${a.id}`, { method: 'DELETE' }); closeModal(); toast('Deleted'); reload(); };
}

// ---------- services ----------
async function loadServices() {
  topBtn.reset = true;
  topBtn('+ Add service', () => serviceForm());
  SERVICES = await api('/api/admin/services');
  $('#serviceList').innerHTML = SERVICES.map(s => `<div class="icard ${s.active ? '' : 'off'}">
    <div class="im" style="${s.image ? `background-image:url('${esc(s.image)}')` : ''}">${s.image ? '' : 'No photo'}</div>
    <div class="bd"><b>${esc(s.name)}</b>${s.active ? '' : ' <span class="muted">(hidden)</span>'}<p>${esc(s.description)}</p><div class="meta">${money(s.price)} · ${s.duration_min} min</div></div>
    <div class="ft"><button class="btn sm" data-edit="${s.id}">Edit</button></div></div>`).join('') || `<div class="empty">No services yet.</div>`;
  $$('#serviceList [data-edit]').forEach(b => (b.onclick = () => serviceForm(SERVICES.find(s => String(s.id) === b.dataset.edit))));
}
function serviceForm(s = null) {
  const m = openModal(`<h3>${s ? 'Edit service' : 'New service'}</h3>
    <form id="sf">
      <label>Name<input name="name" required value="${esc(s?.name)}"></label>
      <label>Description<textarea name="description" rows="2">${esc(s?.description)}</textarea></label>
      <div class="row3">
        <label>Price (${esc(CUR)})<input type="number" name="price" min="0" value="${s?.price ?? ''}" required></label>
        <label>Duration (min)<input type="number" name="duration_min" min="10" step="5" value="${s?.duration_min ?? 30}"></label>
        <label>Display order<input type="number" name="sort" value="${s?.sort ?? 0}"></label>
      </div>
      <label>Photo<input type="file" name="image" accept="image/*"></label>
      ${s?.image ? `<label class="check"><input type="checkbox" name="remove_image" value="1"> Remove current photo</label>` : ''}
      <label class="check"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Show on website</label>
      <div class="mfoot">${s ? `<button type="button" class="btn danger" id="sDel">Delete</button>` : ''}<span style="flex:1"></span><button type="button" class="btn" data-close>Close</button><button class="btn primary">Save</button></div>
    </form>`);
  const f = m.querySelector('#sf');
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f); fd.set('active', f.active.checked ? '1' : '0');
    if (!f.image.files.length) fd.delete('image');
    try { await api(s ? `/api/admin/services/${s.id}` : '/api/admin/services', { method: s ? 'PUT' : 'POST', body: fd }); closeModal(); toast('Service saved'); loadServices(); }
    catch (ex) { toast(ex.message, true); }
  };
  const d = m.querySelector('#sDel');
  if (d) d.onclick = async () => { if (!confirm('Delete this service? Past bookings keep their record. Tip: untick "Show on website" to just hide it.')) return; await api(`/api/admin/services/${s.id}`, { method: 'DELETE' }); closeModal(); toast('Deleted'); loadServices(); };
}

// ---------- offers ----------
let OFFERS = [];
async function loadOffers() {
  topBtn.reset = true;
  topBtn('+ New offer', () => offerForm());
  OFFERS = await api('/api/admin/offers');
  $('#offerList').innerHTML = OFFERS.map(o => {
    const expired = o.valid_until && o.valid_until < TODAY;
    return `<div class="icard ${o.active && !expired ? '' : 'off'}">
    <div class="im" style="${o.image ? `background-image:url('${esc(o.image)}')` : 'background:linear-gradient(135deg,var(--p),#0b1220)'}">${o.badge ? `<span class="tag">${esc(o.badge)}</span>` : ''}</div>
    <div class="bd"><b>${esc(o.title)}</b><p>${esc(o.description)}</p>
      <div class="meta">${expired ? '⛔ Expired' : !o.active ? 'Hidden' : '✅ Live'}${o.valid_until ? ' · until ' + pDate(o.valid_until) : ' · no end date'}</div></div>
    <div class="ft"><button class="btn sm" data-edit="${o.id}">Edit</button></div></div>`;
  }).join('') || `<div class="empty">No offers yet. Create one to show a promo on the website.</div>`;
  $$('#offerList [data-edit]').forEach(b => (b.onclick = () => offerForm(OFFERS.find(o => String(o.id) === b.dataset.edit))));
}
function offerForm(o = null) {
  const m = openModal(`<h3>${o ? 'Edit offer' : 'New offer'}</h3>
    <form id="of">
      <label>Title<input name="title" required value="${esc(o?.title)}" placeholder="e.g. Full Wash + Wax"></label>
      <label>Description<textarea name="description" rows="3" placeholder="What's included, conditions…">${esc(o?.description)}</textarea></label>
      <div class="row2">
        <label>Badge text<input name="badge" value="${esc(o?.badge)}" placeholder="e.g. 20% OFF"></label>
        <label>Valid until <span class="muted">(optional)</span><input type="date" name="valid_until" value="${esc(o?.valid_until)}"></label>
      </div>
      <label>Image<input type="file" name="image" accept="image/*"></label>
      ${o?.image ? `<label class="check"><input type="checkbox" name="remove_image" value="1"> Remove current image</label>` : ''}
      <label class="check"><input type="checkbox" name="active" ${!o || o.active ? 'checked' : ''}> Show on website</label>
      <div class="mfoot">${o ? `<button type="button" class="btn danger" id="oDel">Delete</button>` : ''}<span style="flex:1"></span><button type="button" class="btn" data-close>Close</button><button class="btn primary">Save</button></div>
    </form>`);
  const f = m.querySelector('#of');
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f); fd.set('active', f.active.checked ? '1' : '0');
    if (!f.image.files.length) fd.delete('image');
    try { await api(o ? `/api/admin/offers/${o.id}` : '/api/admin/offers', { method: o ? 'PUT' : 'POST', body: fd }); closeModal(); toast('Offer saved'); loadOffers(); }
    catch (ex) { toast(ex.message, true); }
  };
  const d = m.querySelector('#oDel');
  if (d) d.onclick = async () => { if (!confirm('Delete this offer?')) return; await api(`/api/admin/offers/${o.id}`, { method: 'DELETE' }); closeModal(); toast('Deleted'); loadOffers(); };
}

// ---------- gallery ----------
async function loadGallery() {
  const list = await api('/api/admin/gallery');
  $('#galList').innerHTML = list.map(g => `<div class="gi" data-id="${g.id}"><img src="${esc(g.image)}" alt="">
    <div class="row"><input value="${esc(g.caption)}" placeholder="Caption"><button class="btn sm danger" title="Delete">✕</button></div></div>`).join('') || `<div class="empty">No photos yet.</div>`;
  $$('#galList .gi').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('input').onchange = async e => { await api(`/api/admin/gallery/${id}`, { method: 'PATCH', body: { caption: e.target.value } }); toast('Caption saved'); };
    el.querySelector('button').onclick = async () => { if (!confirm('Delete this photo?')) return; await api(`/api/admin/gallery/${id}`, { method: 'DELETE' }); loadGallery(); };
  });
}
async function uploadGallery(files) {
  if (!files.length) return;
  const fd = new FormData(); [...files].forEach(f => fd.append('images', f));
  toast(`Uploading ${files.length} photo(s)…`);
  try { const r = await api('/api/admin/gallery', { method: 'POST', body: fd }); toast(`${r.added} photo(s) added`); loadGallery(); }
  catch (ex) { toast(ex.message, true); }
}
$('#galFiles').addEventListener('change', e => { uploadGallery(e.target.files); e.target.value = ''; });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => uploadGallery(e.dataTransfer.files));

// ---------- settings ----------
async function loadSettings() {
  const s = await api('/api/admin/settings');
  const f = $('#settingsForm');
  [...f.elements].forEach(el => {
    if (!el.name || !(el.name in s)) return;
    if (el.type === 'checkbox') el.checked = s[el.name] === '1';
    else el.value = s[el.name] ?? '';
  });
  $$('.color').forEach(c => { const i = c.querySelector('input'), code = c.querySelector('code'); code.textContent = i.value; i.oninput = () => (code.textContent = i.value); });
  $('#hoursEd').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const h = s.hours[d] || {};
    return `<tr data-d="${d}"><td>${DAYS[d]}</td><td><input type="time" class="ho" value="${h.open || '08:00'}"></td><td>to</td>
      <td><input type="time" class="hc" value="${h.close || '19:00'}"></td><td><label class="check" style="margin:0"><input type="checkbox" class="hx" ${h.closed ? 'checked' : ''}> Closed</label></td></tr>`;
  }).join('');
  $$('.imgset').forEach(box => {
    const key = box.dataset.key, th = box.querySelector('.thumb');
    const paint = url => { th.style.backgroundImage = url ? `url('${url}')` : ''; th.textContent = url ? '' : 'No image'; };
    paint(s[key]);
    box.querySelector('input[type=file]').onchange = async e => {
      const fd = new FormData(); fd.append('image', e.target.files[0]);
      try { const r = await api(`/api/admin/settings/image/${key}`, { method: 'POST', body: fd }); paint(r.url); toast('Image updated'); } catch (ex) { toast(ex.message, true); }
      e.target.value = '';
    };
    box.querySelector('[data-remove]').onclick = async () => {
      const fd = new FormData(); fd.append('remove', '1');
      await api(`/api/admin/settings/image/${key}`, { method: 'POST', body: fd }); paint(''); toast('Image removed');
    };
  });
}
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, body = {};
  [...f.elements].forEach(el => { if (el.name) body[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; });
  body.hours = {};
  $$('#hoursEd tr').forEach(tr => (body.hours[tr.dataset.d] = { open: tr.querySelector('.ho').value, close: tr.querySelector('.hc').value, closed: tr.querySelector('.hx').checked }));
  try {
    await api('/api/admin/settings', { method: 'PUT', body });
    CUR = body.currency || 'Rs'; BIZ = body.business_name;
    document.documentElement.style.setProperty('--p', body.primary_color);
    toast('Settings saved — refresh the website to see changes');
  } catch (ex) { toast(ex.message, true); }
});
$('#accountForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/api/admin/account', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Account updated'); }
  catch (ex) { toast(ex.message, true); }
});

boot();
