const { DateTime } = require("luxon");
const { listPrimaryEventsInWindow } = require("./calendar");
const { PREFERENCE_LABEL, PREFERENCE_START_BAND_MINUTES } = require("./preferenceBands");

/** @typedef {{ id: string, summary: string, start: import("luxon").DateTime, endExclusive: import("luxon").DateTime, allDay: boolean }} ParsedEv */

function englishOxfordList(words) {
  const w = words.filter(Boolean);
  if (w.length === 0) return "";
  if (w.length === 1) return w[0];
  if (w.length === 2) return `${w[0]} and ${w[1]}`;
  return `${w.slice(0, -1).join(", ")}, and ${w[w.length - 1]}`;
}

/**
 * Half-open interval `[start, endExclusive)` intersects some local wall span `[day+bandLo, day+bandHi)` per calendar day (in `tz`).
 */
function intervalTouchesLocalMinuteBand(startDT, endExclusiveDT, tz, band) {
  const [loInc, hiEx] = band;
  let dayCursor = startDT.setZone(tz).startOf("day");
  const lastDay = endExclusiveDT.minus({ milliseconds: 1 }).setZone(tz).startOf("day");
  if (!(dayCursor.isValid && lastDay.isValid)) return false;

  while (dayCursor <= lastDay) {
    const winS = dayCursor.plus({ minutes: loInc });
    const winE = dayCursor.plus({ minutes: hiEx });
    const a = DateTime.max(startDT.setZone(tz), winS);
    const b = DateTime.min(endExclusiveDT.setZone(tz), winE);
    if (b > a) return true;
    dayCursor = dayCursor.plus({ days: 1 });
  }
  return false;
}

/**
 * @param {import("googleapis").calendar_v3.Schema$Event} ev
 */
function parseCalendarEvent(ev, primaryTz) {
  if (!ev || ev.status === "cancelled") return null;
  const s = /** @type {import("googleapis").calendar_v3.Schema$EventDateTime | undefined} */ (ev.start);
  const ex = /** @type {import("googleapis").calendar_v3.Schema$EventDateTime | undefined} */ (ev.end);
  if (!s || !ex) return null;

  const id =
    typeof ev.id === "string" && ev.id.length > 0
      ? ev.id
      : `${ev.summary ?? "?"}:${s.date ?? s.dateTime}`;

  if (s.date && ex.date) {
    const dayStart = DateTime.fromISO(s.date, { zone: primaryTz }).startOf("day");
    const dayEndExclusive = DateTime.fromISO(ex.date, { zone: primaryTz }).startOf("day");
    if (!(dayStart.isValid && dayEndExclusive.isValid) || dayEndExclusive <= dayStart) return null;

    /** @type {ParsedEv} */
    const parsed = {
      id,
      summary: typeof ev.summary === "string" && ev.summary.trim() ? ev.summary.trim() : "(no title)",
      start: dayStart,
      endExclusive: dayEndExclusive,
      allDay: true,
    };
    return parsed;
  }

  if (typeof s.dateTime === "string" && typeof ex.dateTime === "string") {
    const tz = typeof s.timeZone === "string" && s.timeZone.trim() ? s.timeZone : primaryTz;
    const start = DateTime.fromISO(s.dateTime, { setZone: true });
    const endExclusive = DateTime.fromISO(ex.dateTime, { setZone: true });
    const startTz = start.setZone(tz);
    const endExTz = endExclusive.setZone(tz);
    if (!(startTz.isValid && endExTz.isValid) || endExTz <= startTz) return null;

    /** @type {ParsedEv} */
    const parsed = {
      id,
      summary: typeof ev.summary === "string" && ev.summary.trim() ? ev.summary.trim() : "(no title)",
      start: startTz,
      endExclusive: endExTz,
      allDay: false,
    };
    return parsed;
  }

  return null;
}

/**
 * @param {ParsedEv} ev
 */
function formatEventBullet(ev, prefsHit, tz) {
  let when;
  const s = ev.start.setZone(tz);
  if (ev.allDay) when = `${s.toFormat("ccc, MMM d — all-day")}`;
  else {
    const endIncl = ev.endExclusive.minus({ milliseconds: 1 }).setZone(tz);
    if (s.hasSame(endIncl, "day"))
      when = `${s.toFormat("ccc MMM d, h:mm a")} – ${endIncl.toFormat("h:mm a")}`;
    else
      when = `${s.toFormat("ccc MMM d, h:mm a")} – ${endIncl.toFormat("ccc MMM d, h:mm a")}`;
  }

  const uniq = [...new Set(prefsHit.map((p) => PREFERENCE_LABEL[p] ?? p))];
  const tag = uniq.length ? ` (overlaps ${englishOxfordList(uniq)})` : "";
  return `• ${when} — ${ev.summary}${tag}`;
}

/**
 * @returns {Set<string>}
 */
function uniquePrefsFromTasks(tasks) {
  const seen = /** @type {Set<string>} */ (new Set());
  for (const t of tasks) {
    const p =
      t && typeof t.preferredTimeOfDay === "string" ? String(t.preferredTimeOfDay).toLowerCase().trim()
      : "anytime";
    if (p === "anytime") continue;
    if (!Object.prototype.hasOwnProperty.call(PREFERENCE_START_BAND_MINUTES, p)) continue;
    seen.add(p);
  }
  return seen;
}

/**
 * When tasks mention mornings/afternoons/evenings, surface existing primary-calendar items overlapping those stretches.
 *
 * @param {*} auth Authenticated OAuth2 google client-compatible object
 */
async function buildPreferenceOverlapNote(auth, { tasks, mergedBusy, timeMin, timeMax, timeZone }) {
  const prefs = [...uniquePrefsFromTasks(tasks)];
  if (!prefs.length) return "";

  let rawEv = [];
  try {
    rawEv = await listPrimaryEventsInWindow(auth, { timeMin, timeMax });
  } catch {
    rawEv = [];
  }

  const parsed = [];
  for (const ev of rawEv) {
    const p = parseCalendarEvent(ev, timeZone);
    if (p) parsed.push(p);
  }

  /** @type {string[]} */
  const lines = [];
  const usedEventIds = /** @type {Set<string>} */ (new Set());

  for (const ev of parsed) {
    /** @type {string[]} */
    const hitPrefs = [];
    for (const pref of prefs) {
      const band = PREFERENCE_START_BAND_MINUTES[pref];
      if (
        intervalTouchesLocalMinuteBand(ev.start, ev.endExclusive, timeZone, band)
      ) hitPrefs.push(pref);
    }

    if (hitPrefs.length === 0) continue;
    if (usedEventIds.has(ev.id)) continue;
    usedEventIds.add(ev.id);
    lines.push(formatEventBullet(ev, hitPrefs, timeZone));
  }

  /** @type {string[]} */
  const busyLines = [];
  if (lines.length === 0 && Array.isArray(mergedBusy) && mergedBusy.length > 0) {
    let n = 0;
    const maxBusyUi = 8;
    for (const blk of mergedBusy) {
      if (n >= maxBusyUi) break;
      if (!blk?.start || !blk?.end) continue;
      const bs = DateTime.fromISO(String(blk.start));
      const beEx = DateTime.fromISO(String(blk.end));
      if (!(bs.isValid && beEx.isValid) || beEx <= bs) continue;

      const hitPrefs = [];
      for (const pref of prefs) {
        const band = PREFERENCE_START_BAND_MINUTES[pref];
        if (intervalTouchesLocalMinuteBand(bs, beEx, timeZone, band)) hitPrefs.push(pref);
      }

      if (hitPrefs.length === 0) continue;

      const s = bs.setZone(timeZone);
      const eInc = beEx.minus({ milliseconds: 1 }).setZone(timeZone);
      let when = "";
      if (s.hasSame(eInc, "day"))
        when = `${s.toFormat("ccc MMM d, h:mm a")} – ${eInc.toFormat("h:mm a")}`;
      else when = `${s.toFormat("ccc MMM d, h:mm a")} – ${eInc.toFormat("ccc MMM d, h:mm a")}`;
      const labels = [...new Set(hitPrefs.map((p) => PREFERENCE_LABEL[p] ?? p))];

      busyLines.push(
        `• ${when} — busy / unavailable (${englishOxfordList(labels)})`
      );

      n += 1;
    }
  }

  if (lines.length === 0 && busyLines.length === 0) return "";

  const labelWords = prefs.map((p) => PREFERENCE_LABEL[p] ?? p);
  const headline = `Calendar note — you mentioned working in the ${englishOxfordList(labelWords)}. Here’s what’s already on your primary calendar in those stretches:`;

  const body = [...lines, ...busyLines].slice(0, 24).join("\n");
  const ask =
    "If you’d rather bias toward a different part of the day (mornings / afternoons / evenings / nights), say so and Send again—we’ll reshuffle around your preferences.\n(This note is only for overlaps with the time-of-day words you hinted; the draft below still avoids double-bookings.)";

  return [headline, body, ask].join("\n\n").trim();
}

module.exports = {
  buildPreferenceOverlapNote,
};
