const { DateTime } = require("luxon");

function parseDateYYYYMMDD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function hour12To24(h12, ampm) {
  const h = Number(h12);
  const a = String(ampm).toUpperCase();
  if (!Number.isInteger(h) || h < 1 || h > 12) return null;
  if (a !== "AM" && a !== "PM") return null;
  if (a === "AM") return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

/**
 * @param {{ date: string, hour12: string|number, minute: string|number, ampm: string }} parts
 * @param {string} timeZone IANA zone, e.g. America/Los_Angeles
 * @returns {{ ok: true, iso: string } | { ok: false, error: string }}
 */
function wallTimeToISO(parts, timeZone) {
  const d = parseDateYYYYMMDD(parts.date);
  if (!d) return { ok: false, error: "Invalid start or end date." };

  const h24 = hour12To24(parts.hour12, parts.ampm);
  if (h24 === null) return { ok: false, error: "Invalid start or end time (use 1–12 and AM/PM)." };

  const min = Number(parts.minute);
  if (!Number.isInteger(min) || min < 0 || min > 59) {
    return { ok: false, error: "Minutes must be between 0 and 59." };
  }

  const dt = DateTime.fromObject(
    { year: d.year, month: d.month, day: d.day, hour: h24, minute: min, second: 0 },
    { zone: timeZone }
  );
  if (!dt.isValid) return { ok: false, error: "That date/time is not valid in the selected time zone." };

  return { ok: true, iso: dt.toISO() };
}

module.exports = { wallTimeToISO };
