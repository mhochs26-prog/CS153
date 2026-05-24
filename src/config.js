const { z } = require("zod");

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8787),
  GEMINI_API_KEY: z.string().trim().min(8),
  CHAT_STATE_SECRET: z.string().min(16),
  DEFAULT_TIME_ZONE: z.string().min(3).default("America/Los_Angeles"),
  PLANNING_HORIZON_DAYS: z.coerce.number().int().min(1).max(31).default(14),
  /** Google retires slug names frequently; alias follows current GA Flash (`gemini-1.5-flash` 404’s on v1beta). */
  GEMINI_MODEL: z.string().trim().min(3).default("gemini-flash-latest"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

module.exports = { loadEnv };
