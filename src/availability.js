const { google } = require("googleapis");
const { DateTime } = require("luxon");

function calendarClient(auth) {
  return google.calendar({ version: "v3", auth });
}

/**
 * @returns {Promise<{ start: string, end: string }[]>}
 *   RFC3339 instants from Google FreeBusy (`primary`).
 */
async function queryFreeBusy(auth, { timeMin, timeMax, timeZone }) {
  const cal = calendarClient(auth);
  const resp = await cal.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      timeZone,
      items: [{ id: "primary" }],
    },
  });
  const busy = resp.data.calendars?.primary?.busy ?? [];
  return busy
    .map((b) => ({ start: b.start, end: b.end }))
    .filter((b) => b.start && b.end);
}

/** Merge overlapping/adjacent busy intervals (RFC3339 `start` / `end`). */
function mergeBusyIntervals(busy) {
  if (busy.length === 0) return [];
  const sorted = [...busy].sort((a, b) => a.start.localeCompare(b.start));
  const out = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    const prev = out[out.length - 1];
    const pe = DateTime.fromISO(prev.end);
    const cs = DateTime.fromISO(cur.start);
    const ce = DateTime.fromISO(cur.end);
    if (!pe.isValid || !cs.isValid || !ce.isValid) continue;
    if (cs <= pe) {
      if (ce > pe) prev.end = cur.end;
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/**
 * Subtract merged busy intervals from [windowStart, windowEnd].
 * Returns free gaps as Luxon `{ start: DateTime, end: DateTime }` (same zone context as ISO inputs).
 *
 * @param {{ start: string, end: string }[]} mergedBusy
 */
function busyToFreeSlots(mergedBusy, timeMinISO, timeMaxISO) {
  const windowStart = DateTime.fromISO(timeMinISO);
  const windowEnd = DateTime.fromISO(timeMaxISO);
  if (!windowStart.isValid || !windowEnd.isValid || windowEnd <= windowStart) {
    return [];
  }

  /** @type {{ start: DateTime, end: DateTime }[]} */
  const free = [];
  let cursor = windowStart;

  for (const block of mergedBusy) {
    const bs = DateTime.fromISO(block.start);
    const be = DateTime.fromISO(block.end);
    if (!bs.isValid || !be.isValid) continue;

    const gapEnd = bs < windowEnd ? bs : windowEnd;
    if (cursor < gapEnd && gapEnd > windowStart && cursor < windowEnd) {
      const a = cursor > windowStart ? cursor : windowStart;
      const b = gapEnd < windowEnd ? gapEnd : windowEnd;
      if (b > a) free.push({ start: a, end: b });
    }

    cursor = be > cursor ? be : cursor;
    if (cursor >= windowEnd) break;
  }

  if (cursor < windowEnd) {
    const a = cursor > windowStart ? cursor : windowStart;
    if (windowEnd > a) free.push({ start: a, end: windowEnd });
  }

  return free;
}

/**
 * FreeBusy window: start of tomorrow (local TZ) → end of day horizon days ahead (UTC instants).
 * @param {string} timeZone IANA
 * @param {number} horizonDays clamped [1, 31]
 */
function planningBoundsUTC(timeZone, horizonDays) {
  const safeDays = Math.min(Math.max(1, horizonDays | 0), 31);
  const now = DateTime.now().setZone(timeZone);
  const tomorrow = now.plus({ days: 1 }).startOf("day");
  const timeMin = tomorrow.toUTC().toISO();
  const timeMax = tomorrow
    .plus({ days: safeDays })
    .endOf("day")
    .toUTC()
    .toISO();
  return { timeMin, timeMax };
}

module.exports = {
  queryFreeBusy,
  mergeBusyIntervals,
  busyToFreeSlots,
  planningBoundsUTC,
};
