require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");

const { google } = require("googleapis");

const { loadEnv } = require("./config");
const { makeOAuth2Client } = require("./googleAuth");
const { getUserTokens, setUserTokens, clearUserTokens } = require("./tokenStore");
const { createEvent } = require("./calendar");
const { extractGoogleApiMessage } = require("./googleErrors");
const { runPlanningPipeline, formatPreviewRow } = require("./plannerRun");

const {
  CHAT_COOKIE,
  signChatState,
  parseChatState,
  mergeUser,
  mergeAssistant,
  shrinkForCookie,
} = require("./chatState");

const { renderChatPage, escapeHtml } = require("./views/chatViews");
const { pendingPlanItemSchema } = require("./planSchema");
const { z } = require("zod");

const WELCOME =
  "Hi — describe what outcome you’re aiming for plus when you tend to have focus blocks (mornings / weeknights / weekends).\nAfter you connect Google below, Send runs a planner: openings come from Calendar, drafts use Gemini — you Confirm before anything is written.";

function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  };
}

function chatCookieOpts() {
  return {
    ...sessionCookieOptions(),
    maxAge: 1000 * 60 * 60 * 72,
  };
}

function ensureBrowserUserId(req, res) {
  const existing = req.cookies?.uid;
  if (typeof existing === "string" && existing.length > 10) return existing;
  const uid = crypto.randomBytes(16).toString("hex");
  res.cookie("uid", uid, sessionCookieOptions());
  return uid;
}

function writeChatCookie(res, secret, state) {
  const slim = shrinkForCookie(secret, state);
  res.cookie(CHAT_COOKIE, signChatState(secret, slim), chatCookieOpts());
}

async function main() {
  const env = loadEnv();
  const oauth2Client = makeOAuth2Client(env);
  const chatSecret = env.CHAT_STATE_SECRET;

  const app = express();

  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(express.static(path.join(process.cwd(), "public")));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  function oauthConnectUrl(uid) {
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      state: uid,
    });
  }

  function bannerFromQuery(query) {
    const msg =
      typeof query.msg === "string" && query.msg.trim() ?
        `<div class="banner ok">${escapeHtml(query.msg.trim())}</div>`
      : "";
    const err =
      typeof query.err === "string" && query.err.trim() ?
        `<div class="banner err">${escapeHtml(query.err.trim())}</div>`
      : "";
    return msg || err || "";
  }

  function previewRowsFromPending(plan) {
    if (!plan?.items?.length) return null;
    const rows = [];
    for (const it of plan.items) {
      const p = pendingPlanItemSchema.safeParse(it);
      if (p.success) rows.push(formatPreviewRow(p.data));
    }
    return rows.length ? rows : null;
  }

  function sendPlannerPage(req, res, bannerExtra = "") {
    const uid = ensureBrowserUserId(req, res);
    const state = parseChatState(chatSecret, req.cookies[CHAT_COOKIE] ?? "");

    const record = getUserTokens(uid);
    const tokens = record?.tokens ?? record;
    const connected = Boolean(tokens);

    let banner = bannerFromQuery(req.query);
    if (bannerExtra) banner = bannerExtra + banner;

    const html = renderChatPage({
      connected,
      connectedEmail: record?.email,
      connectUrl: oauthConnectUrl(uid),
      banner,
      messages: state.messages,
      previewRows: previewRowsFromPending(state.pendingPlan ?? null),
      defaultTimeZoneLabel: env.DEFAULT_TIME_ZONE,
      formDisabledReason: connected ? undefined : "",
      initialWelcome: WELCOME,
    });
    res.status(200).send(html);
  }

  app.get("/", (req, res) => {
    sendPlannerPage(req, res);
  });

  app.get("/oauth2/callback", async (req, res) => {
    try {
      const code = req.query.code;
      const state = req.query.state;
      if (typeof code !== "string" || typeof state !== "string") {
        return res.redirect("/?err=Missing%20code%2Fstate");
      }

      const { tokens } = await oauth2Client.getToken(code);

      const authForUserinfo = makeOAuth2Client(env);
      authForUserinfo.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: authForUserinfo });
      const me = await oauth2.userinfo.get();
      const email = me?.data?.email;

      setUserTokens(state, { tokens, email });
      return res.redirect("/?msg=Connected%20to%20Google%20Calendar");
    } catch (err) {
      return res.redirect("/?err=OAuth%20failed");
    }
  });

  app.post("/disconnect", (req, res) => {
    const uid = ensureBrowserUserId(req, res);
    clearUserTokens(uid);
    res.clearCookie("uid", sessionCookieOptions());
    res.clearCookie(CHAT_COOKIE, chatCookieOpts());
    res.redirect("/?msg=Disconnected");
  });

  app.post("/plan", async (req, res) => {
    ensureBrowserUserId(req, res);
    const uid = req.cookies?.uid ?? "";
    const record = getUserTokens(uid);
    const tokens = record?.tokens ?? record;

    /** @type {string} */
    const rawMsg = typeof req.body.message === "string" ? req.body.message.trim() : "";
    if (!rawMsg) {
      return res.redirect("/?err=" + encodeURIComponent("Type a brief plan prompt first."));
    }

    let basis = parseChatState(chatSecret, req.cookies[CHAT_COOKIE] ?? "");
    const withUser = mergeUser(chatSecret, basis, rawMsg);

    if (!tokens) {
      const nextState = mergeAssistant(
        chatSecret,
        withUser,
        "Connect Google Calendar above, then send your message again so I can read openings.",
        null
      );
      writeChatCookie(res, chatSecret, nextState);
      return res.redirect("/");
    }

    const userOAuth = makeOAuth2Client(env);
    userOAuth.setCredentials(tokens);
    userOAuth.on("tokens", (newTok) => {
      const merged = { ...tokens, ...newTok };
      const prev = getUserTokens(uid);
      const mergedRecord =
        prev && typeof prev === "object" && prev.email ? { tokens: merged, email: prev.email } : merged;
      setUserTokens(uid, mergedRecord);
    });

    const outcome = await runPlanningPipeline(userOAuth, env, rawMsg);

    if (!outcome.ok) {
      const txt = outcome.assistantText || "Planner could not draft a schedule.";
      const nextState = mergeAssistant(chatSecret, withUser, txt, null);
      writeChatCookie(res, chatSecret, nextState);
      return res.redirect("/");
    }

    const assistantText = outcome.assistantText || "";
    /** @type {object[]} */
    const itemsValidated = [];
    if (Array.isArray(outcome.items)) {
      for (const item of outcome.items) {
        const p = pendingPlanItemSchema.safeParse(item);
        if (p.success) itemsValidated.push(p.data);
      }
    }

    const msgText =
      assistantText.trim() || "Draft schedule is ready below — tap Confirm once it looks accurate.";

    const nextState = mergeAssistant(chatSecret, withUser, msgText, { items: itemsValidated });
    writeChatCookie(res, chatSecret, nextState);
    return res.redirect("/");
  });

  app.post("/plan/discard", (req, res) => {
    ensureBrowserUserId(req, res);
    const basis = parseChatState(chatSecret, req.cookies[CHAT_COOKIE] ?? "");
    const cleared = shrinkForCookie(chatSecret, {
      messages: basis.messages,
      pendingPlan: null,
    });
    writeChatCookie(res, chatSecret, cleared);
    res.redirect("/?msg=Draft%20cleared.");
  });

  app.post("/plan/confirm", async (req, res) => {
    ensureBrowserUserId(req, res);
    const uid =
      typeof req.cookies.uid === "string" && req.cookies.uid.length > 10 ?
        req.cookies.uid
      : "";
    const record = uid ? getUserTokens(uid) : null;
    const tokens = record?.tokens ?? record;
    const basis = parseChatState(chatSecret, req.cookies[CHAT_COOKIE] ?? "");

    if (!basis.pendingPlan?.items?.length || !tokens) {
      res.redirect("/?err=" + encodeURIComponent("Nothing to confirm or reconnect Google."));
      return;
    }

    const itemsParsed = z.array(pendingPlanItemSchema).safeParse(basis.pendingPlan.items);
    if (!itemsParsed.success || !itemsParsed.data.length) {
      res.redirect("/?err=" + encodeURIComponent("Stale draft — run another plan request."));
      return;
    }
    const validated = itemsParsed.data;

    let created = 0;
    /** @type {string | undefined} */
    let firstErrMsg;

    const userOAuth = makeOAuth2Client(env);
    userOAuth.setCredentials(tokens);
    userOAuth.on("tokens", (newTok) => {
      const merged = { ...(tokens ?? {}), ...newTok };
      const prevRec = uid ? getUserTokens(uid) : null;
      const mergedRecord =
        prevRec && typeof prevRec === "object" && prevRec.email ?
          { tokens: merged, email: prevRec.email }
        : merged;
      if (uid) setUserTokens(uid, mergedRecord);
    });

    for (let i = 0; i < validated.length && !firstErrMsg; i += 1) {
      const item = validated[i];

      try {
        // eslint-disable-next-line no-await-in-loop -- serial writes throttle Google API bursts
        await createEvent(userOAuth, {
          summary: item.title,
          description: item.description,
          startISO: item.startISO,
          endISO: item.endISO,
          timeZone: item.timeZone,
        });
        created += 1;
      } catch (e) {
        firstErrMsg = extractGoogleApiMessage(e)
          ?? (/** @type {Error | undefined} */ (e)?.message ?? "Unexpected calendar error.")
          ;

        firstErrMsg = String(firstErrMsg).slice(0, 520);
      }
    }

    if (firstErrMsg) {
      res.redirect("/?err=" + encodeURIComponent(`Created ${created} event(s); then: ${firstErrMsg}`));
      return;
    }

    const recap = `Logged ${created} block(s) to your calendar.`;

    const nextState = shrinkForCookie(chatSecret, {
      messages: [
        ...basis.messages,
        { role: "assistant" /** @type {const} */, text: recap },
      ].slice(-14),
      pendingPlan: null,
    });
    writeChatCookie(res, chatSecret, nextState);
    res.redirect("/?msg=" + encodeURIComponent(recap));
  });

  app.listen(env.PORT, () => {
    const where =
      process.env.NODE_ENV === "production" ? `port ${env.PORT}` : `http://localhost:${env.PORT}`;
    console.log(`Web UI running at ${where}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
