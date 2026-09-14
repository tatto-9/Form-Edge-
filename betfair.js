// lib/betfair.js — shared helpers for talking to the Betfair Exchange API.
//
// Env vars needed (set in Vercel → Settings → Environment Variables):
//   BETFAIR_APP_KEY   -> your Delayed (or later, Live) Application Key
//   BETFAIR_USERNAME  -> your Betfair login username
//   BETFAIR_PASSWORD  -> your Betfair login password
//
// This uses the simple "interactive" login (username/password on every
// call). Betfair's recommended approach for automated/bot use is
// certificate-based login instead, which lasts longer per session and is
// less likely to get flagged — worth moving to once this is working.

async function bfLogin() {
  const res = await fetch('https://identitysso.betfair.com/api/login', {
    method: 'POST',
    headers: {
      'X-Application': process.env.BETFAIR_APP_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: `username=${encodeURIComponent(process.env.BETFAIR_USERNAME)}&password=${encodeURIComponent(process.env.BETFAIR_PASSWORD)}`,
  });

  const data = await res.json();
  if (data.status !== 'SUCCESS') {
    throw new Error(`Betfair login failed: ${data.status} ${data.error || ''}`);
  }
  return data.token;
}

async function bfCall(sessionToken, method, params) {
  const res = await fetch('https://api.betfair.com/exchange/betting/json-rpc/v1', {
    method: 'POST',
    headers: {
      'X-Application': process.env.BETFAIR_APP_KEY,
      'X-Authentication': sessionToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      jsonrpc: '2.0',
      method: `SportsAPING/v1.0/${method}`,
      params,
      id: 1,
    }]),
  });

  const data = await res.json();
  if (data[0].error) {
    throw new Error(`Betfair API error: ${JSON.stringify(data[0].error)}`);
  }
  return data[0].result;
}

module.exports = { bfLogin, bfCall };
