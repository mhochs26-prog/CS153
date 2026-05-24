const { z } = require("zod");

const dowEnum = z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);

const llmTasksResponseSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string().trim().min(1).max(200),
      description: z.preprocess(
        (v) => (v === null || v === undefined ? undefined : v),
        z.string().trim().max(800).optional()
      ),
      durationMinutes: z.number().int().min(15).max(8 * 60),
      preferredDayOfWeek: z.preprocess(
        (v) => (v === null || v === undefined || v === "" ? undefined : String(v).toLowerCase()),
        dowEnum.optional()
      ),
    })
  ),
});

/** Proposed calendar blocks after deterministic scheduling (+ verification). */
const pendingPlanItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(800).optional(),
  startISO: z.string(),
  endISO: z.string(),
  timeZone: z.string().min(1),
});

module.exports = { llmTasksResponseSchema, pendingPlanItemSchema };
