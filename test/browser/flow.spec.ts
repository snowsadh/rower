import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("landing examples, navigation, sample sheet and responsive layout", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello, Rower.");
  await page.getByRole("button", { name: "Compare values", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("same_role");
  await page.getByRole("button", { name: "Reset example" }).click();
  await expect(page.getByRole("table")).toContainText("Ready to fill");
  await page.getByRole("button", { name: "Fill the column" }).click();
  await expect(page.getByRole("table")).toContainText("Yes");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath("landing.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Start rowing", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A little less on your plate.");
  await expect(page.getByRole("button", { name: "Test 3 rows", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("workspace-empty.png"), fullPage: true });
  await page.getByRole("button", { name: "Try a sample sheet", exact: true }).click();
  await expect(page.locator(".run-heading")).toContainText("a-few-good-companies.csv");
  await expect(page.getByRole("table")).toContainText("Patagonia");
  await page.locator(".output-editor summary").click();
  await page.getByLabel("Output column name").first().fill("website_address");
  await expect(page.getByLabel("Output column name").first()).toBeFocused();
  await page.locator(".output-editor summary").click();
  await page.screenshot({ path: info.outputPath("workspace-loaded.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Rower home" }).click();
  await page.goBack();
  await expect(page.locator(".run-heading")).toContainText("a-few-good-companies.csv");
  expect(errors).toEqual([]);
});

test("upload, connect, test three rows, finish and export without leaking unselected columns", async ({ page }) => {
  const batches: Array<{ records: Array<{ id: string; values: Record<string, unknown> }>; apiKey: string }> = [];
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [{ id: "example-model", name: "Example model", web: true, structuredOutput: true }] } }));
  await page.route("**/api/execute", async (route) => {
    const body = route.request().postDataJSON(); batches.push(body);
    await route.fulfill({ json: { results: body.records.map((row: { id: string }) => ({ id: row.id, output: { official_website: "https://example.com/" + row.id, status: "FOUND", source: "https://example.com" } })), usage: { webSearches: body.records.length }, citations: [] } });
  });
  await page.goto("/#workspace");
  await page.getByLabel("Upload spreadsheet").setInputFiles({ name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from("company,private_note\nAcme,secret1\nGlobex,secret2\nInitech,secret3\nHooli,secret4\n") });
  await page.getByLabel("API key", { exact: true }).fill("test-browser-key");
  await page.getByRole("button", { name: "Connect and load models" }).click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("example-model");
  await page.getByRole("button", { name: "Test 3 rows", exact: true }).click();
  await expect(page.locator(".record-count strong")).toHaveText("3");
  await page.getByRole("button", { name: "Run remaining rows" }).click();
  await expect(page.locator(".record-count strong")).toHaveText("4");
  expect(batches.map((b) => b.records.length)).toEqual([3, 1]);
  expect(batches.every((b) => b.apiKey === "test-browser-key")).toBe(true);
  expect(batches.flatMap((b) => b.records).every((r) => Object.keys(r.values).join() === "company")).toBe(true);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe("companies-completed.csv");
  const csv = await readFile((await result.path())!, "utf8");
  expect(csv).toContain("private_note");
  expect(csv).toContain("secret4");
  expect(csv).toContain("https://example.com/row-4");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.getByRole("heading", { name: "A blank slate, for now." })).toBeVisible();
});

test("reduced motion keeps the rowing animation paused", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("video").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Play rowing animation" })).toBeVisible();
  expect(await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
});

test("pause finishes only the active batch and provider failure keeps completed rows", async ({ page }) => {
  let release!: () => void;
  const firstBatch = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [{ id: "example-model", name: "Example model", web: true, structuredOutput: true }] } }));
  await page.route("**/api/execute", async (route) => {
    calls++;
    if (calls === 1) {
      await firstBatch;
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { results: body.records.map((row: { id: string }) => ({ id: row.id, output: { official_website: "https://example.com", status: "FOUND", source: "https://example.com" } })), usage: {}, citations: [] } });
    } else await route.fulfill({ status: 503, json: { error: "Provider temporarily unavailable", retryable: false } });
  });
  await page.goto("/#workspace");
  await page.getByRole("button", { name: "Try a sample sheet", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).fill("test-key");
  await page.getByRole("button", { name: "Connect and load models" }).click();
  await page.getByLabel("Rows per batch").fill("1");
  await page.getByRole("button", { name: "Run remaining rows" }).click();
  await page.getByRole("button", { name: "Pause after batch" }).click();
  release();
  await expect(page.locator(".progress-meta")).toContainText("paused");
  expect(calls).toBe(1);
  await expect(page.locator(".record-count strong")).toHaveText("1");
  await page.getByRole("button", { name: "Run remaining rows" }).click();
  await expect(page.getByRole("alert")).toContainText("Provider temporarily unavailable");
  expect(calls).toBe(2);
  await expect(page.locator(".record-count strong")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
});

test("the deployed app serves the API and rejects localhost provider endpoints", async ({ request }) => {
  test.skip(process.env.ROWER_TEST_PRODUCTION !== "1", "Production-only security and routing checks");
  const home = await request.get("/");
  expect(home.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(await (await request.get("/api/health")).json()).toEqual({ ok: true });
  expect((await request.get("/api/runs/old-run")).status()).toBe(404);
  const response = await request.post("/api/models", { data: { provider: "compatible", apiKey: "fake-local-key", baseUrl: "http://localhost:11434/v1" } });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("HTTPS");
});
