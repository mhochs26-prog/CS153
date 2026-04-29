const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function makeOAuth2Client(env) {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

function getConsentUrl(oauth2Client, discordUserId) {
  // `state` ties the callback to a Discord user.
  const state = Buffer.from(JSON.stringify({ discordUserId }), "utf8").toString("base64url");
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

function parseState(state) {
  const json = Buffer.from(state, "base64url").toString("utf8");
  const parsed = JSON.parse(json);
  if (!parsed?.discordUserId) throw new Error("Missing discordUserId in state");
  return parsed;
}

module.exports = { makeOAuth2Client, getConsentUrl, parseState };

