# FormEdge — Setup Guide

A personal race analysis tool: pulls real Punting Form data (form,
jockey/trainer stats, speed maps) and Betfair live odds, sends it all to
Claude for analysis, and tracks your saved picks' results over time.

## What's in this folder

- `public/index.html` — the page you see (race picker, manual entry, results, My Picks)
- `api/predict.js` — analyzes a single race (Punting Form + Betfair, or manual entry) using Claude
- `api/tipsheet.js` — analyzes every upcoming race at a venue and returns a consolidated tip sheet
- `lib/analyzeRace.js` — the shared analysis logic used by both predict.js and tipsheet.js
- `api/races.js` — lists today's/tomorrow's AU race meetings and races from Punting Form
- `api/picks.js` — saves picks and lists them with running profit/loss (needs Postgres)
- `api/check-results.js` — checks saved picks against Punting Form's Results endpoint
- `lib/puntingform.js` — shared Punting Form API-call helper
- `lib/betfair.js` — Betfair login + odds-matching helper
- `package.json` — tells Vercel this is a project it can build, and lists its one dependency

## Step 1 — Get your API keys

**Anthropic (Claude):** console.anthropic.com → create an API key (pay-as-you-go billing).

**Punting Form:** you already have this from your Starter subscription.

**Betfair:** a Developer App Key (Delayed tier is fine to start) plus your normal Betfair username/password — see the earlier walkthrough for creating this via api.developer.betfair.com.

## Step 2 — Set up a database (for tracking picks)

1. In your Vercel project, go to the **Storage** tab
2. Click **Create Database** → choose **Postgres**
3. Follow the prompts to create it and connect it to this project — Vercel
   automatically adds the needed environment variables (like `POSTGRES_URL`)
   for you, no manual copying required
4. `api/picks.js` creates its own table automatically the first time it runs

## Step 3 — Put this project on GitHub

Create a repo, upload this folder's contents (not the folder itself — see
the earlier note about avoiding an extra nested folder), keeping the
`api`/`lib`/`public` structure intact.

## Step 4 — Deploy to Vercel

1. Import the repo as a new Vercel project
2. Settings → Environment Variables, add:
   - `ANTHROPIC_API_KEY`
   - `PUNTINGFORM_API_KEY`
   - `BETFAIR_APP_KEY`, `BETFAIR_USERNAME`, `BETFAIR_PASSWORD`
3. Redeploy so the variables and the Postgres connection take effect

## Note on response field names

Several Punting Form and Betfair endpoints had their exact response shape
confirmed against real data during development (meetingslist, fields,
form) — but a few newer additions (results, speedmaps) are still
best-effort guesses, since Punting Form's docs site doesn't publicly show
response schemas. If results-checking or the speed map ever come back
empty, that's the first thing to check: fetch the endpoint directly in a
browser with your apiKey appended and compare the real shape to the code.

## What's next

- Certificate-based Betfair login — more robust than username/password for
  frequent automated use
- Custom domain
- Ratings endpoint (Punting Form's own computed rating) — needs separate
  token auth beyond the API key, would give a second opinion to cross-check
  against Claude's analysis
- A results dashboard beyond the simple list — win rate by track/class/etc.
