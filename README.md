# FitTrack

FitTrack is a privacy-conscious personal fitness and health tracker. This repository currently delivers a tested, full-stack foundation and the first working vertical slices: owner setup, authenticated dashboard, food diary with Open Food Facts lookup, hydration, manual steps, weight history, workout session lifecycle with server-calculated duration, weekly diet and workout charts, supplements, medication records, goals, scheduled reminders, profile targets, and basic trends.

## Architecture

```text
Next.js App Router (TypeScript, Tailwind, TanStack Query, RHF/Zod, Recharts)
        │ HTTPS/cookie session + CSRF header
        ▼
FastAPI /api/v1 (Pydantic validation, owner checks, consistent errors)
        ▼
SQLAlchemy 2.x ── SQLite (Alembic-ready schema)
```

Every personal row is owner-scoped. `User` has one `UserProfile`; one user owns foods/logs, hydration, steps, body records, workout sessions, supplements, medications, goals, and reminders. Food and activity logs preserve a local date to prevent a time-zone conversion from moving a daily entry. The database stores timestamps in UTC-aware columns where applicable and uses indexes for the usual owner/date lookups.

## Current milestone plan

1. **Foundation — implemented:** project structure, owner-only first-run account setup, JWT HTTP-only cookie session, CSRF protection, SQLite persistence, dashboard shell, core daily tracking, base tests and Docker configuration.
2. **Nutrition — in progress:** Open Food Facts product and barcode search with automatic per-serving calculations is implemented. Local food database, USDA fallback, recipes, favourites, meal planner and richer nutrition reporting remain.
3. **Training — next:** exercise library, workout plans, set logger, volume/PR analytics and calendar consistency.
4. **Health routine — next:** supplement/medication schedules and adherence logs, body measurements, reminders and notification history.
5. **Reporting and hardening — next:** unified calendar interactions, export, full test suite, Playwright, CI, migrations, deployment guidance.

The API starts in development with `create_all` for a frictionless first run. Production should run Alembic migrations before the API process; `backend/alembic` is configured for that workflow. SQLite is suitable for a personal or low-concurrency deployment. Move `FITTRACK_DATABASE_URL` to PostgreSQL before supporting multiple concurrent writers.

## Diet chart and workout chart

Both charts are reusable weekly plans keyed by weekday. You can keep several of each and **follow** one; the dashboard's *Today's plan* panel reads the followed charts.

| | Diet chart (`/diet-chart`) | Workout chart (`/workout-chart`) |
|---|---|---|
| Board | 5 meal slots × 7 days, with day totals | 7 day columns, each with a focus (Push, Legs…) |
| Item | Food, portion, kcal, protein, carbs, fat | Exercise, muscle group, sets, reps, kg, minutes, rest |
| Charts | Calories by day split by macro, against target | Sets by day by muscle group; muscle-group balance |
| Shortcuts | Copy a day; log today's meal to the food diary | Copy a day; start today's workout as a session |

API: `/diet-charts`, `/diet-charts/{id}/items`, `/diet-chart-items/{id}`, `/workout-charts`, `/workout-charts/{id}/items`, `/workout-chart-items/{id}`, plus `POST …/{id}/activate`. Training history for the Workouts page chart comes from `/analytics/workouts?days=14`.

Existing databases: run `alembic upgrade head` from `backend/` to add the four chart tables (revision `20261004_01`). In development the API also creates them on start.

## Run locally

Backend (PowerShell):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend (a separate terminal):

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`, choose **First time here**, and create the one owner account. Copy `.env.example` values into your environment before production use, particularly a long `FITTRACK_SECRET_KEY`.

## Food lookup and calculations

The Food Diary can search the open-source Open Food Facts database by product name or product barcode. Choosing a result fills calories, protein, carbohydrates, fat, and fibre from the product's values per 100 g; changing the serving grams recalculates those values before the entry is saved. Search responses are cached briefly in the API to reduce upstream traffic.

Open Food Facts information is community-supplied and may be incomplete or inaccurate. FitTrack labels these entries with their source and keeps every value editable; verify packaged-food labels before relying on the result.

## Validation

```powershell
cd backend
python -m pytest
cd ..\frontend
npm.cmd run build
```

## Deploy with Vercel + PostgreSQL

FitTrack has two deployable services. Deploy the **Next.js frontend** to Vercel and the **FastAPI backend** to a persistent container/service that supports Docker. Do not deploy the current SQLite backend as a Vercel Function: its local filesystem is not a durable database, and a serverless instance is not a reliable home for the reminder scheduler.

### 1. Provision production infrastructure

1. Create a managed PostgreSQL database. Neon is available through Vercel's Marketplace, but any PostgreSQL provider works.
2. Deploy the `backend/` directory to a Docker-capable host. Its existing `backend/Dockerfile` is the build definition; expose port `8000` and set its health check to `/health`.
3. Prefer custom sibling subdomains, such as `app.example.com` (Vercel) and `api.example.com` (backend). They allow the secure cookie session to remain same-site. If you use unrelated default provider domains, browser privacy settings can block cookie authentication.

### 2. Configure backend production variables

Set these on the backend host—never commit them:

```text
FITTRACK_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
FITTRACK_SECRET_KEY=<a-random-32-byte-or-longer-secret>
FITTRACK_CORS_ORIGINS=https://app.example.com
FITTRACK_ENVIRONMENT=production
FITTRACK_COOKIE_SECURE=true
FITTRACK_COOKIE_DOMAIN=.example.com
FITTRACK_COOKIE_SAMESITE=lax
```

`postgresql://` URLs are automatically configured to use the included psycopg 3 driver. Before exposing the API, run the initial Alembic migration once from the backend deployment environment:

```text
alembic upgrade head
```

The API only uses `create_all` for local development; production relies on the versioned migration so multiple workers do not race on schema changes.

### 3. Deploy the frontend on Vercel

1. In Vercel, choose **Add New → Project** and import the GitHub repository.
2. Set **Root Directory** to `frontend` so Vercel detects Next.js.
3. Add this **Production** environment variable:

   ```text
   NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
   ```

4. Deploy. Every GitHub push then creates a deployment; verify login, a food lookup, and a saved entry against the production API. Add a Preview API URL only after its exact preview origin is allowed in `FITTRACK_CORS_ORIGINS` on a non-production backend.

`NEXT_PUBLIC_API_URL` is intentionally public because it is the browser-facing API address. Do not put database URLs, the JWT secret, or USDA keys in Vercel frontend variables—`NEXT_PUBLIC_*` values are included in the client bundle.

### Before going live

- Use a long randomly generated `FITTRACK_SECRET_KEY` and back up PostgreSQL.
- Configure both the app and API custom domains before enabling secure cookies.
- Run the backend migration job only once per release, not in every API worker.
- Keep the reminder worker to one dedicated backend process until distributed job locking is implemented.

## Privacy and safety notes

- Medication names are treated as sensitive data. Browser notifications must never include them by default, and notification availability depends on browser, network, and device settings.
- FitTrack records user-entered information and does not prescribe diets, supplement doses, or medication changes.
- Back up the SQLite database file while the service is stopped, or use SQLite's backup command. Restore only a verified copy after stopping the service.
