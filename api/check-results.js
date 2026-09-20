// /api/check-results — checks every pending pick against Punting Form's
// Results endpoint and marks it won/lost if the race has finished.
//
// NOTE ON RESPONSE FIELDS: same caveat as elsewhere in this project —
// Punting Form's docs confirm the endpoint and request params (meetingId,
// raceNumber, apiKey) but don't publicly show the response JSON shape.
// This assumes the same payLoad -> races[] -> runners[] structure
// confirmed for /form/fields, with a "position" field marking finishing
// order — adjust below if a real response comes back differently shaped.

const { sql } = require('@vercel/postgres');
const { pfGet } = require('../lib/puntingform');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  try {
    // Only check picks from yesterday or earlier — races from today may
    // not have finished yet.
    const pending = await sql`
      SELECT * FROM picks
      WHERE status = 'pending' AND race_date < CURRENT_DATE
    `;

    let updated = 0;
    const errors = [];

    for (const pick of pending.rows) {
      if (!pick.meeting_id || !pick.race_number) continue;

      try {
        const resultsData = await pfGet('/form/results', {
          meetingId: pick.meeting_id,
          raceNumber: pick.race_number,
        });

        const payload = resultsData.payLoad || {};
        const race = (payload.races && payload.races[0]) || payload;
        const runners = race.runners || [];

        const runner = runners.find(r => r.name === pick.horse);
        const position = runner ? (runner.position ?? runner.finishPosition) : null;

        if (position != null) {
          const status = Number(position) === 1 ? 'won' : 'lost';
          await sql`UPDATE picks SET status = ${status} WHERE id = ${pick.id}`;
          updated++;
        }
      } catch (innerErr) {
        console.error(`Couldn't check result for pick ${pick.id}:`, innerErr.message);
        errors.push({ pickId: pick.id, error: innerErr.message });
      }
    }

    return res.status(200).json({ checked: pending.rows.length, updated, errors });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
