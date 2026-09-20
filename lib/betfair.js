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

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (parseErr) {
    // Betfair sent back something that isn't JSON at all — usually means
    // the request itself was malformed (missing/invalid App Key is the
    // most common cause) rather than a normal login rejection.
    throw new Error(`Betfair login returned non-JSON (HTTP ${res.status}): ${rawText.slice(0, 200)}`);
  }
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

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (parseErr) {
    throw new Error(`Betfair API call returned non-JSON (HTTP ${res.status}): ${rawText.slice(0, 200)}`);
  }
  if (data[0].error) {
    throw new Error(`Betfair API error: ${JSON.stringify(data[0].error)}`);
  }
  return data[0].result;
}

// Normalizes a horse name for matching between providers, since Betfair
// runner names are often prefixed with a saddlecloth number ("1. Horse
// Name") and may include a country suffix ("Horse Name (NZ)") that Punting
// Form's plain name doesn't have.
function normalizeHorseName(name) {
  return (name || '')
    .replace(/^\d+\.\s*/, '')      // strip leading "1. "
    .replace(/\s*\([A-Z]{2,3}\)\s*$/, '') // strip trailing " (NZ)" etc.
    .trim()
    .toUpperCase();
}

// Finds the Betfair WIN market matching a given track/race number/start
// time (there's no shared ID between Betfair and Punting Form, so this is
// a best-effort match on venue name + race number + a time window), then
// returns live odds keyed by normalized horse name. Returns an empty
// object if no confident match is found or anything fails — the caller
// should treat this as best-effort, not guaranteed.
async function getBetfairOddsForRace(track, raceNumber, startTimeStr) {
  if (!track || !startTimeStr) return {};

  const raceStart = new Date(startTimeStr);
  if (isNaN(raceStart.getTime())) return {};

  const sessionToken = await bfLogin();

  const from = new Date(raceStart.getTime() - 20 * 60 * 1000).toISOString();
  const to = new Date(raceStart.getTime() + 20 * 60 * 1000).toISOString();

  const catalogues = await bfCall(sessionToken, 'listMarketCatalogue', {
    filter: {
      eventTypeIds: ['7'], // Horse Racing
      marketCountries: ['AU'],
      marketTypeCodes: ['WIN'],
      marketStartTime: { from, to },
    },
    marketProjection: ['EVENT', 'MARKET_START_TIME', 'RUNNER_DESCRIPTION'],
    maxResults: '50',
  });

  const trackNorm = track.toLowerCase();
  const match = catalogues.find(m => {
    const venue = ((m.event && (m.event.venue || m.event.name)) || '').toLowerCase();
    const venueMatches = venue.includes(trackNorm) || trackNorm.includes(venue);
    // Betfair market names for AU racing are typically like "R6 1600m Mdn"
    const numMatch = m.marketName.match(/^R(\d+)/);
    const numMatches = numMatch && String(numMatch[1]) === String(raceNumber);
    return venueMatches && numMatches;
  });

  if (!match) return {};

  const books = await bfCall(sessionToken, 'listMarketBook', {
    marketIds: [match.marketId],
    priceProjection: { priceData: ['EX_BEST_OFFERS'] },
  });
  const book = books[0];
  if (!book) return {};

  const oddsByHorse = {};
  match.runners.forEach(r => {
    const runnerBook = book.runners.find(rb => rb.selectionId === r.selectionId);
    const bestBack = runnerBook && runnerBook.ex && runnerBook.ex.availableToBack[0];
    if (bestBack) {
      oddsByHorse[normalizeHorseName(r.runnerName)] = bestBack.price;
    }
  });
  return oddsByHorse;
}

module.exports = { bfLogin, bfCall, normalizeHorseName, getBetfairOddsForRace };
