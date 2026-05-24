/**
 * Loose local wall-clock spans for interpreting time-of-day preferences.
 * Mirrors what the Gemini task schema emits (`preferredTimeOfDay`).
 */

/** Minute-of-day `[startInclusive, endExclusive)` for **start‑bias** semantics (scheduler). */
const PREFERENCE_START_BAND_MINUTES = Object.freeze({
  morning: [8 * 60, 15 * 60],
  afternoon: [12 * 60, 24 * 60],
  evening: [17 * 60, 24 * 60],
});

const PREFERENCE_LABEL = Object.freeze({
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
});

module.exports = {
  PREFERENCE_START_BAND_MINUTES,
  PREFERENCE_LABEL,
};
