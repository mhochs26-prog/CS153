const { PREFERENCE_START_BAND_MINUTES } = require("./preferenceBands");

const DAY_TOKEN_TO_LUXON = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

/**
 * Remove `[rs, re)` from disjoint free intervals.
 * @param {{ start: DateTime, end: DateTime }[]} slots
 */
function subtractInterval(slots, rs, re) {
  /** @type {{ start: DateTime, end: DateTime }[]} */
  const out = [];
  for (const slot of slots) {
    const s = slot.start;
    const e = slot.end;
    if (!(s.isValid && e.isValid) || e <= s) continue;
    if (re <= s || rs >= e) {
      out.push({ start: s, end: e });
      continue;
    }
    if (s < rs) out.push({ start: s, end: rs });
    if (re < e) out.push({ start: re, end: e });
  }
  return out.filter((seg) => seg.end > seg.start);
}

function minuteFromLocalMidnight(candidate, tz) {
  const l = candidate.setZone(tz);
  return l.hour * 60 + l.minute;
}

/**
 * Snap `wall` (already in TZ) forward to next grid-aligned minute (:00,:15,...).
 */
function ceilToGridMinute(wallDT, gridMinutes) {
  const d = wallDT.set({ second: 0, millisecond: 0 });
  if (!d.isValid) return null;
  const minuteOfDay = d.hour * 60 + d.minute;
  const remainder = minuteOfDay % gridMinutes;
  if (remainder === 0) return d;
  return d.plus({ minutes: gridMinutes - remainder });
}

/**
 * Choose first grid-aligned `{start,end}` inside `slotTZ` where `(end-start)=needMinutes`.
 * @param {[number, number] | null} startBand Minutes from local midnight `[lo, hi)` constraining **start only** (`null` = any start).
 */
function carveFirstFit(slotTZ, needMinutes, gridMinutes, timeZone, startBand) {
  let candidate = slotTZ.start.set({ second: 0, millisecond: 0 });
  const ceil0 = ceilToGridMinute(candidate, gridMinutes);
  if (ceil0 && ceil0 >= slotTZ.start) candidate = ceil0;

  const spanMin = slotTZ.end.diff(slotTZ.start).as("minutes");
  const maxIterations =
    Math.max(
      500,
      Math.min(
        20000,
        Math.ceil(spanMin / gridMinutes) + (startBand ? 4000 : 80)
      )
    );

  for (let i = 0; i < maxIterations && candidate < slotTZ.end; i += 1) {
    const mdLocal = minuteFromLocalMidnight(candidate, timeZone);
    const inBand =
      !Array.isArray(startBand)
      || startBand.length !== 2
      || (mdLocal >= startBand[0] && mdLocal < startBand[1]);
    if (!inBand) {
      candidate = candidate.plus({ minutes: gridMinutes });
      continue;
    }

    const endAt = candidate.plus({ minutes: needMinutes });
    if (endAt <= slotTZ.end && candidate >= slotTZ.start) {
      return { start: candidate, end: endAt };
    }
    candidate = candidate.plus({ minutes: gridMinutes });
  }

  return null;
}

/**
 * @param {{ durationMinutes: number, title: string, description?: string, preferredDayOfWeek?: string, preferredTimeOfDay?: string }[]} tasks
 * @param {{ start: DateTime, end: DateTime }[]} freeSlots
 */
function scheduleTasks(tasks, freeSlots, opts) {
  const { timeZone, gridMinutes = 15, maxAssignments = 20 } = opts;

  let remaining = freeSlots
    .map((s) => ({
      start: s.start.setZone(timeZone),
      end: s.end.setZone(timeZone),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());

  /** @type {{ title: string, description?: string, startISO: string, endISO: string, timeZone: string }[]} */
  const assignments = [];

  function tryAssignTask(task, /** @type {boolean} */ honorTimeOfDay) {
    const need = Math.min(
      Math.max(15, Math.ceil(task.durationMinutes / gridMinutes) * gridMinutes),
      8 * 60
    );

    const prefN =
      task.preferredDayOfWeek && DAY_TOKEN_TO_LUXON[task.preferredDayOfWeek] != null ?
        DAY_TOKEN_TO_LUXON[task.preferredDayOfWeek]
      : null;

    const tod = typeof task.preferredTimeOfDay === "string" ? task.preferredTimeOfDay.toLowerCase() : "anytime";

    /** Prefer matching this loose **start-only** band first; blocks may run as long as the slot allows afterward. */
    let appliedStartBand = null;
    if (honorTimeOfDay && tod !== "anytime") {
      const mb = PREFERENCE_START_BAND_MINUTES[tod];
      if (Array.isArray(mb)) appliedStartBand = mb;
    }

    const indices = [...remaining.keys()].sort((ai, bi) => {
      if (prefN != null) {
        const apt = prefN === remaining[ai].start.weekday ? 0 : 1;
        const bpt = prefN === remaining[bi].start.weekday ? 0 : 1;
        if (apt !== bpt) return apt - bpt;
      }
      return remaining[ai].start.toMillis() - remaining[bi].start.toMillis();
    });

    let placed = false;
    outer: for (const idx of indices) {
      const slot = remaining[idx];
      const fit = carveFirstFit(slot, need, gridMinutes, timeZone, appliedStartBand);
      if (!fit) continue outer;

      assignments.push({
        title: task.title,
        description: task.description,
        startISO: fit.start.toUTC().toISO(),
        endISO: fit.end.toUTC().toISO(),
        timeZone,
      });

      remaining = subtractInterval(remaining, fit.start, fit.end).sort(
        (a, b) => a.start.toMillis() - b.start.toMillis()
      );

      placed = true;
      break outer;
    }

    if (!placed && honorTimeOfDay && appliedStartBand != null) return tryAssignTask(task, false);
    return placed;
  }

  for (const task of tasks.slice(0, maxAssignments)) {
    if (assignments.length >= maxAssignments) break;
    tryAssignTask(task, true);
  }

  return assignments;
}

module.exports = { scheduleTasks };
