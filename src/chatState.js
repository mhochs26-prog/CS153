const crypto = require("crypto");

const CHAT_COOKIE = "chat_plan_state";

const COOKIE_MAX_SIGNED_CHARS = 3800;

/** @typedef {{ role: "user"|"assistant", text: string }} UiMessage */

/** @typedef {{ items: Record<string, unknown>[] }} PendingPlanCookie */

/**
 * Planner UI state serialized in a signed cookie.
 * @typedef {{ messages: UiMessage[], pendingPlan: PendingPlanCookie | null }} ChatState
 */

/** @returns {ChatState} */
function freshState() {
  return { messages: [], pendingPlan: null };
}

/**
 * Fits signed blob under ~3800 chars for browser limits.
 *
 * @param {string} secret
 * @param {ChatState} state
 */
function shrinkForCookie(secret, state) {
  /** @type {ChatState} */
  let next = {
    messages: [...state.messages].slice(-10),
    pendingPlan: state.pendingPlan,
  };
  const maxPlanItems = Math.min(next.pendingPlan?.items?.length ?? 0, 16);
  if (next.pendingPlan?.items?.length) {
    next = {
      ...next,
      pendingPlan: {
        items: /** @type {Record<string, unknown>[]} */ (next.pendingPlan.items.slice(0, maxPlanItems)),
      },
    };
  }
  for (let i = 0; i < 24; i += 1) {
    const blob = signChatState(secret, next);
    if (blob.length <= COOKIE_MAX_SIGNED_CHARS) return next;
    if (next.messages.length <= 1) {
      return {
        messages: [{ role: "assistant", text: "Your last message couldn’t fit; try shorter text." }],
        pendingPlan: null,
      };
    }
    next = {
      messages: next.messages.slice(1),
      pendingPlan: next.pendingPlan,
    };
  }
  return next;
}

function signChatState(secret, /** @type {ChatState} */ state) {
  if (secret.length < 16) throw new Error("CHAT_STATE_SECRET must be at least 16 chars.");
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** @returns {ChatState} */
function parseChatState(secret, cookieValue) {
  if (!cookieValue || typeof cookieValue !== "string") return freshState();
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return freshState();
  const [payload, sig] = parts;
  try {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return freshState();
  } catch {
    return freshState();
  }
  try {
    const raw = Buffer.from(payload, "base64url").toString("utf8");
    /** @type {unknown} */
    const parsed = JSON.parse(raw);
    return normalizeChatState(parsed);
  } catch {
    return freshState();
  }
}

/** @returns {ChatState} */
function normalizeChatState(raw) {
  if (!raw || typeof raw !== "object") return freshState();
  const msgs = Array.isArray(
    /** @type {{ messages?: unknown }} */
    (raw).messages
  )
    ? /** @type {{ messages: unknown }} */ (raw).messages
    : [];

  const trimmed = msgs
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const mr = /** @type {{ role?: unknown, text?: unknown }} */ (m);
      const role =
        mr.role === "assistant" ? "assistant" /** @type {'assistant'} */ :
        mr.role === "user" ? "user" /** @type {'user'} */ :
        "assistant";
      return {
        role,
        text: String(mr.text ?? "").slice(0, 4000),
      };
    })
    .filter((m) => m.role === "user" || (m.role === "assistant" && m.text.trim().length > 0));

  /** @type {PendingPlanCookie | null} */
  let pendingPlan = null;
  if (
    typeof /** @type {{ pendingPlan?: unknown }} */ (raw).pendingPlan === "object" &&
    /** @type {{ pendingPlan?: unknown }} */ (raw).pendingPlan !== null
  ) {
    const pp = /** @type {{ pendingPlan: { items?: unknown } }} */ (raw).pendingPlan;
    const items = Array.isArray(pp.items) ? pp.items : [];
    pendingPlan =
      items.length > 0
        ? {
            items: items.slice(0, 24).map((item) =>
              typeof item === "object" && item !== null ? { .../** @type {{}} */ (item) } : {}
            ),
          }
        : null;
  }

  return { messages: trimmed.slice(-14), pendingPlan };
}

/**
 * @param {string} secret
 * @param {ChatState} base
 */
function mergeUser(secret, base, userText) {
  const trimmed = String(userText).trim().slice(0, 6000);
  const nextMessages = [...base.messages, { role: "user" /** @type {const} */, text: trimmed }];
  /** New intent drops any unstaged draft preview. */
  const state = shrinkForCookie(secret, { messages: nextMessages, pendingPlan: null });
  return state;
}

/**
 * @param {string} secret
 */
function mergeAssistant(secret, base, assistantText, pendingPlan) {
  const nextMessages = [
    ...base.messages,
    { role: "assistant" /** @type {const} */, text: String(assistantText).slice(0, 6000) },
  ];
  return shrinkForCookie(secret, {
    messages: nextMessages,
    pendingPlan:
      pendingPlan && pendingPlan.items?.length ?
        pendingPlan /** @type {PendingPlanCookie} */
      : null,
  });
}

module.exports = {
  COOKIE_MAX_SIGNED_CHARS,
  CHAT_COOKIE,
  freshState,
  signChatState,
  parseChatState,
  mergeUser,
  mergeAssistant,
  shrinkForCookie,
};
