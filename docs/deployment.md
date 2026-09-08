# Put Rower online, step by step

This guide publishes the whole app: the landing page, the workspace, and the API. They live together on Cloudflare Workers. You do not need a separate backend, database, or login system.

The commands below are for your Linux computer. Paste each command into a terminal and press Enter. Wait for it to finish before running the next one.

## 1. Get the two things you need

- A [Cloudflare account](https://dash.cloudflare.com/sign-up).
- A model provider API key for testing the finished app. Each visitor uses their own key. Do not put a provider key in the code or Cloudflare settings.

You can start on Cloudflare Workers Free. Model requests and web searches are billed separately by your chosen provider. Check that provider’s balance and usage settings before a large run.

## 2. Open the project folder

Open a terminal and run:

```bash
cd /home/sno/Work/pop/rower
```

Stay in this folder for all the commands in this guide. If you move the project to another computer, use its new folder path instead.

## 3. Check Node and pnpm

```bash
node --version
pnpm --version
```

Use Node 24, 25, or 26 and pnpm 10. This project was checked with Node 26.8.1 and pnpm 10.30.2.

If Node is missing, install Node 24 from [nodejs.org](https://nodejs.org/en/download), then reopen your terminal. If pnpm is missing, install it:

```bash
npm install --global pnpm@10.30.2
```

## 4. Install the project’s packages

```bash
pnpm install --frozen-lockfile
```

This downloads the versions the app was tested with. Keep `pnpm-lock.yaml` with the project. The fonts and illustrations are bundled locally, so your visitors do not need to contact Google Fonts.

The small tools `esbuild` and `workerd` are explicitly allowed to run their installation scripts in `package.json`. If your machine still reports a missing executable, run `pnpm rebuild esbuild workerd`.

If you create `.dev.vars` for local provider testing, keep it only on your computer. The project ignores `.dev.vars*` and `.env*` in Git, excludes them from static assets, and declares that the deployed Worker needs no server-side secrets. Production visitors supply their own key in the workspace.

## 5. Try it on your computer

```bash
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

1. Look through the landing page. Try the three example buttons.
2. Click **Start rowing**.
3. Click **Try a sample sheet**, or upload your own `.csv` or `.xlsx`.
4. Pick a task. For a quick model-only test, pick **Custom task** and leave **Search the web for this task** unchecked.
5. Choose a provider, paste your API key, and click **Connect and load models**.
6. Choose a model. Click **Test 3 rows**.
7. Check the answers, then try **Run remaining rows** and **Export**.

To edit the result names, descriptions, or types, open **Output columns** in the task panel.

Your key and results stay in this tab’s memory. Export before refreshing or closing the tab. Returning to the landing page using the Rower wordmark keeps the workspace in memory until you refresh or close it.

Press **Ctrl+C** in the terminal when you want to stop the local server.

## 6. Run the checks before uploading

```bash
pnpm test
pnpm run deploy:check
```

The first command checks spreadsheet handling, provider translation, and Worker requests. The second builds the finished app and asks Cloudflare’s tool to check the deployment. **It does not publish anything.** It should end with `--dry-run: exiting now.`

The build may mention a large ExcelJS chunk. That is the browser’s Excel reader, which loads when you open an Excel file. It is separate from the Worker API bundle.

For the desktop and mobile browser checks:

```bash
pnpm exec playwright install chromium
pnpm test:e2e:production
```

On this computer, the tests can also use the installed Google Chrome. The browser tests use simulated provider replies, so they do not spend your API credits. They cover the real upload, configuration, batch processing, and downloaded CSV flow, but do not prove a particular paid provider/model will succeed.

## 7. Connect your terminal to Cloudflare

```bash
pnpm exec wrangler login
```

A browser page opens. Sign in to Cloudflare and allow Wrangler to deploy your app. This login is for you, the person publishing Rower. Your visitors will not see a login screen.

Then check the connection:

```bash
pnpm exec wrangler whoami
```

It should show your account. If you have several accounts, choose the intended one when prompted during deployment.

## 8. Publish a test copy first

```bash
pnpm run deploy:staging
```

This creates a separate app called `rower-staging`. The terminal prints its address, similar to:

```text
https://rower-staging.YOUR-SUBDOMAIN.workers.dev
```

Use the actual address printed in your terminal. This is a public test copy; it is separate from your main site.

If this is your first Worker, Cloudflare may ask you to choose your `workers.dev` subdomain. Follow that prompt. The app name is configured in `wrangler.jsonc`; choose a different name there if you already have another app called `rower` or `rower-staging` in this account.

Check the test copy:

1. Open the printed URL on your computer and phone.
2. Confirm **Start rowing** opens the workspace.
3. Open `YOUR-TEST-URL/api/health`. You should see `{"ok":true}`.
4. Use your provider key to test three rows with a model-only task, then export.
5. Try three rows of web research with a supported model.
6. Once you are happy with the results and cost, try a 100-row file. Use five rows per batch for web research.
7. Try **Pause after batch**, resume with **Run remaining rows**, and try **Cancel** on another run. Completed results should remain available for export. Cancelling cannot guarantee the provider stops billing an already accepted request.
8. In Cloudflare, open **Workers & Pages → rower-staging** and inspect the metrics and observability views. Look for failed requests and CPU time, including model-list requests.

The Free plan currently allows 10 ms of CPU per Worker request. Waiting for a model is different from CPU processing time. If you see error **1102**, first try smaller batches or smaller outputs and inspect the metrics. If ordinary requests still exceed the Free allowance, the same app can use Workers Paid; no rewrite is required. Review [Cloudflare’s current limits](https://developers.cloudflare.com/workers/platform/limits/) and pricing before changing plans.

The live 100-row provider test and real Cloudflare CPU measurement require your account and API credits. Local tests and deployment dry runs cannot replace them.

## 9. Publish the main website

When the test copy looks good, run:

```bash
pnpm run deploy
```

This rebuilds the production configuration and publishes the main app called `rower`. The terminal prints its live address:

```text
https://rower.YOUR-SUBDOMAIN.workers.dev
```

Open that exact address, check the landing page and workspace once more, and share it. Keep the full project folder; uploading just `dist/client` would leave out the API.

## 10. Add your own domain, if you want

The free `workers.dev` address already works. A custom domain is optional.

1. Add your domain to the same Cloudflare account and finish its DNS setup.
2. Open **Workers & Pages → rower → Settings → Domains & Routes**.
3. Choose **Add → Custom Domain**.
4. Enter the address you want, such as `rower.yourdomain.com`.
5. Confirm and wait for Cloudflare to finish setting it up.

To keep this domain in the project configuration too, add a top-level `routes` entry to `wrangler.jsonc` using your real address:

```json
"routes": [{ "pattern": "rower.yourdomain.com", "custom_domain": true }]
```

Make sure the surrounding JSON fields are separated by commas. Run `pnpm run deploy:check` and `pnpm run deploy` after editing it. See [Cloudflare’s Custom Domains guide](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) for the current dashboard steps.

## How to publish later changes

From the project folder:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run deploy:staging
```

Check the staging URL. If it looks right:

```bash
pnpm run deploy
```

Always use these package scripts. With the Cloudflare Vite plugin, staging is selected **while building**. Running plain `wrangler deploy` immediately after a staging build would use that staging output again. `pnpm run deploy` deliberately rebuilds the main app. [Cloudflare environment behavior](https://developers.cloudflare.com/workers/vite-plugin/reference/migrating-from-wrangler-dev/).

If a new release is broken, open the main Worker in the Cloudflare dashboard, go to its deployments, and roll back to the previous working version. This requires at least one earlier deployment.

## If something does not work

| What you see | What to do |
| --- | --- |
| `pnpm: command not found` | Complete step 3 and reopen the terminal. |
| A Node version error | Use Node 24–26. Check with `node --version`. |
| A package installation error | Check your internet connection and run step 4 again. |
| Cloudflare says you are not logged in | Run `pnpm exec wrangler login` again. |
| The page loads but models do not | Check the key, provider balance, and model access. Some compatible services do not list models; select **Custom model ID…** and enter the model’s exact name. |
| API returns 429 | Wait one minute. The app allows 10 model-list requests and 30 batches per minute per IP, so people on the same network share the allowance. Providers may also rate-limit requests. |
| API returns 413 | Reduce rows per batch or select fewer columns. Each request is limited to 3 MiB. |
| Web mode refuses a model | Choose a model with web support, or uncheck **Search the web for this task**. |
| Compatible endpoint fails | Use its final public HTTPS base URL, usually ending in `/v1`. Redirects, URL credentials, query strings, IP addresses, and private hostnames are rejected. Localhost works only in local development, not on your live site. |
| Error 1102 | Inspect CPU time in Cloudflare. See step 8. |
| Results disappear after refreshing | This is expected. Export before refreshing; there is no saved-run database. |

## What is deployed

- The landing page, fonts, two cell illustrations, and the optimized rowing animation.
- The workspace, browser spreadsheet parser, and exporter.
- A small Hono Worker with `/api/health`, `/api/models`, and `/api/execute`.
- Per-IP rate limits, body validation, key-redacted errors, cancellation propagation, and security headers.

There are no provider keys to configure on Cloudflare, no cookies, no saved spreadsheets, no database setup, and no Rower user accounts. Cloudflare receives selected cell values and the key transiently to forward the request; the chosen provider has its own data and retention policies. The app does not log bodies or keys. Keep request-body logging out of any monitoring you add later.

The supplied rowing animation was converted from your local GIF. Its original author and license were not included with the file; confirm you have permission to publish it before sharing the site publicly.
