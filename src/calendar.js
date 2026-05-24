const { google } = require("googleapis");
const { DateTime } = require("luxon");

function calendarClient(auth) {
  return google.calendar({ version: "v3", auth });
}

/**
 * Google Calendar prefers a "floating" local wall time plus `timeZone`,
 * rather than an offset embedded in `dateTime` together with `timeZone`.
 * @param {string} iso RFC3339 from Luxon, e.g. 2026-04-24T15:00:00.000-07:00
 * @param {string} timeZone IANA zone
 */
function toGoogleDateTime(iso, timeZone) {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) throw new Error("Invalid start or end time.");
  const local = dt.setZone(timeZone);
  if (!local.isValid) throw new Error(`Invalid time zone: ${timeZone}`);
  return {
    dateTime: local.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    timeZone,
  };
}

async function listPrimaryEventsInWindow(auth, { timeMin, timeMax }) {
  const cal = calendarClient(auth);
  /** @type {import("googleapis").calendar_v3.Schema$Event[]} */
  const all = [];
  let pageToken = /** @type {string | undefined} */ (undefined);

  do {
    // eslint-disable-next-line no-await-in-loop — Google pagination API
    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    all.push(...(resp.data.items ?? []));
    pageToken = resp.data.nextPageToken ?? undefined;
  } while (pageToken);

  return all;
}

async function hasConflict(auth, { startISO, endISO, timeZone }) {
  const cal = calendarClient(auth);
  const resp = await cal.freebusy.query({
    requestBody: {
      timeMin: startISO,
      timeMax: endISO,
      timeZone,
      items: [{ id: "primary" }],
    },
  });
  const busy = resp.data.calendars?.primary?.busy ?? [];
  return busy.length > 0;
}

async function createEvent(auth, { summary, description, startISO, endISO, timeZone }) {
  const cal = calendarClient(auth);
  const requestBody = {
    summary,
    start: toGoogleDateTime(startISO, timeZone),
    end: toGoogleDateTime(endISO, timeZone),
  };
  if (description) requestBody.description = description;

  const resp = await cal.events.insert({
    calendarId: "primary",
    requestBody,
  });
  return resp.data;
}

module.exports = { hasConflict, createEvent, listPrimaryEventsInWindow };

