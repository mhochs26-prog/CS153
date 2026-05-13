const { google } = require("googleapis");

function makeOAuth2Client(env) {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

module.exports = { makeOAuth2Client };
