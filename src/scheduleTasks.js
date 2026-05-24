const { DateTime } = require("luxon");

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
 * @param {{ start: DateTime, end: DateTime }} slotTZ bounds in user's zone
 */
function carveFirstFit(slotTZ, needMinutes, gridMinutes) {
  let candidate = slotTZ.start.set({ second: 0, millisecond: 0 });
  const ceil0 = ceilToGridMinute(candidate, gridMinutes);
  if (ceil0 && ceil0 >= slotTZ.start) candidate = ceil0;
  const maxIterations =
    Math.max(96, Math.ceil(slotTZ.end.diff(slotTZ.start).as("minutes") / gridMinutes) + 8);

  for (let i = 0; i < maxIterations && candidate < slotTZ.end; i += 1) {
    const endAt = candidate.plus({ minutes: needMinutes });
    if (endAt <= slotTZ.end && candidate >= slotTZ.start) {
      return { start: candidate, end: endAt };
    }
    candidate = candidate.plus({ minutes: gridMinutes });
  }

  return null;
}

/**
 * @param {{ durationMinutes: number, title: string, description?: string, preferredDayOfWeek?: string }[]} tasks
 * @param {{ start: DateTime, end: DateTime }[]} freeSlots
 */
function scheduleTasks(tasks, freeSlots, opts) {
  const { timeZone, gridMinutes = 15, maxAssignments = 20 } = opts;

  const slots = freeSlots
    .map((s) => ({
      start: s.start.setZone(timeZone),
      end: s.end.setZone(timeZone),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());

  /** @type {{ title: string, description?: string, startISO: string, endISO: string, timeZone: string }[]} */
  const assignments = [];

  for (const task of tasks.slice(0, maxAssignments)) {
    if (assignments.length >= maxAssignments) break;
    const need = Math.min(
      Math.max(15, Math.ceil(task.durationMinutes / gridMinutes) * gridMinutes),
      8 * 60
    );

    const prefN =
      task.preferredDayOfWeek && DAY_TOKEN_TO_LUXON[task.preferredDayOfWeek] != null
        ? DAY_TOKEN_TO_LUXON[task.preferredDayOfWeek]
        : null;

    const indices = [...slots.keys()].sort((ai, bi) => {
      if (prefN != null) {
        const apt = prefN === slots[ai].start.weekday ? 0 : 1;
        const bpt = prefN === slots[bi].start.weekday ? 0 : 1;
        if (apt !== bpt) return apt - bpt;
      }
      return slots[ai].start.toMillis() - slots[bi].start.toMillis();
    });

    let placed = false;
    for (const idx of indices) {
      const slot = slots[idx];
      const fit = carveFirstFit(slot, need, gridMinutes);
      if (fit) {
        assignments.push({
          title: task.title,
          description: task.description,
          startISO: fit.start.toUTC().toISO(),
          endISO: fit.end.toUTC().toISO(),
          timeZone,
        });
        slot.start = fit.end;
        placed = true;
        break;
      }
    }

    if (!placed) continue;
  }

  return assignments;
}

module.exports = { scheduleTasks };
