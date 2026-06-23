# Crate — Storage Management Web App

## What it is
- Frontend: plain HTML, CSS, JavaScript (no framework, no build step) — files in `/public`
- Backend: Node.js + Express REST API — `server.js`
- Database: SQLite, using Node's **built-in `node:sqlite` module**. No `better-sqlite3`,
  no native compiling, no Python or Visual Studio Build Tools required. The data lives
  in a single file (`storage.db`) created automatically next to `server.js` the first
  time you run the app. That's the "free SQL agent + free server" — there's nothing
  to sign up for, install separately, or pay for.

## Requirements
- **Node.js 22.5 or newer** (the built-in SQLite module needs this). Check your version with:
  ```
  node -v
  ```
  If it's older than 22.5, download the latest LTS from nodejs.org.

## Run it locally
1. Open a terminal in this folder.
2. Install the two small dependencies (Express for the web server, cors for the API):
   ```
   npm install
   ```
3. Start the app:
   ```
   npm start
   ```
4. Open http://localhost:3000 in your browser.

`storage.db` is created automatically on first run, with a couple of starter
categories/locations already seeded in.

## Note on an earlier version
An earlier version of this project used the `better-sqlite3` package, which needs to
compile native C++ code on install — that's what was causing the
`Could not find any Python installation` / `node-gyp` error on Windows. Switching to
Node's built-in `node:sqlite` module removes that dependency entirely, so `npm install`
now only fetches plain JavaScript packages (Express, cors) and there's nothing to compile.

## Put it online for free (optional)
If you want a real URL instead of localhost, any of these free tiers work because
SQLite needs no separate database service to provision:
- **Render.com** (free web service) — connect your GitHub repo, set start command `npm start`. Make sure to set the Node version to 22+ in settings.
- **Railway.app** (free trial credits) — same idea, one-click deploy from GitHub.
- **Fly.io** (free allowance) — deploy via `fly launch`.

If you outgrow a single SQLite file (multiple people writing at once, very large data),
swap it later for a free hosted SQL server like **Supabase** (Postgres) or
**PlanetScale** (MySQL) — the only file you'd need to change is `server.js`,
since the frontend just talks to `/api/...` and doesn't care what's behind it.
