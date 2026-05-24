const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const { llmTasksResponseSchema } = require("./planSchema");

const taskItemSchemaGemini = {
  type: SchemaType.OBJECT,
  properties: {
    title: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING, nullable: true },
    durationMinutes: { type: SchemaType.INTEGER },
    preferredDayOfWeek: {
      type: SchemaType.STRING,
      enum: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
      nullable: true,
    },
  },
  required: ["title", "durationMinutes"],
};

/**
 * Tried only on 404 unknown model / unsupported generateContent.
 */
const GEMINI_MODEL_404_FALLBACKS = Object.freeze([
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
]);

function escapeUserBlock(s) {
  return String(s)
    .replaceAll("```", "``\\`")
    .slice(0, 6000);
}

/** @returns {boolean} */
function isGeminiWrongModelSlug(err) {
  const raw = typeof err?.message === "string" ? err.message : String(err ?? "");
  if (!/\b404\b/.test(raw)) return false;
  return (
    /not\s+found/i.test(raw)
    || /supported\s+for\s+generateContent/i.test(raw)
    || /\bis\s+not\s+found\b/i.test(raw)
  );
}

/**
 * @param {string} blob
 */
function activationUrlFromGoogleError(blob) {
  const m = blob.match(
    /https:\/\/console\.developers\.google\.com\/apis\/api\/generativelanguage\.googleapis\.com\/[^\s\]"'\]]+/i
  );
  return m ? m[0] : undefined;
}

/**
 * @param {unknown} err
 */
function throwIfGeminiProjectDisabled(err) {
  const raw = typeof /** @type {{ message?: string }} */ (err)?.message === "string" ? err.message : String(err ?? "");
  if (
    /\bSERVICE_DISABLED\b/i.test(raw)
    || /\bGemini API has not been used\b/i.test(raw)
    || (/\b403\b/.test(raw) &&
      /\bgenerativelanguage\.googleapis\.com\b/i.test(raw) &&
      !/\bAPI_KEY_SERVICE_BLOCKED\b/i.test(raw))
  ) {
    const url =
      activationUrlFromGoogleError(raw) ?? "https://developers.google.com/gemini-api/docs/quickstart#setup";
    /** @type {Error & { code?: string; activationUrl?: string }} */
    const e = new Error(
      `GEMINI_DISABLED: Enable the Gemini API on the Google Cloud project tied to your API key, then retry. Opens: ${url}`
    );
    e.code = "GEMINI_API_DISABLED";
    e.activationUrl = url;
    throw e;
  }
}

async function generateJsonTasksText(ai, modelName, prompt) {
  const model = ai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          tasks: {
            type: SchemaType.ARRAY,
            items: taskItemSchemaGemini,
          },
        },
        required: ["tasks"],
      },
    },
  });

  const res = await model.generateContent(prompt);
  const text = typeof res.response.text === "function" ? res.response.text() : "";
  if (typeof text !== "string" || !text.trim()) {
    const e = new Error("Empty LLM reply.");
    e.code = "LLM_PARSE";
    throw e;
  }
  return text;
}

/**
 * Interpret user goals → task list (no calendar times — server schedules).
 *
 * @param {{ apiKey: string, model: string }} geminiCfg
 */
async function proposeTasks(geminiCfg, payload) {
  const { timezone, horizonDays, mergedBusyIntervals, userMessage } = payload;
  const ai = new GoogleGenerativeAI(geminiCfg.apiKey);

  const busySnippet = mergedBusyIntervals
    .slice(0, 36)
    .map((b) => `${b.start} -> ${b.end}`)
    .join("\n");

  const prompt =
    `You are a scheduling assistant. Break the user's work into discrete tasks with durations in minutes (` +
    `15–480 minutes each). Prefer 30–180 minute sessions for deep work unless the text suggests shorter blocks. ` +
    `Return at most 12 tasks. Do NOT choose calendar start/end times; the server assigns available slots.` +
    `\nScheduling context:\n` +
    `- Primary IANA timezone: ${timezone}\n` +
    `- Planning window: roughly the next ${horizonDays} day(s), starting tomorrow (local).\n` +
    `- Busy windows on the primary calendar (RFC3339, do not overlap new work mentally — server handles slots):\n` +
    `${busySnippet || "(no busy data)"}\n` +
    `\nUser message:\n"""${escapeUserBlock(userMessage)}"""`;

  const primary = geminiCfg.model.trim();
  const tryModels = [...new Set([primary, ...GEMINI_MODEL_404_FALLBACKS])];

  /** @type {unknown} */
  let lastErr;

  let textResult;
  for (const modelName of tryModels) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential 404 fallbacks only
      textResult = await generateJsonTasksText(ai, modelName, prompt);
      break;
    } catch (err) {
      lastErr = err;
      throwIfGeminiProjectDisabled(err);

      const msg =
        typeof err?.message === "string" ? err.message : String(err ?? "Gemini request failed.");

      if (isGeminiWrongModelSlug(err)) {
        if (modelName === tryModels[tryModels.length - 1]) {
          /** @type {Error & { code?: string }} */
          const e = new Error(
            `${msg} Tried: ${tryModels.join(", ")}. Pick a valid model ID for your key (Gemini docs / ListModels).`
          );
          e.code = "LLM_UNAVAILABLE";
          throw e;
        }
        continue;
      }

      /** @type {Error & { code?: string }} */
      const e = new Error(`LLM: ${msg}`);
      e.code = "LLM_UNAVAILABLE";
      throw e;
    }
  }

  if (typeof textResult !== "string") {
    const e = new Error(lastErr instanceof Error ? lastErr.message : "Gemini request failed.");
    e.code = "LLM_UNAVAILABLE";
    throw e;
  }

  let parsed;
  try {
    parsed = JSON.parse(textResult);
  } catch {
    const e = new Error("Could not parse model JSON.");
    e.code = "LLM_PARSE";
    throw e;
  }

  const safe = llmTasksResponseSchema.safeParse(parsed);
  if (!safe.success) {
    const e = new Error("Task list failed validation.");
    e.code = "LLM_VALIDATE";
    throw e;
  }
  return safe.data.tasks.slice(0, 12);
}

module.exports = { proposeTasks, GEMINI_MODEL_404_FALLBACKS };
