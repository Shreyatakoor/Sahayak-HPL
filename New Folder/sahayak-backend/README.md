# Sahayak Backend

Backend REST API for the Sahayak Community Assistance Platform — user auth,
volunteer registration/verification, assistance request dispatch, and
emergency escalation to 112.

Node.js + Express + SQLite (in-memory) + JWT + bcrypt.

## 1. Setup (VS Code)

Open a terminal in VS Code (`` Ctrl+` ``) inside this folder and run:

```bash
npm install
```

This installs `express`, `sqlite3`, `jsonwebtoken`, `bcryptjs`, and `dotenv`
exactly as declared in `package.json`.

A `.env` file is already included with working defaults:

```
PORT=3000
JWT_SECRET=sahayak_jwt_secret_key_2026
JWT_EXPIRES_IN=15m
VOICE_API_KEY=voice_platform_secret_key
ADMIN_SEED_PHONE=9900000000
ADMIN_SEED_PASSWORD=police123
```

Change these before deploying anywhere real.

## 2. Run

```bash
npm start
```

You should see:

```
Seeded police_admin user (phone: 9900000000)
Sahayak backend running at http://localhost:3000
Health check: GET http://localhost:3000/health
```

Use `npm run dev` instead for auto-restart on file changes (Node's built-in
`--watch`, no extra dependency needed).

The database is **in-memory** — it resets every time you restart the server,
except for the seeded admin account, which is recreated automatically.

## 3. Quick smoke test

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"9900000000","password":"police123"}'
```

The login call returns a JWT — copy it into `TOKEN` below to try an
authenticated route:

```bash
TOKEN="paste-the-token-here"

curl http://localhost:3000/api/volunteers \
  -H "Authorization: Bearer $TOKEN"
```

## 4. API Reference

All responses are JSON: `{ "success": true, "data": ... }` or
`{ "success": false, "error": { "code": "...", "message": "..." } }`.

### Auth (`/api/auth`)

| Method | Path       | Auth | Body                                                             | Notes                                    |
|--------|------------|------|-------------------------------------------------------------------|-------------------------------------------|
| POST   | `/register`| none | `role, name, phone_number, password, organisation_id?`           | `role`: `senior_citizen` \| `volunteer`  |
| POST   | `/login`   | none | `phone_number, password`                                        | Returns a JWT (15 min default expiry)    |

### Volunteers (`/api/volunteers`) — JWT required

| Method | Path                  | Role(s)               | Body                              | Notes                                  |
|--------|-----------------------|------------------------|------------------------------------|-----------------------------------------|
| GET    | `/`                   | police_admin           | —                                   | `?status=` filter optional              |
| GET    | `/:id`                | police_admin or self   | —                                   |                                          |
| PATCH  | `/:id/review`         | police_admin           | `notes?`                           | `registered` → `under_review`           |
| PATCH  | `/:id/decision`       | police_admin           | `decision` (`approved`\|`rejected`), `notes?` | → `verified` or `rejected`   |
| PATCH  | `/:id/activate`       | police_admin           | —                                   | `verified` → `active`                   |

### Assistance Requests (`/api/requests`)

| Method | Path              | Auth                          | Body                                                            | Notes                                     |
|--------|-------------------|--------------------------------|-------------------------------------------------------------------|---------------------------------------------|
| POST   | `/`               | `x-api-key` header             | `senior_citizen_id, location, need, priority?, is_emergency?`     | `is_emergency: true` auto-escalates to 112  |
| GET    | `/`               | JWT                             | —                                                                   | Scoped by role; `?status=` filter optional  |
| GET    | `/:id`            | JWT                             | —                                                                   |                                              |
| PATCH  | `/:id/assign`     | JWT (police_admin)             | `volunteer_id`                                                     | Volunteer must be `active`                  |
| PATCH  | `/:id/status`     | JWT (police_admin or assignee) | `status` (`in_progress`\|`completed`\|`cancelled`)                 |                                              |

The `POST /api/requests` route uses the `x-api-key` header (matching
`VOICE_API_KEY` in `.env`) instead of a JWT, since it's meant to be called by
a trusted voice/IVR front-end on behalf of a senior citizen who may not have
an active login session.

### Emergency Escalations (`/api/escalations`) — police_admin only

| Method | Path            | Body | Notes                                            |
|--------|-----------------|------|---------------------------------------------------|
| GET    | `/`             | —    | `?status=` filter optional                        |
| GET    | `/:id`          | —    |                                                     |
| PATCH  | `/:id/close`    | —    | Closes the escalation and completes the request    |

## 5. Example end-to-end flow

```bash
BASE=http://localhost:3000

# 1. Register a senior citizen
curl -s -X POST $BASE/api/auth/register -H "Content-Type: application/json" \
  -d '{"role":"senior_citizen","name":"Lakshmi","phone_number":"9811111111","password":"pass1234"}'

# 2. A voice platform files an emergency request on her behalf
curl -s -X POST $BASE/api/requests \
  -H "Content-Type: application/json" \
  -H "x-api-key: voice_platform_secret_key" \
  -d '{"senior_citizen_id":"usr-...","location":"MG Road, Bengaluru","need":"Fall detected","is_emergency":true}'

# 3. Admin logs in
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d '{"phone_number":"9900000000","password":"police123"}'

# 4. Admin views open escalations
curl -s $BASE/api/escalations?status=escalated -H "Authorization: Bearer $TOKEN"

# 5. Admin closes it once resolved
curl -s -X PATCH $BASE/api/escalations/esc-.../close -H "Authorization: Bearer $TOKEN"
```

## 6. Project structure

```
sahayak-backend/
├── .env
├── .env.example
├── .gitignore
├── package.json
├── server.js
├── config/
│   └── database.js
├── middleware/
│   └── auth.js
├── routes/
│   ├── auth.js
│   ├── volunteers.js
│   ├── requests.js
│   └── escalations.js
└── utils/
    └── validators.js
```

## 7. Notes / production hardening (not included by default)

- Swap `:memory:` for a file path in `config/database.js` to persist data
  across restarts.
- Rotate `JWT_SECRET` and `VOICE_API_KEY` and load them from a real secrets
  manager, not `.env`, in production.
- Add rate limiting (e.g. `express-rate-limit`) on `/api/auth/login` and the
  public `/api/requests` create endpoint.
- Add input sanitization/validation library (e.g. `zod` or `joi`) if the API
  surface grows.
