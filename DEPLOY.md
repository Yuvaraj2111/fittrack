# Deploy FitTrack on Vercel

FitTrack deploys as **two Vercel projects from one GitHub repository**, plus a free **Neon Postgres** database.

| Project | Root directory | What it runs | Address |
|---|---|---|---|
| `fittrack-api` | `backend` | FastAPI as one Vercel Function | `https://fittrack-api.vercel.app` |
| `fittrack` | `frontend` | Next.js website | `https://fittrack.vercel.app` (the one you use) |

```text
Browser ──► fittrack.vercel.app ──/api/v1/*──► fittrack-api.vercel.app ──► Neon Postgres
            (Next.js proxy: same origin, so login cookies just work)
```

Everything Vercel needs is already in the repo: `backend/vercel.json`, `frontend/vercel.json`, `.vercelignore` files, `backend/.python-version`, and the proxy in `frontend/next.config.ts`.

---

## Before you start

| You need | Notes |
|---|---|
| GitHub account | Push this folder as a repository. `node_modules`, `.venv`, `.next` and `*.db` are ignored. |
| Vercel account | Hobby (free) plan is fine for personal use. Sign in with GitHub. |
| A secret key | Run `python -c "import secrets; print(secrets.token_urlsafe(48))"` and keep the output. |

```bash
git init && git add . && git commit -m "FitTrack"
git branch -M main
git remote add origin https://github.com/<you>/fittrack.git
git push -u origin main
```

---

## Step 1 — API project (`backend`)

| # | Where in Vercel | Do this |
|---|---|---|
| 1 | **Add New → Project** | Import your `fittrack` repository. |
| 2 | Configure screen | **Project Name**: `fittrack-api`. **Root Directory**: `backend`. Framework is detected as **FastAPI**. |
| 3 | Environment Variables (same screen) | Add the three variables below. |
| 4 | **Deploy** | The first deployment may show an error page when opened. That's expected: there's no database yet. |

| Variable | Value |
|---|---|
| `FITTRACK_ENVIRONMENT` | `production` |
| `FITTRACK_SECRET_KEY` | the secret you generated |
| `FITTRACK_COOKIE_SECURE` | `true` |

## Step 2 — Database (Neon)

| # | Where | Do this |
|---|---|---|
| 1 | `fittrack-api` → **Storage** tab | **Create Database → Neon** (Serverless Postgres). |
| 2 | Region | **Singapore (aws-ap-southeast-1)**, the closest to India. The projects run in Vercel's Singapore region (`sin1`) to match. |
| 3 | Connect | Connect it to `fittrack-api` for Production and Preview. Vercel adds `DATABASE_URL` automatically. |
| 4 | **Deployments** tab | Open the latest deployment → **⋯ → Redeploy**. |
| 5 | Check | Open `https://fittrack-api.vercel.app/health`. You should see `{"status":"ok"}`. |

Tables are created automatically on the first request. Nothing to run by hand.

## Step 3 — Website project (`frontend`)

| # | Where in Vercel | Do this |
|---|---|---|
| 1 | **Add New → Project** | Import the **same** repository again. |
| 2 | Configure screen | **Project Name**: `fittrack`. **Root Directory**: `frontend`. Framework: **Next.js**. |
| 3 | Environment Variables | `API_ORIGIN` = your API URL from step 1, e.g. `https://fittrack-api.vercel.app` (no trailing slash, no `/api/v1`). |
| 4 | **Deploy** | |

## Step 4 — Create your account straight away

Open `https://fittrack.vercel.app`, choose **First time here? Set up the owner account**, and register.

> Owner setup is open to anyone **until the first account exists**, then it locks. Do this immediately after deploying, before sharing the link.

---

## Optional — turn on AI diet planning

The diet and workout planners (**Plan with AI** on the Diet chart and Workout chart pages) work without any key, using built-in food and exercise libraries. To have Claude write the plans instead:

| # | Do this |
|---|---|
| 1 | Create an API key at **console.anthropic.com** → API Keys (needs billing set up; each plan costs a fraction of a rupee to a few rupees). |
| 2 | Backend project → **Settings → Environment Variables** → add `ANTHROPIC_API_KEY` = your key. |
| 3 | Optional: `FITTRACK_AI_MODEL` (default `claude-haiku-5-5`, the fastest). Use `claude-sonnet-5-5` for richer plans; it is slower. |
| 4 | Redeploy the backend. The planner now shows **AI planning on**. |

The key stays on the backend only; never add it to the website project. If the AI is slow or fails for a day, that day falls back to the built-in planner and the page says so.

## After it's live

| Optional | How |
|---|---|
| Faster cold starts | On `fittrack-api`, add `FITTRACK_AUTO_CREATE_TABLES` = `false`, then redeploy. Set it back to `true` for one deploy whenever a new version adds tables. |
| Your own domain | `fittrack` → **Settings → Domains** → add e.g. `fit.internetartsy.me`. Nothing else changes; the API stays private behind the proxy. |
| Updates | `git push` redeploys both projects. To rebuild only the half that changed, turn on the option to skip deployments when the Root Directory has no changes (**Settings → Build and Deployment**). |
| Backups | Neon console → **Branches / Restore** has point-in-time restore. |

## Deploy from the command line instead (no GitHub)

```bash
npm i -g vercel
cd backend
vercel link                          # create project "fittrack-api"
vercel env add FITTRACK_ENVIRONMENT production    # production
vercel env add FITTRACK_SECRET_KEY production     # <your secret>
vercel env add FITTRACK_COOKIE_SECURE production  # true
# add Neon in the dashboard (Step 2), then:
vercel --prod

cd ../frontend
vercel link                          # create project "fittrack"
vercel env add API_ORIGIN production # https://fittrack-api.vercel.app
vercel --prod
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Website build fails: *API_ORIGIN is not set* | Missing variable on `fittrack` | Add `API_ORIGIN` (Step 3), then redeploy. |
| API shows *FUNCTION_INVOCATION_FAILED* | No database or weak secret | Check **Logs**. Confirm `DATABASE_URL` exists (Step 2) and the secret is 32+ characters. Redeploy. |
| Sign-in returns to the login page | Website can't reach the API | Visit `API_ORIGIN` + `/health`. Fix the URL, then redeploy the website (rewrites are fixed at build time). |
| *Initial owner already configured* | An account already exists | Sign in instead. To start over, in Neon's SQL editor run `DELETE FROM users;` (this deletes all data). |
| First request after a while takes 1–3 s | Function and Neon cold start | Normal on free plans. |

## What changed for Vercel

| File | Change |
|---|---|
| `frontend/next.config.ts` | Proxies `/api/v1/*` to `API_ORIGIN`. Fails the build with a clear message if it's missing on Vercel. |
| `frontend/src/lib/api.ts` | Calls the same-origin `/api/v1` by default. |
| `backend/app/core/config.py` | Reads Neon's `DATABASE_URL`, accepts `postgres://` URLs, refuses to start in production with SQLite or a weak secret. |
| `backend/app/main.py` | Creates missing tables at startup (works without lifespan events); adds `/` info route. |
| `backend/app/database.py` | Small connection pool suited to serverless. |
| `backend/requirements.txt` | `pytest` moved to `requirements-dev.txt`, keeping the function smaller. |
| `vercel.json`, `.vercelignore`, `.python-version` | Region `sin1`, upload exclusions, Python 3.12. |

The Docker setup (`docker-compose.yml`) still works as before.
