// lib/puntingform.js — shared helper for calling Punting Form's v2 API.
//
// Env var needed (set in Vercel → Settings → Environment Variables):
//   PUNTINGFORM_API_KEY  -> the key you got from Punting Form support

const BASE = 'https://api.puntingform.com.au/v2';

async function pfGet(path, params = {}) {
  const query = new URLSearchParams({ ...params, apiKey: process.env.PUNTINGFORM_API_KEY });
  const res = await fetch(`${BASE}${path}?${query.toString()}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Punting Form API error (${path}): ${res.status}`);
  }
  return res.json();
}

module.exports = { pfGet };
