// /api/predict — Vercel serverless function
// Runs on Vercel's server, never in the browser, so these env vars stay secret:
//   PUNTINGFORM_API_KEY  -> from Punting Form support
//   BETFAIR_APP_KEY / BETFAIR_USERNAME / BETFAIR_PASSWORD -> betfair.com
//   ANTHROPIC_API_KEY    -> from console.anthropic.com
//
// Set all in Vercel: Project Settings -> Environment Variables
//
// The actual analysis logic lives in lib/analyzeRace.js, shared with
// api/tipsheet.js so a single race and a whole venue use the same code.

const { analyzeRace } = require('../lib/analyzeRace');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const { raceId, manualRunners, track, distance, going, raceName } = req.body;

  try {
    const result = await analyzeRace({ raceId, manualRunners, track, distance, going, raceName });
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
