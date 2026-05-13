require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const { loadEnv } = require("./config");
const { google } = require("googleapis");
const { makeOAuth2Client } = require("./googleAuth");
const { getUserTokens, setUserTokens, clearUserTokens } = require("./tokenStore");
const { hasConflict, createEvent } = require("./calendar");
const { wallTimeToISO } = require("./wallTime");
const { extractGoogleApiMessage } = require("./googleErrors");

function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  };
}

function ensureBrowserUserId(req, res) {
  const existing = req.cookies?.uid;
  if (typeof existing === "string" && existing.length > 10) return existing;
  const uid = crypto.randomBytes(16).toString("hex");
  res.cookie("uid", uid, sessionCookieOptions());
  return uid;
}

function hour12Options() {
  let html = "";
  for (let h = 1; h <= 12; h += 1) {
    html += `<option value="${h}">${h}</option>`;
  }
  return html;
}

function minuteOptions() {
  let html = "";
  for (let m = 0; m <= 59; m += 1) {
    const label = String(m).padStart(2, "0");
    html += `<option value="${m}">${label}</option>`;
  }
  return html;
}

function renderPage({ connected, connectedEmail, connectUrl, message, error }) {
  const statusLine = connected
    ? `<div class="pill ok">Connected</div>`
    : `<div class="pill warn">Not connected</div>`;

  const banner = error
    ? `<div class="banner err">${escapeHtml(error)}</div>`
    : message
      ? `<div class="banner ok">${escapeHtml(message)}</div>`
      : "";

  const connectSection = connected
    ? `<p class="muted">Connected as <strong>${escapeHtml(connectedEmail || "Unknown account")}</strong>.</p>
       <form method="POST" action="/disconnect" style="margin-top: 10px;">
         <button type="submit" style="background: var(--warn); color: #2b1b00;">Disconnect</button>
       </form>`
    : `<a class="btn" href="${connectUrl}">Connect Google Calendar</a>
       <p class="muted">You’ll be sent to Google to log in and authorize access.</p>`;

  const formDisabled = connected ? "" : "disabled";
  const formHint = connected ? "" : `<p class="muted">Connect first to enable event creation.</p>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Calendar Planner</title>
    <style>
      :root { --bg:#0b0f19; --card:#111a2e; --text:#e9eefc; --muted:#a8b3d6; --ok:#2bd576; --warn:#ffcc66; --err:#ff5c7a; --btn:#5b8cff; }
      body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: radial-gradient(1000px 600px at 20% 0%, #142347, var(--bg)); color: var(--text); }
      .wrap { max-width: 820px; margin: 0 auto; padding: 28px 16px 48px; }
      .card { background: color-mix(in oklab, var(--card), black 18%); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
      .row { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      h1 { font-size: 20px; margin: 0; letter-spacing: .2px; }
      .pill { padding: 6px 10px; border-radius: 999px; font-size: 12px; border:1px solid rgba(255,255,255,.12); }
      .pill.ok { background: rgba(43,213,118,.12); color: var(--ok); }
      .pill.warn { background: rgba(255,204,102,.12); color: var(--warn); }
      .muted { color: var(--muted); margin: 10px 0 0; }
      .banner { margin: 14px 0 0; padding: 10px 12px; border-radius: 12px; border:1px solid rgba(255,255,255,.12); }
      .banner.ok { background: rgba(43,213,118,.10); }
      .banner.err { background: rgba(255,92,122,.12); }
      .btn { display:inline-block; margin-top: 12px; background: var(--btn); color: white; text-decoration:none; padding: 10px 14px; border-radius: 12px; font-weight: 650; }
      .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top: 14px; }
      @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
      label { display:block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
      input, textarea, select { width:100%; box-sizing:border-box; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.22); color: var(--text); }
      textarea { min-height: 84px; resize: vertical; }
      .datetime-block { margin-top: 12px; }
      .datetime-block > label { margin-bottom: 8px; }
      .time-row { display:flex; gap:10px; align-items:stretch; flex-wrap:wrap; }
      .time-row select { flex: 1; min-width: 72px; }
      input[type="date"] { min-height: 44px; }
      button { margin-top: 12px; padding: 10px 14px; border-radius: 12px; border: 0; background: var(--ok); color: #062414; font-weight: 750; cursor:pointer; }
      button[disabled] { opacity: .45; cursor: not-allowed; }
      code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="row">
          <h1>Calendar Planner (starter)</h1>
          ${statusLine}
        </div>
        ${banner}
        <div style="margin-top: 10px;">
          ${connectSection}
        </div>
        <hr style="margin:18px 0; border:0; border-top:1px solid rgba(255,255,255,.10)" />
        <h2 style="margin:0; font-size:14px; color: var(--muted); font-weight:700; letter-spacing:.3px;">Create an event</h2>
        ${formHint}
        <form method="POST" action="/events">
          <div class="grid">
            <div>
              <label>Title</label>
              <input name="title" placeholder="Homework" required ${formDisabled}/>
            </div>
            <div>
              <label>Time zone (IANA)</label>
              <input name="timezone" placeholder="America/Los_Angeles" value="America/Los_Angeles" ${formDisabled}/>
            </div>
          </div>
          <div class="datetime-block">
            <label>Start</label>
            <input type="date" name="start_date" required ${formDisabled}/>
            <div class="time-row" style="margin-top:8px;">
              <select name="start_hour" aria-label="Start hour" required ${formDisabled}>${hour12Options()}</select>
              <select name="start_minute" aria-label="Start minute" required ${formDisabled}>${minuteOptions()}</select>
              <select name="start_ampm" aria-label="Start AM or PM" required ${formDisabled}>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
          <div class="datetime-block">
            <label>End</label>
            <input type="date" name="end_date" required ${formDisabled}/>
            <div class="time-row" style="margin-top:8px;">
              <select name="end_hour" aria-label="End hour" required ${formDisabled}>${hour12Options()}</select>
              <select name="end_minute" aria-label="End minute" required ${formDisabled}>${minuteOptions()}</select>
              <select name="end_ampm" aria-label="End AM or PM" required ${formDisabled}>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
          <div style="margin-top: 12px;">
            <label>Description</label>
            <textarea name="description" placeholder="Optional notes..." ${formDisabled}></textarea>
          </div>
          <button type="submit" ${formDisabled}>Create event (conflict-checked)</button>
        </form>
        <p class="muted" style="margin-top: 14px;">
          Pick a date from the calendar, then choose hour, minutes, and AM/PM. Times use the time zone above.
        </p>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  const env = loadEnv();

  const oauth2Client = makeOAuth2Client(env);
  const app = express();
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (req, res) => {
    const uid = ensureBrowserUserId(req, res);
    const record = getUserTokens(uid);
    const tokens = record?.tokens ?? record; // backwards compatible with earlier tokens-only storage
    const connectedEmail = record?.email;
    const connectUrl = oauth2Client.generateAuthUrl({
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
    res.status(200).send(
      renderPage({
        connected: Boolean(tokens),
        connectedEmail,
        connectUrl,
        message: req.query.msg,
        error: req.query.err,
      })
    );
  });

  app.get("/oauth2/callback", async (req, res) => {
    try {
      const code = req.query.code;
      const state = req.query.state;
      if (typeof code !== "string" || typeof state !== "string") {
        return res.redirect("/?err=Missing%20code%2Fstate");
      }

      const { tokens } = await oauth2Client.getToken(code);

      // Fetch the connected Google account email (so we can display it).
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
    res.redirect("/?msg=Disconnected");
  });

  app.post("/events", async (req, res) => {
    const uid = ensureBrowserUserId(req, res);
    const record = getUserTokens(uid);
    const tokens = record?.tokens ?? record;
    if (!tokens) return res.redirect("/?err=Not%20connected%20yet");

    const title = req.body.title;
    const timeZone = req.body.timezone || "America/Los_Angeles";
    const description = req.body.description || undefined;

    if (typeof title !== "string") {
      return res.redirect("/?err=Missing%20fields");
    }

    const startRes = wallTimeToISO(
      {
        date: req.body.start_date,
        hour12: req.body.start_hour,
        minute: req.body.start_minute,
        ampm: req.body.start_ampm,
      },
      timeZone
    );
    const endRes = wallTimeToISO(
      {
        date: req.body.end_date,
        hour12: req.body.end_hour,
        minute: req.body.end_minute,
        ampm: req.body.end_ampm,
      },
      timeZone
    );

    if (!startRes.ok) {
      return res.redirect(`/?err=${encodeURIComponent(startRes.error)}`);
    }
    if (!endRes.ok) {
      return res.redirect(`/?err=${encodeURIComponent(endRes.error)}`);
    }

    const startISO = startRes.iso;
    const endISO = endRes.iso;

    const userOauth = makeOAuth2Client(env);
    userOauth.setCredentials(tokens);
    userOauth.on("tokens", (newTokens) => {
      const mergedTokens = { ...tokens, ...newTokens };
      const next =
        record && typeof record === "object" && record.email
          ? { tokens: mergedTokens, email: record.email }
          : mergedTokens;
      setUserTokens(uid, next);
    });

    try {
      if (Date.parse(endISO) <= Date.parse(startISO)) {
        return res.redirect("/?err=End%20time%20must%20be%20after%20start%20time");
      }
      const conflict = await hasConflict(userOauth, { startISO, endISO, timeZone });
      if (conflict) return res.redirect("/?err=Conflict%20detected%20for%20that%20time");

      await createEvent(userOauth, {
        summary: title,
        description,
        startISO,
        endISO,
        timeZone,
      });
      return res.redirect("/?msg=Event%20created");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Calendar operation failed:", e?.response?.data ?? e);
      const detail = extractGoogleApiMessage(e);
      const msg = detail
        ? `Calendar error: ${detail}`.slice(0, 500)
        : "Failed to create event.";
      return res.redirect(`/?err=${encodeURIComponent(msg)}`);
    }
  });

  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    const where =
      process.env.NODE_ENV === "production" ? `port ${env.PORT}` : `http://localhost:${env.PORT}`;
    console.log(`Web UI running at ${where}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

