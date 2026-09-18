# FormEdge — Setup Guide

A personal race analysis tool: pulls real Punting Form data (form,
jockey/trainer stats, speed maps), sends it all to Claude for analysis,
and tracks your saved picks' results over time.

No live market odds source is currently wired in — Betfair access isn't
set up. See "What's next" for adding that back later.

## What's in this folder

- `public/index.html` — the page you see (race picker, manual entry, results, My Picks)
- `api/predict.js` — analyzes a single race (Punting Form, or manual entry) using Claude
- `api/tipsheet.js` — analyzes every upcoming race at a venue and returns a consolidated tip sheet
- `lib/analyzeRace.js` — the shared analysis logic used by both predict.js and tipsheet.js
- `api/races.js` — lists today's/tomorrow's AU race meetings and races from Punting Form
- `api/picks.js` — saves picks and lists them with running profit/loss (needs Postgres)
- `api/check-results.js` — checks saved picks against Punting Form's Results endpoint
- `lib/puntingform.js` — shared Punting Form API-call helper
- `vercel.json` — requests extended execution time for the tip sheet (it analyzes several races in one request, which takes longer than the platform's default)
- `package.json` — tells Vercel this is a project it can build, and lists its one dependency

## Step 1 — Get your API keys

**Anthropic (Claude):** console.anthropic.com → create an API key (pay-as-you-go billing).

**Punting Form:** you already have this from your Starter subscription.

## Step 2 — Set up a database (for tracking picks)

1. In your Vercel project, go to the **Storage** tab
2. Click **Create Database** → choose **Neon** (this is what Vercel's own
   Postgres offering is now built on — pick this one specifically, not
   Prisma Postgres, since the code expects Neon's env var naming)
3. Follow the prompts to create it and connect it to this project — Vercel
   automatically adds the needed environment variables (like `POSTGRES_URL`)
   for you, no manual copying required
4. `api/picks.js` creates its own table automatically the first time it runs

## Step 3 — Put this project on GitHub

Create a repo, upload this folder's contents (not the folder itself — see
the earlier note about avoiding an extra nested folder), keeping the
`api`/`lib`/`public` structure intact. `vercel.json` goes at the repo root,
alongside `package.json`.

## Step 4 — Deploy to Vercel

1. Import the repo as a new Vercel project
2. Settings → Environment Variables, add:
   - `ANTHROPIC_API_KEY`
   - `PUNTINGFORM_API_KEY`
3. Redeploy so the variables and the Postgres connection take effect

## Note on response field names

Several Punting Form endpoints had their exact response shape confirmed
against real data during development (meetingslist, fields, form) — but a
few newer additions (results, speedmaps) are still best-effort guesses,
since Punting Form's docs site doesn't publicly show response schemas. If
results-checking or the speed map ever come back empty, that's the first
thing to check: fetch the endpoint directly in a browser with your apiKey
appended and compare the real shape to the code.

## What's next

- Live market odds — Betfair was previously wired in (including a
  session-reuse optimization for the tip sheet) and removed since there's
  no access currently; could be added back, or a different odds source
  used instead, whenever that's available again
- Custom domain
- Ratings endpoint (Punting Form's own computed rating) — needs separate
  token auth beyond the API key, would give a second opinion to cross-check
  against Claude's analysis
- A results dashboard beyond the simple list — win rate by track/class/etc.
