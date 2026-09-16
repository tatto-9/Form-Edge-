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

    const runnerLines = runners
      .map(r => {
        // Manual entry runners only have the basic fields — keep it simple
        // for those. Live (Punting Form) runners get the full picture.
        if (!r.trainer && !r.careerRecord) {
          return `- ${r.horse} | Jockey: ${r.jockey || 'n/a'} | Weight: ${r.weight || 'n/a'} | Barrier: ${r.barrier || 'n/a'} | Recent form: ${r.form || 'n/a'} | Odds: ${r.odds || 'n/a'}`;
        }
        const extras = [
          r.trainer && `Trainer: ${r.trainer}`,
          (r.age || r.sex) && `${r.age || '?'}yo ${r.sex || ''}`.trim(),
          r.weightTotal && r.weightTotal !== r.weight && `Weight: ${r.weight}kg (allocated ${r.weightTotal}kg)`,
          r.careerRecord && `Career: ${r.careerRecord}`,
          r.trackRecord && `Track record: ${r.trackRecord}`,
          r.distanceRecord && `Distance record: ${r.distanceRecord}`,
          r.trackDistRecord && `Track+distance record: ${r.trackDistRecord}`,
          r.firstUpRecord && `First-up record: ${r.firstUpRecord}`,
          r.secondUpRecord && `Second-up record: ${r.secondUpRecord}`,
          r.jockeyA2ECareer && `Jockey A2E (career): ${r.jockeyA2ECareer}`,
          r.trainerA2ECareer && `Trainer A2E (career): ${r.trainerA2ECareer}`,
          r.trainerJockeyA2ECareer && `Trainer+jockey combo A2E: ${r.trainerJockeyA2ECareer}`,
          r.jockeyA2ELast100 && `Jockey A2E (last 100 rides): ${r.jockeyA2ELast100}`,
          r.gearChanges && `Gear changes: ${r.gearChanges}`,
        ].filter(Boolean).join(' | ');

        return `- ${r.horse} | Jockey: ${r.jockey || 'n/a'} | Weight: ${r.weight || 'n/a'} | Barrier: ${r.barrier || 'n/a'} | Recent form: ${r.form || 'n/a'} | Odds: ${r.odds || 'n/a'} | ${extras}`;
      })
      .join('\n');

    const prompt = `You are a horse racing form analyst. Analyze this race and rank the runners from most to least likely to win, based only on the data given. Be realistic — don't invent facts not provided. If odds are marked n/a, ignore them and reason from form, jockey, trainer, career/track/distance records, and A2E stats instead. A2E (Actual-vs-Expected) above 1.0 means a jockey/trainer outperforms market expectation; below 1.0 means they underperform it — weigh this alongside raw strike rate. Note any gear changes, as they can signal a meaningful adjustment. If any field is blank, just work with whatever is actually provided.

Race: ${meta.raceName || 'Unnamed race'}
Track: ${meta.track || 'Unspecified'}
Distance: ${meta.distance || 'Unspecified'}
Going: ${meta.going || 'Unspecified'}${meta.raceClass ? `\nClass: ${meta.raceClass}` : ''}${meta.weightType ? `\nWeight type: ${meta.weightType}` : ''}${meta.fieldSize ? `\nField size: ${meta.fieldSize} runners` : ''}${meta.prizeMoney ? `\nPrize money: $${meta.prizeMoney}` : ''}${meta.jockeyRestrictions ? `\nRestrictions: ${meta.jockeyRestrictions}` : ''}${meta.ageRestrictions ? ` ${meta.ageRestrictions}` : ''}${meta.sexRestrictions ? ` ${meta.sexRestrictions}` : ''}

Runners:
${runnerLines}

Respond ONLY with a JSON object (no markdown, no commentary), in this exact shape:
{
  "verdict": "play" or "avoid",
  "verdictReason": "1-2 sentence explanation of the verdict",
  "picks": [{"horse": "name", "confidence": 1-100, "reasoning": "1-2 sentence analysis"}]
}
Order "picks" from most to least likely to win. Set "verdict" to "avoid" when the race is genuinely too unclear or even to call — e.g. no runner has a real edge, the field is wide open with no standout form, or the data is too thin to say anything useful. A large field in a competitive handicap class is inherently harder to call than a small field or a maiden race — factor field size and class into how confident the verdict should be. Use "avoid" honestly; don't default to "play" just to give an answer.`;

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
