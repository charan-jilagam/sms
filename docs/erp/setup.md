# Setup & deployment

Requires **Node 22+**. No database server is needed.

## 1. Run it locally

```bash
# API
cd server
npm install
npm run seed        # creates the SQLite file and fills demo data
npm start           # http://localhost:4000

# UI (second terminal)
cd client
npm install
npm run dev         # http://localhost:5173  (proxies /api to :4000)
```

Use `npm run seed -- --minimal` for an empty school (settings, one admin, one ID template), and `npm run reset` to wipe and re-seed.

## 2. Demo logins

| Role | Sign in with | Password |
|---|---|---|
| Admin | admin@school.test | Admin@123 |
| Class teacher (6-A) | anita@school.test | Teacher@123 |
| Class teacher (6-B) | rahul@school.test | Teacher@123 |
| Subject teacher | meera@school.test | Teacher@123 |
| Finance | finance@school.test | Finance@123 |
| Parent (1 child) | 9000000001 | Parent@123 |
| Parent (2 children) | 9000000002 | Parent@123 |
| Student | ADM2026-0001 | Student@123 |
| Driver | driver1@school.test | Driver@123 |

Change these before real use (Admin → Accounts → reset password).

## 3. Configuration (`server/.env.example`)

| Variable | Meaning |
|---|---|
| `PORT` | API port (default 4000) |
| `JWT_SECRET` | **Required in production.** Long random string |
| `DB_PATH` | SQLite file (default `./data/school.db`) |
| `UPLOAD_DIR` | Question paper uploads |
| `BACKUP_DIR` | Nightly backups |
| `CORS_ORIGIN` | Comma-separated UI origins |
| `ENABLE_CRON` | Scheduler is **off** by default. `1` turns the automatic jobs on |
| `BREVO_API_KEY`, `EMAIL_FROM` | E-mail through Brevo |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Live online fee payments |
| `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, `SMS_DEFAULT_COUNTRY_CODE` | SMS through TextBee |

Create `server/.env` from `server/.env.example`. It is read at start-up and ignored by git. Real environment variables override it.

## 4. Production (single process)

```bash
cd client && npm ci && npm run build        # creates client/dist
cd ../server && npm ci --omit=dev
NODE_ENV=production JWT_SECRET=... node src/index.js
```

When `client/dist` exists the API serves the UI too, so one process on one port is enough. Put Nginx or Caddy in front for HTTPS.

Back up `server/data/` (the `.db` file plus `backups/`) and `server/uploads/`.

## 5. Plug in real providers

* **E-mail** goes out through Brevo, **SMS** through TextBee, once the keys are in `server/.env`. Every message is also listed under System → Outbox, where *Send queued now* retries failures. A channel without keys only logs. TextBee needs `TEXTBEE_DEVICE_ID` (the id of the phone you registered in the TextBee dashboard).
* **Online payments** use Razorpay Checkout automatically when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set (signature verified on the server). Without them the demo gateway runs and no money moves. Use `rzp_test_` keys while testing.

## 6. Tests

```bash
cd server && npm test
```
