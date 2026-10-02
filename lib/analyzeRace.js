// lib/analyzeRace.js — the core race analysis logic: pulls Punting Form
// data, builds the prompt, calls Claude, and returns the verdict/picks.
// Used by both api/predict.js (one race) and the tip sheet, which calls
// api/predict.js once per race from the browser rather than a shared
// server-side loop.

const { pfGet } = require('./puntingform');

function formatRecord(rec) {
  if (!rec || !rec.starts) return '';
  return `${rec.starts}: ${rec.firsts}-${rec.seconds}-${rec.thirds}`;
}

function formatA2E(stat) {
  if (!stat || stat.runners == null) return '';
  return `A2E ${stat.a2E.toFixed(2)}, ${stat.strikeRate.toFixed(1)}% strike rate (${stat.wins}/${stat.runners})`;
}

async function analyzeRace({ raceId, manualRunners, track, distance, going, raceName }) {
  let runners;
  let raceMeta;
  let rawRunners; // full, unfiltered Punting Form data for the prompt (raceId path only)
  let rawRace;
  let speedMap;
  let liveConditions;

  if (raceId) {
    // --- Live data path: raceId is "meetingId|raceNumber" ---
    const [meetingId, raceNumber] = raceId.split('|');

    // These four Punting Form lookups don't depend on each other, so
    // they're fired off together instead of one after another. Chained
    // sequential awaits here were adding up to several seconds each and
    // pushing some races past Vercel's execution time limit, which shows
    // up to the browser as a non-JSON "An error occurred with your
    // deployment" page instead of a real error. Each one is still
    // best-effort: a failure in any of them just means we continue
    // without that piece of data rather than breaking the whole race.
    const [fieldsResult, scratchResult, speedMapResult, conditionsResult] = await Promise.allSettled([
      pfGet('/form/fields', { meetingId, raceNumber }),
      pfGet('/Updates/Scratchings', {}),
      pfGet('/User/Speedmaps', { meetingId, raceNo: raceNumber }),
      pfGet('/Updates/Conditions', {}),
    ]);

    if (fieldsResult.status !== 'fulfilled') {
      throw fieldsResult.reason;
    }
    const fieldsData = fieldsResult.value;

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
    if (scratchResult.status === 'fulfilled') {
      try {
        const scratchings = scratchResult.value.payLoad || [];
        scratchedTabs = new Set(
          scratchings
            .filter(s => String(s.meetingId) === String(meetingId)
              && String(s.raceNumber ?? s.number) === String(raceNumber))
            .map(s => s.tabNo)
        );
      } catch (scratchErr) {
        console.error('Scratchings parsing failed, continuing without it:', scratchErr.message);
      }
    } else {
      console.error('Scratchings lookup failed, continuing without it:', scratchResult.reason.message);
    }

    // Speed map: run-style/barrier-based positional advantage per runner.
    // Best-effort, same as scratchings — the exact response shape hasn't
    // been confirmed against real data, so if it fails or doesn't match,
    // we continue without it rather than breaking the whole race.
    speedMap = null;
    if (speedMapResult.status === 'fulfilled') {
      speedMap = speedMapResult.value.payLoad || null;
    } else {
      console.error('Speed map lookup failed, continuing without it:', speedMapResult.reason.message);
    }

    // Live conditions (track grading + weather): this endpoint returns
    // conditions for ALL upcoming meetings in one call (no meetingId
    // filter), so we match the one for our meeting afterward. Best-effort,
    // same pattern as scratchings/speedmaps.
    liveConditions = null;
    if (conditionsResult.status === 'fulfilled') {
      try {
        const allConditions = conditionsResult.value.payLoad || [];
        liveConditions = allConditions.find(
          c => String(c.meetingId) === String(meetingId)
        ) || null;
      } catch (conditionsErr) {
        console.error('Conditions parsing failed, continuing without it:', conditionsErr.message);
      }
    } else {
      console.error('Conditions lookup failed, continuing without it:', conditionsResult.reason.message);
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
      }));

    // Full raw data — everything Punting Form sent, minus only the
    // scratched runners, so nothing gets curated away from Claude.
    rawRunners = fieldRunners
      .filter(r => !scratchedTabs.has(r.tabNo));
    // The race object without its nested runners array, since that's
    // already being sent separately as rawRunners (avoids duplicating
    // the same runner data twice in the prompt).
    const { runners: _omit, ...raceWithoutRunners } = race;
    rawRace = raceWithoutRunners;

    raceMeta = {
      track: (payload.track && payload.track.name) || track || '',
      distance: race.distance || distance || '',
      going: (liveConditions && (liveConditions.trackCondition || liveConditions.rating))
        || payload.expectedCondition || going || '',
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
    // --- Manual entry path ---
    runners = manualRunners;
  } else {
    throw new Error('Provide a raceId or at least 2 manualRunners');
  }

  const meta = raceMeta || { track, distance, going, raceName };

  const usingRawData = !!rawRunners;

  const runnerSection = usingRawData
    ? `Full raw data for every runner (JSON), including career and condition-specific records, A2E stats for jockey/trainer/combo, pedigree, gear changes, and everything else Punting Form provides:\n${JSON.stringify(rawRunners, null, 2)}`
    : `Runners:\n${runners.map(r => `- ${r.horse} | Jockey: ${r.jockey || 'n/a'} | Weight: ${r.weight || 'n/a'} | Barrier: ${r.barrier || 'n/a'} | Recent form: ${r.form || 'n/a'}`).join('\n')}`;

  const raceSection = usingRawData
    ? `Full raw race data (JSON):\n${JSON.stringify(rawRace, null, 2)}`
    : `Race: ${meta.raceName || 'Unnamed race'}\nTrack: ${meta.track || 'Unspecified'}\nDistance: ${meta.distance || 'Unspecified'}\nGoing: ${meta.going || 'Unspecified'}`;

  const speedMapSection = speedMap
    ? `\n\nSpeed map (run-style and barrier-based positional advantage per runner — reflects how the race is likely to be run and who's favoured or disadvantaged by their expected running position):\n${JSON.stringify(speedMap, null, 2)}`
    : '';

  const conditionsSection = liveConditions
    ? `\n\nLive track conditions update (most current track grading/weather for this meeting, may be more up to date than the race's listed going):\n${JSON.stringify(liveConditions, null, 2)}`
    : '';

  const prompt = `You are a horse racing form analyst. Analyze this race and rank the runners from most to least likely to win, based only on the data given. Be realistic — don't invent facts not provided.

Weigh the data in this priority order, based on established handicapping principles:
1. Recent form trend (the "last10" string) and overall class level (raceClass vs. the horse's career earnings/record) — your best available proxies for speed and current ability, since raw speed figures aren't provided.
2. ${speedMap ? 'The speed map — how the race is likely to be run, and which runners are positionally favoured or disadvantaged by their expected running style and barrier. Pace shape and track bias are major factors in professional handicapping, so weigh this heavily when the speed map data is clear.' : 'Pace/running-style and track bias would normally be a major factor here, but no speed map data was available for this race — don\'t invent a running style or bias assessment that isn\'t supported by the data, and factor that gap into your confidence.'}
3. Distance/track/going-specific history — trackRecord, distanceRecord, trackDistRecord, and the condition-specific records (goodRecord/softRecord/heavyRecord/syntheticRecord) that match today's going. First-up/second-up record matters if the horse is fresh off a spell.
4. Jockey/trainer/combo A2E stats — a real but secondary signal. A2E above 1.0 means outperforming market expectation, below 1.0 underperforming. Don't let a strong A2E override poor recent form or an unsuitable class step.
5. Gear changes, weight, barrier, pedigree — minor factors, mainly useful as tie-breakers or in specific situations (e.g. wet-track pedigree when the going is soft/heavy).

If any field is blank or zero from lack of data, treat it as unknown rather than a meaningful zero.

${raceSection}${speedMapSection}${conditionsSection}

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
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const claudeData = await claudeResponse.json();
  if (!claudeResponse.ok || !claudeData.content) {
    throw new Error(`Claude API error: ${claudeData.error ? claudeData.error.message : claudeResponse.status}`);
  }
  const text = claudeData.content.map(b => b.text || '').join('\n');
  const clean = text.replace(/```json|```/g, '').trim();

  // Parsing is wrapped because on some races (usually large fields with a
  // lot of raw data) Claude's reply either gets cut off before the closing
  // brace (hits the token limit) or has a stray sentence before/after the
  // JSON. We try a straight parse first, then fall back to extracting just
  // the {...} block, and finally throw an error with enough detail (why it
  // failed, plus a snippet of what came back) to actually debug instead of
  // a bare "Unexpected token" message.
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (firstErr) {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        parsed = JSON.parse(clean.slice(start, end + 1));
      } catch (secondErr) {
        // fall through to the error below
      }
    }
    if (!parsed) {
      const truncated = claudeData.stop_reason === 'max_tokens';
      const snippet = clean.length > 400 ? `${clean.slice(0, 200)} ... ${clean.slice(-200)}` : clean;
      throw new Error(
        `Couldn't parse Claude's response as JSON${truncated ? ' (response was cut off — hit the token limit)' : ''}: ${firstErr.message}. Raw reply: ${snippet}`
      );
    }
  }

  return {
    verdict: parsed.verdict,
    verdictReason: parsed.verdictReason,
    picks: parsed.picks,
    runners,
    meta,
  };
}

module.exports = { analyzeRace };
