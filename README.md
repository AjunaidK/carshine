# Car Shine Service Station: Website + Booking + Admin Panel

A complete website for Car Shine Service Station (Motorway Junction, Northern Bypass, Peshawar):

- **Public website** (`/`): hero, current offers, services & prices, an online booking system with live time slots, a photo gallery, opening hours, a Google map with directions, a WhatsApp button, and a "My booking" lookup where customers can check or cancel.
- **Admin panel** (`/admin`): dashboard, appointments, services, offers, gallery uploads, and full website customisation.

Tech: Node.js + Express, with SQLite (a single file, so no database server is needed) and plain HTML/CSS/JS. There's no build step.

---

## Run it locally

Requires **Node.js 18 or newer**.

```bash
npm install
npm start
```

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin
- First login: **admin / changeme123**. Change this right away in *Website settings → Admin account*.

To set your own first login, run with env vars instead (they only take effect on the very first run):
```bash
ADMIN_USER=owner ADMIN_PASSWORD='SomethingStrong!' npm start
```

---

## What the owner can do in the admin panel

| Section | What it does |
|---|---|
| **Dashboard** | Today's bookings, bookings waiting for confirmation, upcoming bookings, jobs completed this week, revenue this month, and the most popular services. |
| **Appointments** | Filter by Today / Tomorrow / Upcoming / Past / a specific date, by status, or by search. From here he can **Confirm**, mark **Done**, **Cancel**, **Edit / reschedule**, **WhatsApp the customer** (the message is pre-written), add **walk-in / phone bookings**, and **export everything to CSV** (opens in Excel). |
| **Services & prices** | Add, edit or hide services. Each one has a price, a duration, a photo and a display order. |
| **Offers** | Create promos with a title, description, badge (e.g. "20% OFF"), image and expiry date. Expired offers disappear automatically. |
| **Gallery** | Drag and drop up to 20 photos at once, add captions, delete photos. |
| **Website settings** | Business name, phone, WhatsApp, email, address, map location, headline text, the top banner announcement, homepage background photo, logo, brand colours, social links, opening hours for each day, holiday closures, slot length, number of bays, how many days ahead customers can book, and an on/off switch for online booking. It also has the admin username/password change. |

### How booking works
- Customers pick a service, then a date, then a free time. The site only shows times that are actually available.
- **Bays** = how many cars can be worked on at the same time (default is 2). A booking holds a bay for the length of its service. For example, a 4-hour detailing blocks one bay for 4 hours, so a slot can't be overbooked.
- Each booking gets a reference such as `CS-7KQ2M`. If WhatsApp is set up, the customer can also send their booking to the business on WhatsApp with one tap.
- New online bookings arrive as **Pending**. The owner confirms them, and can WhatsApp the customer straight from the list.
- Times use **Pakistan time** (Asia/Karachi) wherever the server is hosted. To change this, set `BUSINESS_TZ`.

---

## Put it online (cheapest simple options)

The app needs a host that runs Node.js and has **persistent storage**, because the database and uploaded photos are saved to disk.

**Option A: a small VPS** (DigitalOcean, Hetzner, Contabo, or a Pakistani host with VPS, about $4–6/month). This is the recommended option.
```bash
# on the server (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
git clone <your repo> carshine && cd carshine && npm install
sudo npm i -g pm2 && pm2 start server.js --name carshine && pm2 save && pm2 startup
```
Then put Nginx or Caddy in front of it for the domain and free HTTPS. With Caddy, the whole config is:
```
carshine.pk {
  reverse_proxy localhost:3000
}
```

**Option B: Railway / Render / Fly.io.** Attach a **persistent volume** and mount it so that `data/` and `uploads/` survive redeploys. Without a volume, bookings and photos are wiped on every deploy.

### Environment variables (all optional)
| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `ADMIN_USER` / `ADMIN_PASSWORD` | admin / changeme123 | First-run admin login |
| `JWT_SECRET` | auto-generated in `data/secret.key` | Login session signing |
| `BUSINESS_TZ` | Asia/Karachi | Timezone used for slots |
| `DATA_DIR` | ./data | Where the database lives (point at a persistent volume) |
| `UPLOAD_DIR` | ./uploads | Where uploaded photos live (point at a persistent volume) |

### Backups
Everything lives in two folders: **`data/`** (the database) and **`uploads/`** (photos). Copy both regularly. On a VPS, a daily cron job works, e.g. `tar czf ~/backup-$(date +%F).tgz data uploads`.

---

## File map
```
server.js              API + routes (public booking, admin, uploads)
db.js                  SQLite schema, default settings, seed services
public/index.html      Public website
public/css/site.css    Public styles
public/js/site.js      Public logic (rendering, booking, lookup)
public/admin/          Admin panel (index.html, admin.css, admin.js)
data/                  Database (created on first run)
uploads/               Uploaded images
```

## Before going live: checklist
1. Log in, then **change the admin password**.
2. Settings: add the **phone** and **WhatsApp number** in international format without the `+` (e.g. `923001234567`). This turns on the WhatsApp button and the call buttons.
3. Check **services and prices**. The ones included are placeholders, so set his real prices.
4. Upload a **homepage photo**, a **logo**, and some **gallery** shots of real work.
5. Check the **opening hours** (pre-filled from Google: daily 8 AM–7 PM, Friday 8 AM–12 PM) and the number of **bays**.
