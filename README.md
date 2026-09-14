# FormEdge — Setup Guide

This turns the prototype into a real, deployed site with a backend that
keeps your API keys secret. No coding experience needed for these steps —
just following along.

## What's in this folder

- `public/index.html` — the page people see (the form + results UI)
- `api/predict.js` — analyzes a race (from Punting Form or manual entry) using Claude
- `api/races.js` — lists today's AU race meetings and races from Punting Form
- `lib/puntingform.js` — shared Punting Form API-call helper
- `lib/betfair.js` — Betfair helper from an earlier step, not currently used
  by predict.js/races.js — kept for when Betfair's live odds get merged in
- `package.json` — tells Vercel this is a project it can build

## Step 1 — Get your API keys

**Anthropic (Claude) API key:**
1. Go to console.anthropic.com and sign up / log in
2. Create an API key — this is separate from your claude.ai chat account,
   and it's billed by usage (pay-as-you-go)

**Punting Form API key:** you already have this from your Starter
subscription (support@puntingform.com.au sent it). You'll need it for the
`PUNTINGFORM_API_KEY` environment variable in Step 3.

Until these are set up, the site still works fully using the manual entry
form — the backend just skips the live-data step.

**Note on what Punting Form gives you:** runner names, jockey, weight,
barrier, and recent form — not live odds. The AI reasons from form data
only for now. Live market odds come later when Betfair is merged in
(see "What's next" below).

**Note on response field names:** Punting Form's docs
(docs.puntingform.com.au) confirm the real endpoints and request
parameters, but don't publicly show the exact response JSON field names
(their docs site renders that part client-side). The code in `api/races.js`
and `api/predict.js` checks a couple of likely name variants, but if races
or runners don't show up correctly once deployed, that's the first thing
to check — open the Punting Form URL directly in a browser (with your
apiKey appended) to see the real response and adjust the field names in
the code to match.

## Step 2 — Put this project on GitHub

1. Create a free account at github.com if you don't have one
2. Create a new repository (e.g. "formedge")
3. Upload this whole folder to it (GitHub's website has an "upload files"
   button — no command line needed)

## Step 3 — Deploy to Vercel

1. Create a free account at vercel.com, signing in with your GitHub account
2. Click "Add New Project", pick your `formedge` repository, click Deploy
3. Once deployed, go to Project Settings → Environment Variables and add:
   - `ANTHROPIC_API_KEY` = your Anthropic key from Step 1
   - `PUNTINGFORM_API_KEY` = your Punting Form API key
4. Redeploy (Vercel will prompt you to, so the new variables take effect)

Vercel will give you a live URL (like `formedge.vercel.app`) — that's your
site, working, with real API keys held safely on the server.

## What's next

- Custom domain (e.g. formedge.com.au) — buy one and add it in Vercel's
  Domains settings
- Unit profit/loss tracking — needs a database (Vercel Postgres slots in
  easily) to record each pick's stake, odds, and result over time, plus a
  way to mark bets won/lost (or later, auto-pull settled results).
- Merging in Betfair's live odds alongside Punting Form's form data — the
  Betfair code from an earlier step (`lib/betfair.js`) is already written
  and ready; it just needs to be called in `api/predict.js` too, then
  merge by saddlecloth/runner number rather than horse name, since name
  text won't always match exactly between the two providers
- Certificate-based Betfair login — more robust than username/password for
  frequent automated use; worth moving to once Betfair's merged in
