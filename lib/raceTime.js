// lib/raceTime.js — helpers for correctly handling Australian race times.
//
// The core problem: Vercel's servers run in UTC, but Punting Form's dates
// and times are Australian wall-clock time (e.g. "9/19/2026 10:35:00 AM"
// for a track in Sydney). Parsing that string directly with `new Date(...)`
// interprets it as the SERVER's local time (UTC), not Australian time —
// silently shifting every comparison by 10-11 hours depending on daylight
// saving. This affects both "what's today's date" and "has this race
// already started" logic, so both are handled here in one place.

function todayInSydney(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // en-US specifically for the 3-letter month abbreviation Punting Form
  // expects (en-AU abbreviates September as "Sept", not "Sep") — the
  // timeZone option below is what actually matters for getting the
  // correct Australian calendar date, independent of locale.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(d);
  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value;
  const year = parts.find(p => p.type === 'year').value;
  return `${day}-${month}-${year}`; // e.g. "19-Sep-2026" — what Punting Form expects
}

function nowInSydneySortable() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

// Converts Punting Form's "M/D/YYYY h:mm:ss AM/PM" string (Australian
// wall-clock time) into a sortable "YYYY-MM-DD HH:mm:ss" string, without
// letting Date's own timezone interpretation get involved.
function raceStartSortable(startTimeStr) {
  if (!startTimeStr) return null;
  const m = startTimeStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let [, month, day, year, hour, min, sec, ampm] = m;
  hour = parseInt(hour, 10);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  const pad = n => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${min}:${sec}`;
}

function raceHasStarted(startTimeStr) {
  const raceSortable = raceStartSortable(startTimeStr);
  if (!raceSortable) return false; // unknown time — don't filter it out
  return raceSortable < nowInSydneySortable();
}

module.exports = { todayInSydney, raceHasStarted };
