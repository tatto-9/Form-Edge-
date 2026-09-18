// /api/tipsheet — analyzes every upcoming race at a single venue/meeting
// and returns a consolidated tip sheet, instead of one race at a time.
//
// Races are analyzed one at a time in sequence (not in parallel) — each
// one involves its own Betfair login, and hammering that concurrently for
// a big field of races risks rate limits or session conflicts. This is
// slower but more reliable; a meeting with 8 races might take a minute
// or so to fully process.

const { pfGet } = require('../lib/puntingform');
const { analyzeRace } = require('../lib/analyzeRace');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const { meetingId } = req.body;
  if (!meetingId) {
    return res.status(400).json({ error: 'meetingId is required' });
  }

  try {
    // raceNumber: 0 returns all races for the meeting — same call
    // api/races.js makes to build the picker.
    const fieldsData = await pfGet('/form/fields', { meetingId, raceNumber: 0 });
    const payload = fieldsData.payLoad || {};
    const track = (payload.track && payload.track.name) || 'Unknown track';
    const allRaces = payload.races || [];

    // Only analyze races that haven't started yet — same reasoning as the
    // race picker: no point tip-sheeting a race that's already finished.
    const upcoming = allRaces.filter(r => {
      const start = r.startTime ? new Date(r.startTime) : null;
      return !start || start.getTime() >= Date.now();
    });

    if (upcoming.length === 0) {
      return res.status(200).json({ track, races: [] });
    }

    const races = [];
    for (const r of upcoming) {
      const raceNumber = r.number;
      try {
        const result = await analyzeRace({ raceId: `${meetingId}|${raceNumber}` });
        races.push({
          raceNumber,
          raceName: r.name || `Race ${raceNumber}`,
          startTime: r.startTime || '',
          verdict: result.verdict,
          verdictReason: result.verdictReason,
          // Top 3 picks only — a tip sheet is meant to be scannable across
          // a whole card, not a full breakdown per race.
          picks: (result.picks || []).slice(0, 3),
        });
      } catch (raceErr) {
        console.error(`Race ${raceNumber} failed, continuing with the rest:`, raceErr.message);
        races.push({
          raceNumber,
          raceName: r.name || `Race ${raceNumber}`,
          startTime: r.startTime || '',
          error: raceErr.message,
        });
      }
    }

    return res.status(200).json({ track, races });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
