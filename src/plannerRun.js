const { DateTime } = require("luxon");
const { planningBoundsUTC, queryFreeBusy, mergeBusyIntervals, busyToFreeSlots } = require("./availability");
const { proposeTasks } = require("./llmPlan");
const { scheduleTasks } = require("./scheduleTasks");
const { hasConflict } = require("./calendar");
const { pendingPlanItemSchema } = require("./planSchema");
const { googleAuthNeedsReconnect } = require("./googleErrors");
const { buildPreferenceOverlapNote } = require("./plannerSchedulingNote");

function prependCalendarNote(note, assistantText) {
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (!trimmed) return assistantText;
  return `${trimmed}\n\n${assistantText}`;
}

function totalFreeMinutes(freeSlots) {
  let m = 0;
  for (const s of freeSlots) {
    m += Math.max(0, s.end.diff(s.start).as("minutes"));
  }
  return Math.floor(m);
}

function formatPreviewRow(item) {
  const tz = item.timeZone;
  const s = DateTime.fromISO(item.startISO).setZone(tz).toFormat("ccc, MMM d — h:mm a");
  const e = DateTime.fromISO(item.endISO).setZone(tz).toFormat("h:mm a");
  return { title: item.title, startLocal: s, endLocal: e };
}

/**
 * @returns {Promise<{ ok: false, assistantText: string } | { ok: true, items: object[], assistantText: string, previewRows: object[]}>}
 */
async function runPlanningPipeline(auth, env, userMessage) {
  const timeZone = env.DEFAULT_TIME_ZONE;
  const horizon = env.PLANNING_HORIZON_DAYS;

  try {
    const { timeMin, timeMax } = planningBoundsUTC(timeZone, horizon);
    const busy = await queryFreeBusy(auth, {
      timeMin,
      timeMax,
      timeZone,
    });
    const mergedBusy = mergeBusyIntervals(busy);
    const free = busyToFreeSlots(mergedBusy, timeMin, timeMax);

    if (free.length === 0 || totalFreeMinutes(free) < 30) {
      return {
        ok: false,
        assistantText:
          "Google Calendar doesn’t show enough open time in this window — try shortening tasks, freeing commitments, or we can widen the horizon with PLANNING_HORIZON_DAYS (server setting).",
      };
    }

    const tasks = await proposeTasks(
      { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
      {
        timezone: timeZone,
        horizonDays: horizon,
        mergedBusyIntervals: mergedBusy,
        userMessage,
      }
    );

    if (!tasks.length) {
      return {
        ok: false,
        assistantText:
          "I couldn’t map that into work blocks yet. Mention the outcome you want plus rough session lengths (reading vs coding vs writing).",
      };
    }

    let prefOverlapNote = "";
    try {
      prefOverlapNote = await buildPreferenceOverlapNote(auth, {
        tasks,
        mergedBusy,
        timeMin,
        timeMax,
        timeZone,
      });
    } catch {
      prefOverlapNote = "";
    }

    const draft = scheduleTasks(tasks, free, {
      timeZone,
      gridMinutes: 15,
      maxAssignments: 16,
    });

    /** @type {typeof draft} */
    const verified = [];
    for (const slot of draft) {
      // eslint-disable-next-line no-await-in-loop
      const bad = await hasConflict(auth, {
        startISO: slot.startISO,
        endISO: slot.endISO,
        timeZone: slot.timeZone,
      });
      if (!bad) verified.push(slot);
    }

    const dropped = draft.length - verified.length;

    if (!verified.length) {
      const suffix =
        dropped > 0 ?
          ` (${dropped} blocks still overlapped the calendar after a second check.)`
        : "";
      return {
        ok: false,
        assistantText: prependCalendarNote(
          prefOverlapNote,
          `Draft times still conflict somewhere on your Calendar.${suffix} Try narrower tasks.`
        ),
      };
    }

    /** @type {object[]} */
    const items = [];
    for (const slot of verified) {
      const p = pendingPlanItemSchema.safeParse(slot);
      if (p.success) items.push(p.data);
    }

    const previewRows = verified.map(formatPreviewRow);
    const fitNote =
      verified.length < tasks.length ?
        `Fit ${verified.length}/${tasks.length} tasks into openings.${dropped ? ` (${dropped} overlaps dropped.)` : ""}`
      : "";

    const taskListPreview = verified
      .slice(0, 6)
      .map((s) =>
        `- ${DateTime.fromISO(s.startISO).setZone(timeZone).toFormat("ccc h:mm a")}→${DateTime.fromISO(s.endISO).setZone(timeZone).toFormat("h:mm a")}: ${s.title}`
      )
      .join("\n");

    const tail = verified.length > 6 ? `\n⋯ +${verified.length - 6} more in preview.` : "";

    const assistantText = prependCalendarNote(
      prefOverlapNote,
      [fitNote, "Draft slots (needs Confirm)", taskListPreview + tail].filter(Boolean).join("\n\n")
    );

    return { ok: true, items, assistantText, previewRows };
  } catch (err) {
    if (googleAuthNeedsReconnect(err)) {
      return {
        ok: false,
        assistantText:
          "Google Calendar access expired or was revoked. Disconnect Google (top of the page), then connect again and resend your plan.",
      };
    }

    const code = /** @type {{ code?: string; activationUrl?: string }} */ (err)?.code;
    if (code === "GEMINI_API_DISABLED") {
      const url =
        /** @type {{ activationUrl?: string }} */ (err).activationUrl
        ?? "https://aistudio.google.com/apikey";
      return {
        ok: false,
        assistantText:
          `Gemini is free to turn on for normal dev use, but your API key’s Google Cloud project must enable the “Gemini API” (Generative Language API) once — that’s not the same as turning on paid billing.\n\n` +
          `Open this link while signed into the same Google account you used for the key, click Enable, wait 1–2 minutes, then try again:\n${url}\n\n` +
          `Or create a fresh key in Google AI Studio (https://aistudio.google.com/apikey) after enabling the API for the project it shows there.`,
      };
    }
    if (code === "LLM_UNAVAILABLE" || code === "LLM_PARSE" || code === "LLM_VALIDATE") {
      return {
        ok: false,
        assistantText: `Planner model issue: ${/** @type {Error} */ (err).message} If API quota resets, retry later.`,
      };
    }
    // eslint-disable-next-line no-console
    console.error("Planning pipeline:", err?.response?.data ?? err);
    return {
      ok: false,
      assistantText:
        "Something broke while planning. Retry shortly or shorten the message.",
    };
  }
}

module.exports = { runPlanningPipeline, formatPreviewRow };
