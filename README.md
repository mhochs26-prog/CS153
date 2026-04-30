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

<img width="936" height="841" alt="image" src="https://github.com/user-attachments/assets/85e281c7-a0dd-41c5-af04-2f5aad3c360d" />
