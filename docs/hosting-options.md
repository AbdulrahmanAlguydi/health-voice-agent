# Netlify deployment

Rafiq is deployed as a Vite site plus a Netlify Function. The active receptionist API and its synthetic bookings use Netlify Database (Postgres); the legacy SQLite demo endpoints remain local fixtures. Gemini Live stays in the browser, while the server issues short-lived tokens using `GEMINI_API_KEY`.

## Netlify build settings

Use the repository branch `codex/gemini-health-agent` when connecting this checkout. Set the site build values to:

| Setting | Value |
| --- | --- |
| Base directory | repository root (blank) |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |

`netlify.toml` contains the same build and function settings, plus the `/api/*` rewrite to the Express function. The Vite plugin provides the matching local function and Postgres emulation.

The lockfile currently resolves TypeScript to 5.9.3. Keep the compiler on the 5.x line because the Netlify Vite plugin currently fails to initialize with TypeScript 7; recheck the plugin-backed dev server and production build before upgrading the major version.

## Database and environment

For deployment, link the checkout to the Netlify site and create or enable Netlify Database for that site. The database package lets Netlify supply the correct connection to production Functions and local emulation.

To apply the committed schema and fictional clinic seed locally, first start the Netlify Vite environment so its database emulator is available, then apply the migration from another terminal:

```sh
npm install
npm run dev
# In a second terminal, while `npm run dev` is still running:
npm run database:migrate
```

Set `GEMINI_API_KEY` as a server-side environment variable in Netlify, then redeploy. It is the only application secret required for voice. Do not add it to a `VITE_` variable or expose it to browser code. Netlify Database supplies `NETLIFY_DB_URL`; do not copy a production connection string into the repository or `.env` file.

For local work, copy `.env.example` to `.env` and add a development `GEMINI_API_KEY` if voice is needed. The Netlify Vite plugin serves the Vite app and `/api/*` function routes against its local Postgres emulator. The CLI alternative is `npm run netlify:dev`; the same local database and migrations are shared between both modes.

The simultaneous final-slot contention acceptance test uses `TEST_POSTGRES_URL` and requires a disposable real PostgreSQL database; it creates and drops its own isolated schema. Run it with `npm run test:postgres` after setting that variable. The local PGlite emulator's `pg-gateway` has cross-talk across overlapping savepoint transactions on different clients; we reproduced the lost rows with direct SQL outside the application, so the PGlite suite cannot verify this production concurrency case. Never point `TEST_POSTGRES_URL` at a production database.

## Deploy checks

Before sharing the site, confirm `/api/health` and the receptionist session routes work, and complete a demo booking. A booking is only confirmed when the API returns `committed`; after restarting local dev, use a fresh session to confirm the committed time is no longer available. The cross-session activity diagnostic is limited to the standalone local development server and is not exposed by the public function. Production database migrations run as part of Netlify's deploy lifecycle. Create the site's Netlify Database before the first production deployment so the initial migration has a database target.

The app contains synthetic clinic, doctor, and booking data only. Do not import the legacy SQLite appointments or patient records. The API key and database connection string are secrets; never print or commit them. Public demo traffic can incur Gemini and database usage, so review the account's quotas before sharing broadly.
