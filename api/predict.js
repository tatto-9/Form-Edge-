// /api/predict — Vercel serverless function
// Runs on Vercel's server, never in the browser, so these env vars stay secret:
//   PUNTINGFORM_API_KEY  -> from Punting Form support
//   ANTHROPIC_API_KEY    -> from console.anthropic.com
//
// Set both in Vercel: Project Settings -> Environment Variables

const { pfGet } = require('../lib/puntingform');

function formatRecord(rec) {
  if (!rec || !rec.starts) return '';
  return `${rec.starts}: ${rec.firsts}-${rec.seconds}-${rec.thirds}`;
}

function formatA2E(stat) {
  if (!stat || stat.runners == null) return '';
  return `A2E ${stat.a2E.toFixed(2)}, ${stat.strikeRate.toFixed(1)}% strike rate (${stat.wins}/${stat.runners})`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const { raceId, manualRunners, track, distance, going, raceName } = req.body;

  try {
    let runners;
    let raceMeta;
    let rawRunners; // full, unfiltered Punting Form data for the prompt (raceId path only)
    let rawRace;

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
          trainer: (r.trainer && r.trainer.fullName) || '',
          age: r.age ?? '',
          sex: r.sex || '',
          weight: r.weight || '',
          weightTotal: r.weightTotal || '',
          barrier: r.barrier || '',
          form: (r.last10 || '').trim(),
          gearChanges: r.gearChanges || '',
          careerRecord: r.careerStarts != null
            ? `${r.careerStarts}: ${r.careerWins}-${r.careerSeconds}-${r.careerThirds} ($${r.prizeMoney ?? 0})`
            : '',
          trackRecord: formatRecord(r.trackRecord),
          distanceRecord: formatRecord(r.distanceRecord),
          trackDistRecord: formatRecord(r.trackDistRecord),
          firstUpRecord: formatRecord(r.firstUpRecord),
          secondUpRecord: formatRecord(r.secondUpRecord),
          jockeyA2ECareer: formatA2E(r.jockeyA2E_Career),
          trainerA2ECareer: formatA2E(r.trainerA2E_Career),
          trainerJockeyA2ECareer: formatA2E(r.trainerJockeyA2E_Career),
          jockeyA2ELast100: formatA2E(r.jockeyA2E_Last100),
          odds: 'n/a', // Punting Form doesn't provide market odds — that's Betfair's job, added later
        }));

      // Full raw data — everything Punting Form sent, minus only the
      // scratched runners, so nothing gets curated away from Claude.
      rawRunners = fieldRunners.filter(r => !scratchedTabs.has(r.tabNo));
      // The race object without its nested runners array, since that's
      // already being sent separately as rawRunners (avoids duplicating
      // the same runner data twice in the prompt).
      const { runners: _omit, ...raceWithoutRunners } = race;
      rawRace = raceWithoutRunners;

      raceMeta = {
        track: (payload.track && payload.track.name) || track || '',
        distance: race.distance || distance || '',
        going: payload.expectedCondition || going || '',
        raceName: race.name || raceName || `Race ${raceNumber}`,
        raceClass: race.raceClass || '',
        weightType: race.weightType || '',
        prizeMoney: race.prizeMoney || '',
        fieldSize: fieldRunners.length,
        jockeyRestrictions: race.jockeyRestrictions || '',
        ageRestrictions: race.ageRestrictions || '',
        sexRestrictions: race.sexRestrictions || '',
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

    const usingRawData = !!rawRunners;

    const runnerSection = usingRawData
      ? `Full raw data for every runner (JSON), including career and condition-specific records, A2E stats for jockey/trainer/combo, pedigree, gear changes, and everything else Punting Form provides:\n${JSON.stringify(rawRunners, null, 2)}`
      : `Runners:\n${runners.map(r => `- ${r.horse} | Jockey: ${r.jockey || 'n/a'} | Weight: ${r.weight || 'n/a'} | Barrier: ${r.barrier || 'n/a'} | Recent form: ${r.form || 'n/a'} | Odds: ${r.odds || 'n/a'}`).join('\n')}`;

    const raceSection = usingRawData
      ? `Full raw race data (JSON):\n${JSON.stringify(rawRace, null, 2)}`
      : `Race: ${meta.raceName || 'Unnamed race'}\nTrack: ${meta.track || 'Unspecified'}\nDistance: ${meta.distance || 'Unspecified'}\nGoing: ${meta.going || 'Unspecified'}`;

    const prompt = `You are a horse racing form analyst. Analyze this race and rank the runners from most to least likely to win, based only on the data given. Be realistic — don't invent facts not provided.

Weigh the data in this priority order, based on established handicapping principles:
1. Recent form trend (the "last10" string) and overall class level (raceClass vs. the horse's career earnings/record) — these are your best available proxies for speed and current ability, since this data source does not include a computed speed figure.
2. Distance/track/going-specific history — trackRecord, distanceRecord, trackDistRecord, and the condition-specific records (goodRecord/softRecord/heavyRecord/syntheticRecord) that match today's going. First-up/second-up record matters if the horse is fresh off a spell.
3. Jockey/trainer/combo A2E stats — a real but secondary signal. A2E above 1.0 means outperforming market expectation, below 1.0 underperforming. Don't let a strong A2E override poor recent form or an unsuitable class step.
4. Gear changes, weight, barrier, pedigree — minor factors, mainly useful as tie-breakers or in specific situations (e.g. wet-track pedigree when the going is soft/heavy).

Important limitation to keep in mind: this data source does not include pace/running-style tags or track bias information — both are considered major factors in professional handicapping (how the race is likely to be run, and whether the track is currently favoring front-runners or closers). You cannot factor these in, so don't invent a running style or bias assessment that isn't supported by the data. If the race genuinely hinges on pace or bias that you can't assess, factor that uncertainty into your verdict rather than guessing.

If odds are marked n/a, don't treat that as a signal either way. If any field is blank or zero from lack of data, treat it as unknown rather than a meaningful zero.

${raceSection}

${runnerSection}

Respond ONLY with a JSON object (no markdown, no commentary), in this exact shape:
{
  "verdict": "play" or "avoid",
  "verdictReason": "1-2 sentence explanation of the verdict",
  "picks": [{"horse": "name", "confidence": 1-100, "reasoning": "1-2 sentence analysis"}]
}
Order "picks" from most to least likely to win. Set "verdict" to "avoid" when the race is genuinely too unclear or even to call — e.g. no runner has a real edge, the field is wide open with no standout form, the outcome plausibly hinges on pace or track bias that you have no data for, or the data is too thin to say anything useful. A large field in a competitive handicap class is inherently harder to call than a small field or a maiden race — factor field size and class into how confident the verdict should be. Use "avoid" honestly; don't default to "play" just to give an answer.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeResponse.json();
    if (!claudeResponse.ok || !claudeData.content) {
      throw new Error(`Claude API error: ${claudeData.error ? claudeData.error.message : claudeResponse.status}`);
    }
    const text = claudeData.content.map(b => b.text || '').join('\n');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({
      verdict: parsed.verdict,
      verdictReason: parsed.verdictReason,
      picks: parsed.picks,
      runners,
      meta,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
