// /api/predict — Vercel serverless function
// Runs on Vercel's server, never in the browser, so these env vars stay secret:
//   PUNTINGFORM_API_KEY  -> from Punting Form support
//   ANTHROPIC_API_KEY    -> from console.anthropic.com
//
// Set both in Vercel: Project Settings -> Environment Variables

const { pfGet } = require('../lib/puntingform');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const { raceId, manualRunners, track, distance, going, raceName } = req.body;

  try {
    let runners;
    let raceMeta;

    if (raceId) {
      // --- Live data path: raceId is "meetingId|raceNumber" ---
      const [meetingId, raceNumber] = raceId.split('|');

      const fieldsData = await pfGet('/form/fields', { meetingId, raceNumber });

      // Confirmed real shape (from a live /form/fields response): payLoad is
      // an object for the meeting with a "races" array inside it, each race
      // having its own "runners" array. Requesting a specific raceNumber
      // (rather than 0) may come back as a one-item races array or as a
      // single race directly under payLoad — this handles both.
      const payload = fieldsData.payLoad || {};
      const race = (payload.races && payload.races[0]) || payload;
      const fieldRunners = race.runners || [];

      // Scratched runners: best-effort. This endpoint's response shape
      // hasn't been confirmed against real data yet, so if it fails or
      // doesn't match, we just skip the filtering rather than breaking
      // the whole race.
      let scratchedTabs = new Set();
      try {
        const scratchData = await pfGet('/Updates/Scratchings', {});
        const scratchings = scratchData.payLoad || [];
        scratchedTabs = new Set(
          scratchings
            .filter(s => String(s.meetingId) === String(meetingId)
              && String(s.raceNumber ?? s.number) === String(raceNumber))
            .map(s => s.tabNo)
        );
      } catch (scratchErr) {
        console.error('Scratchings lookup failed, continuing without it:', scratchErr.message);
      }

      runners = fieldRunners
        .filter(r => !scratchedTabs.has(r.tabNo))
        .map(r => ({
          horse: r.name,
          jockey: (r.jockey && r.jockey.fullName) || '',
          weight: r.weight || '',
          barrier: r.barrier || '',
          form: (r.last10 || '').trim(),
          odds: 'n/a', // Punting Form doesn't provide market odds — that's Betfair's job, added later
        }));

      raceMeta = {
        track: (payload.track && payload.track.name) || track || '',
        distance: race.distance || distance || '',
        going: payload.expectedCondition || going || '',
        raceName: race.name || raceName || `Race ${raceNumber}`,
      };
    } else if (manualRunners && manualRunners.length >= 2) {
      // --- Manual entry path (what the current prototype uses) ---
      runners = manualRunners;
    } else {
      return res.status(400).json({ error: 'Provide a raceId or at least 2 manualRunners' });
    }

    // If we fetched via raceId, prefer Betfair's own race details;
    // otherwise use whatever the manual entry form sent.
    const meta = raceMeta || { track, distance, going, raceName };

    const runnerLines = runners
      .map(r => `- ${r.horse} | Jockey: ${r.jockey || 'n/a'} | Weight: ${r.weight || 'n/a'} | Barrier: ${r.barrier || 'n/a'} | Recent form: ${r.form || 'n/a'} | Odds: ${r.odds || 'n/a'}`)
      .join('\n');

    const prompt = `You are a horse racing form analyst. Analyze this race and rank the runners from most to least likely to win, based only on the data given. Be realistic — don't invent facts not provided. If odds are marked n/a, ignore them and reason from form, jockey, weight and barrier instead. If any of those are also blank, just work with whatever is actually provided.

Race: ${meta.raceName || 'Unnamed race'}
Track: ${meta.track || 'Unspecified'}
Distance: ${meta.distance || 'Unspecified'}
Going: ${meta.going || 'Unspecified'}

Runners:
${runnerLines}

Respond ONLY with a JSON array (no markdown, no commentary), one object per runner, ordered from most to least likely to win, in this exact shape:
[{"horse": "name", "confidence": 1-100, "reasoning": "1-2 sentence analysis"}]`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeResponse.json();
    const text = claudeData.content.map(b => b.text || '').join('\n');
    const clean = text.replace(/```json|```/g, '').trim();
    const picks = JSON.parse(clean);

    return res.status(200).json({ picks, runners, meta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
