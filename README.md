# Web UI → Google Calendar (starter)

This project is a starter web app that:

- lets a browser user connect Google Calendar via OAuth
- stores OAuth tokens locally (in `data/tokens.json`, keyed by a browser cookie)
- creates a Google Calendar event with basic conflict checking (Google FreeBusy)

## 1) Create Google OAuth credentials

In Google Cloud Console:

- Enable **Google Calendar API** for your project (APIs & Services → Library → “Google Calendar API” → Enable).
- Create OAuth credentials: **Web application**
- Add an authorized redirect URI that matches `GOOGLE_REDIRECT_URI`
  - default: `http://localhost:8787/oauth2/callback`
- Copy:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`

## 3) Configure env vars

Copy `.env.example` to `.env` and fill it out.

### Keep your Google Cloud account private when pushing to GitHub

- **Never commit** `.env` (contains `GOOGLE_CLIENT_SECRET`) — this repo includes a `.gitignore` that ignores it.
- **Never commit** OAuth tokens — they are stored locally in `data/tokens.json` and are ignored by `.gitignore`.
- If you deploy (Render/Fly/Heroku/Vercel/etc.), set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` using the host’s **secret/environment variable** settings (or **GitHub Secrets** for Actions), not in code.

## 4) Run

```bash
npm run dev
```

Then open:

- `http://localhost:8787`

Example event values:

- title: `Homework`
- start date: `2026-04-24`, time `3:00 PM`
- end date: `2026-04-24`, time `4:00 PM`
- time zone: `America/Los_Angeles`

## Notes

- Tokens are stored locally in `data/tokens.json` for simplicity.
- This is a starter; for production, you’ll want encryption + a real DB + secure hosting for the OAuth callback.

## Deploy for free (Render) without exposing secrets

You never put `GOOGLE_CLIENT_SECRET` (or refresh tokens) in GitHub. The host injects them at runtime as **environment variables**.

1. Push this repo to GitHub **without** `.env` or `node_modules` (both are gitignored). On Render, connect the repo and deploy using `render.yaml`, or create a **Web Service** manually:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
2. In the Render dashboard → **Environment**, add (as secret/plain vars — **not** in code):
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` = `https://<your-service-name>.onrender.com/oauth2/callback` (must match exactly)
   - `NODE_ENV` = `production` (already set if you use `render.yaml`)
3. In **Google Cloud Console** → your OAuth client → **Authorized redirect URIs**, add **both**:
   - `http://localhost:8787/oauth2/callback` (local dev)
   - `https://<your-service-name>.onrender.com/oauth2/callback` (production)
4. Redeploy after changing env vars.

**What is “secret” vs not:** the **client ID** is not a password (it appears in OAuth URLs). Treat **`GOOGLE_CLIENT_SECRET`**, refresh tokens, and `.env` as **private** — only on your machine or in the host’s env settings.

**Free tier caveat:** Render’s filesystem is **ephemeral**. `data/tokens.json` can be **lost** on redeploys or when the instance restarts, so users may need to **Connect Google** again unless you later add a database.

Other free/low-cost hosts (Fly.io, Railway, etc.) follow the same idea: set the same env vars in their dashboard; never commit them to git.

