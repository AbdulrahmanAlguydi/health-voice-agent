# Hosting options for a free demo

Last checked: 2026-10-04. Free-plan limits change; verify them again before deployment.

## What the current app needs

The app is not a static site: the browser talks to a Node/Express API, which owns the SQLite database and issues short-lived Gemini Live credentials. The production build currently creates frontend assets, but the Express app does not yet serve those assets. A public deployment therefore needs either a small production static-serving setup or separate frontend/API services. The API key must remain server-side.

The SQLite database is intentionally persistent in local development. A host with an ephemeral filesystem would lose demo bookings on restart, redeploy, or sleep; this matters if testers should see their bookings persist.

## Shortlist

| Option | What is free | Fit and trade-off |
| --- | --- | --- |
| **Render Free + Neon Free** | Render gives a `*.onrender.com` address; Neon Free currently includes 1 GB storage and 100 compute-hours per project per month. | Best low-operations public demo after adding a Postgres adapter and production frontend serving. Render sleeps after 15 minutes idle and a waking service can take about a minute; Neon also scales idle compute to zero. SQLite must be migrated because Render's free filesystem is ephemeral. Render's own free Postgres is temporary (30 days), so it is not the persistence choice here. |
| **Oracle Cloud Always Free VM** | A small VM and boot/block storage within the published Always Free allowance. | Closest fit to the existing Node + `better-sqlite3` design because SQLite can remain on persistent VM storage. More setup and maintenance: Linux updates, process supervision, firewall, TLS, backups, and a public IP. Capacity can vary by home region. |
| **Cloudflare Workers + D1 + Pages/Worker assets** | Provider subdomains such as `*.workers.dev` / `*.pages.dev`; Workers Free currently includes 100,000 requests per day and D1 has a free allowance. | Durable managed SQL, but the current Express server and native `better-sqlite3` driver cannot be dropped in unchanged. This requires replacing the API/runtime and SQLite access with Worker handlers and D1 bindings, so it is the largest rewrite. |

## Recommendation

For a low-maintenance, intermittent demo, use **Render + Neon**, but only after making the small production-serving change and moving the persistence adapter from SQLite to Postgres. Expect a cold start after idle. If preserving the current SQLite implementation is more important than ease of setup, the VM route fits better, but it is not a one-click host.

For a $0 URL, use the hostname supplied by the host (`onrender.com`, `workers.dev`, or `pages.dev`). Those are provider-owned subdomains, not a custom domain you own. A memorable custom `.com` or similar domain normally requires paid registration; Cloudflare's custom-domain setup assumes you already have a domain.

Free hosting does not make Gemini Live usage free. Before sharing a public link, check API billing/quotas and limit uncontrolled demo traffic. No hosting account, domain, database, or deployment has been created by this research.

## Sources

- [Render free services and limits](https://render.com/docs/free)
- [Render web services and `onrender.com` hostnames](https://render.com/docs/web-services)
- [Neon Free plan allowance](https://neon.com/blog/neon-free-plan-1-gb-per-project) and [five-minute scale-to-zero behavior](https://neon.com/docs/manage/endpoints/)
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Cloudflare Workers pricing and quotas](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare `workers.dev` hostname](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) and [Pages custom-domain requirements](https://developers.cloudflare.com/pages/configuration/custom-domains/)
