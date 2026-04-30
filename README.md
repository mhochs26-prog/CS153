# Web UI → Google Calendar (starter)

This project is a starter web app that:

- lets a browser user connect Google Calendar via OAuth
- stores OAuth tokens locally (in `data/tokens.json`, keyed by a browser cookie)
- creates a Google Calendar event with basic conflict checking (Google FreeBusy)


## Run
IMPORTANT: needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env file, which is not in github so cloned project will not work with google auth
npm install
npm run dev


Then open:

- http://localhost:8787

Example event values:

- title: `Homework`
- start date: `2026-04-24`, time `3:00 PM`
- end date: `2026-04-24`, time `4:00 PM`
- time zone: `America/Los_Angeles`


<img width="936" height="841" alt="image" src="https://github.com/user-attachments/assets/85e281c7-a0dd-41c5-af04-2f5aad3c360d" />
