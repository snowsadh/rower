<h1 align="center">rower<span style="color: #176e4c">.</span></h1>

<p align="center">
  AI spreadsheet workspace for bulk transformations. BYOK.
</p>

Rower runs one task across every row in a CSV or Excel file. Choose which columns the model may read, define the columns it should produce, test three rows, then process the rest in controlled batches and export the updated sheet.

It works with OpenAI, Anthropic, OpenRouter, and public OpenAI-compatible APIs using your own provider key. Supported providers can also research the web while processing rows.

## What it handles

- Typed output columns for research, matching, classification, and extraction.
- Test runs, configurable batches, pause, resume, cancellation, and partial export.
- CSV and Excel parsing in the browser, with original workbook data preserved.
- Formula-injection protection for generated spreadsheet cells.
- Provider errors, rate limits, malformed output, and request timeouts.

## Use it

Open the [live app](https://rower.snoe.workers.dev) and click **Start rowing**.

1. Upload a sheet or use the sample.
2. Select the input columns and describe the output you need.
3. Connect a provider, choose a model, and test three rows.
4. Run the remaining rows and export the result.

Provider charges may apply. Test a few rows and check provider usage before processing a large sheet.

## Run locally

Requires Node.js 24–26 and pnpm 10.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Run the automated checks with `pnpm test`.

## Data and keys

- Files are parsed locally. Only selected cells are sent to the Rower Worker and chosen provider.
- Keys and results remain in the current browser tab; refresh or close it and they are forgotten.
- The Worker does not save request bodies, keys, spreadsheets, or results.
- There are no Rower accounts, cookies, or server-side project storage.

Local `.dev.vars*` and `.env*` files are ignored by Git and excluded from production builds.

## Deployment

The React app and Hono API deploy together as one Cloudflare Worker. Follow the [step-by-step deployment guide](docs/deployment.md) for validation, staging, production, rollback, and troubleshooting.

## Project structure

```text
src/ui/        React interface and spreadsheet handling
src/server/    Worker routes and provider adapters
src/shared/    Shared request and response contracts
test/          Worker and browser tests
public/        Static assets and security headers
docs/          Deployment and implementation notes
```

## License

[MIT](LICENSE)
