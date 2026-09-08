# Rower implementation plan

Updated September 8, 2026. This is the current direction for the app inside `rower/`; it supersedes the older local enrichment-engine proposal in the parent folder’s `ARCHITECTURE.md`.

## Product

Rower is a generic spreadsheet task runner. The public landing page introduces the product through a spreadsheet-style hero, three interactive illustrative examples, two custom cell characters, and the supplied rowing animation. **Start rowing** opens the workspace without a login.

The workspace supports CSV/XLSX upload, selected input columns, editable task instructions and output fields, provider/model selection, a three-row test, batched execution, pause/cancel, and export. Task settings and results stay in memory across internal navigation; refreshing clears them.

## Implemented architecture

- React + Vite frontend, with Bricolage Grotesque and DM Sans bundled locally.
- Cloudflare Vite plugin for development, build, and production preview.
- Hono Worker API. No deployed Node server, Express, SQLite, credential sessions, or authentication.
- Browser-only parsing and export. ExcelJS loads on demand for XLSX.
- Three stateless routes: `GET /api/health`, `POST /api/models`, and `POST /api/execute`.
- Each POST includes the user’s key. It stays in React memory, never in browser storage, cookies, URLs, or server storage.
- The browser filters row values to selected columns before transmission; the provider prompt filters them again.
- Provider adapters retain output-schema checks, IDs, selected input handling, provider-specific web effort, and cancellation.

## Public request boundary

- JSON-only POST requests, same-origin checks when Origin is present, and no cross-origin response permissions.
- A 3 MiB request body maximum; 25 rows per model-only batch and 10 per web batch.
- Up to 64 input columns and 32 output fields per task, with bounded text fields and unique row IDs.
- Provider responses bounded to 8 MiB; existing request timeouts retained.
- Coarse per-IP Cloudflare limits: 10 model-list calls and 30 execution calls per minute. These are per-location, eventually consistent abuse controls, not global accounting.
- Provider keys redacted from returned errors. No request bodies or keys logged by application code.
- Public HTTPS compatible endpoints in production. Localhost is permitted only in the local development build. URL credentials, query strings, fragments, private hostnames, IP literals, nonstandard production ports, and redirects are rejected.
- Incoming request signals are forwarded to providers, with Cloudflare’s `enable_request_signal` flag.
- Automatic retries only for provider busy responses (429/529), with bounded attempts and delay. Ambiguous server failures stop the run; cancellation cannot undo provider billing.
- Security headers and a same-origin content security policy on production assets.

## Spreadsheet handling

There is no arbitrary file-size or total-row limit. Capacity depends on browser memory and workbook complexity. The large-row argument-spread failure is fixed and covered by a 150,000-row regression check. Duplicate column names cannot overwrite parsed values.

Exports preserve original columns, physical rows, and other workbook sheets. Generated strings retain formula-injection protection. Results are not checkpointed; partial results can be exported after pausing or stopping.

## Verification and release

1. Run unit/provider/spreadsheet checks and focused tests in the Worker runtime.
2. Run browser checks on desktop and mobile, including the production build: examples, navigation, upload, editable outputs, provider connection, selected-column privacy, test-three, remaining rows, export, and reduced motion.
3. Build and perform a Wrangler deployment dry run. Keep the API bundle below the Free Worker size limit.
4. Publish the separately named staging Worker and test real model-only work with the owner’s provider key.
5. Run 100 rows of web research in staging, reviewing output quality, CPU time, cancellation, retries, and provider errors.
6. If ordinary requests repeatedly exceed the Free CPU allowance, reduce overhead or move the same Worker to the paid plan after reviewing its cost.
7. Publish the main app after the live checks pass.

Local automated checks use mocked provider replies. They do not establish live provider quality or real Cloudflare CPU usage. Deployment and account-specific checks are documented in [deployment.md](deployment.md).

## Deliberate limits

No logins, database, background job queue, persistent keys, or saved-run service. Browser checkpoints may be considered if losing progress becomes a demonstrated problem. Built-in presets are editable for the current session; there is no saved-template library.
