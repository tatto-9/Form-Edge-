// /api/races — lists today's AU race meetings and races from Punting Form.
//
// NOTE ON RESPONSE FIELDS: Punting Form's docs (docs.puntingform.com.au)
// confirm the exact endpoints and request parameters used below, but the
// docs site renders response field names client-side, so they weren't
// visible when this was written. The code checks a couple of likely name
// variants (e.g. meetingId / MeetingId), but if meetings or races don't
// show up correctly, open this endpoint's URL directly in a browser (with
// your apiKey) to see the real field names and adjust the code below.

const { pfGet } = require('../lib/puntingform');
const { todayInSydney, raceHasStarted } = require('../lib/raceTime');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Use GET' });
  }

  try {
    // ?dayOffset=1 -> tomorrow's races (e.g. checking the night before).
    // Computed in Australian time (see lib/raceTime.js) — the server
    // itself runs in UTC.
    const dayOffset = parseInt(req.query.dayOffset, 10) || 0;
    const meetingDate = todayInSydney(dayOffset);

    const meetingsData = await pfGet('/form/meetingslist', { meetingDate });
    const meetings = meetingsData.payLoad || [];

    const races = [];

    for (const meeting of meetings) {
      const meetingId = meeting.meetingId;
      const track = (meeting.track && meeting.track.name) || 'Unknown track';
      if (!meetingId) continue;

      try {
        // raceNumber: 0 returns all races for the meeting.
        // payLoad here is a single object for the meeting, with the races
        // in a nested "races" array (confirmed from a real response) —
        // different shape from meetingslist, which was a flat array.
        const fieldsData = await pfGet('/form/fields', { meetingId, raceNumber: 0 });
        const meetingRaces = (fieldsData.payLoad && fieldsData.payLoad.races) || [];

        meetingRaces.forEach(r => {
          const raceNumber = r.number;
          // Skip races that have already started/finished — no point
          // "predicting" a race whose result already happened. Compared
          // correctly in Australian time, not the server's own clock.
          if (raceHasStarted(r.startTime)) return;

          races.push({
            raceId: `${meetingId}|${raceNumber}`,
            track,
            raceNumber,
            raceName: r.name || `Race ${raceNumber}`,
            startTime: r.startTime || '',
          });
        });
      } catch (innerErr) {
        // Don't let one bad meeting kill the whole list
        console.error(`Skipping meeting ${meetingId}:`, innerErr.message);
      }
    }

    return res.status(200).json({ races });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
