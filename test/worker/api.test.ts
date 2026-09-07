import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "../../src/server/index";
import { normalizeCompatibleBaseUrl } from "../../src/server/providers/compatible";
import { selectRecordColumns } from "../../src/shared/contracts";

const request = {
  provider: "openai", model: "gpt-5-mini", apiKey: "private-test-key",
  task: { name: "Classify", prompt: "Classify the company.", inputColumns: ["company"], outputFields: [{ name: "category", type: "string" }], web: false },
  records: [{ id: "row-1", values: { company: "Acme" } }]
};
let identity = 0;
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request("https://rower.test" + path, {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "test-" + identity++, ...headers }, body: JSON.stringify(body)
  }, env);
}
afterEach(() => vi.unstubAllGlobals());

describe("hosted Worker boundary", () => {
  it("has health, JSON 404s, and no saved-run endpoint", async () => {
    expect(await (await app.request("https://rower.test/api/health", {}, env)).json()).toEqual({ ok: true });
    const missing = await app.request("https://rower.test/api/runs/anything", {}, env);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects cross-origin requests and non-JSON bodies before contacting providers", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await post("/api/models", request, { origin: "https://other.test" })).status).toBe(403);
    expect((await post("/api/models", request, { "content-type": "text/plain" })).status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires a key, unique rows and at most 10 web rows", async () => {
    expect((await post("/api/models", { provider: "openai" })).status).toBe(400);
    expect((await post("/api/execute", { ...request, records: [request.records[0], request.records[0]] })).status).toBe(400);
    expect((await post("/api/execute", { ...request, task: { ...request.task, web: true }, records: Array.from({ length: 11 }, (_, i) => ({ ...request.records[0], id: "row-" + i })) })).status).toBe(400);
  });
  it("limits bytes before JSON parsing", async () => {
    const response = await post("/api/models", { ...request, excess: "x".repeat(3 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(await response.json()).toHaveProperty("error");
  });
  it("returns models without credentials or server sessions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }] }))));
    const response = await post("/api/models", request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ models: [{ id: "gpt-5-mini", name: "gpt-5-mini", web: true, structuredOutput: true }] });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("executes with this request's key and uses manual redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify({ results: [{ id: "row-1", output: { category: "Business" } }] }) })));
    vi.stubGlobal("fetch", fetch);
    const response = await post("/api/execute", request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ id: "row-1", output: { category: "Business" } }] });
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { authorization: "Bearer private-test-key" }, redirect: "manual" });
  });
  it("redacts a key echoed by an upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid private-test-key" } }), { status: 401 })));
    const response = await post("/api/execute", request);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("private-test-key");
  });
  it("propagates incoming cancellation to provider fetch", async () => {
    let sent!: () => void;
    const started = new Promise<void>((resolve) => { sent = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); sent();
    })));
    const controller = new AbortController();
    const result = app.request(new Request("https://rower.test/api/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: controller.signal }), {}, env);
    await started; controller.abort();
    expect((await result).status).toBe(499);
  });
  it("returns a usable rate-limit response", async () => {
    const limitedEnv = { ...env, MODELS_LIMITER: { limit: async () => ({ success: false }) } } as Env;
    const response = await app.request("https://rower.test/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }, limitedEnv);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({ retryable: true, retryAfterMs: 60000 });
  });
  it("filters unselected fields before sending data", () => {
    expect(selectRecordColumns([{ id: "r", values: { company: "Acme", salary: 100 } }], ["company"])).toEqual([{ id: "r", values: { company: "Acme" } }]);
  });
  it.each(["http://provider.com/v1", "https://127.0.0.1/v1", "https://[::1]/v1", "https://service.local/v1", "https://user:pass@provider.com/v1", "https://provider.com/v1?key=secret", "https://provider.com/v1#secret", "https://provider.com:8080/v1"])("rejects unsafe production endpoints: %s", (url) => {
    expect(() => normalizeCompatibleBaseUrl(url)).toThrow();
  });
  it("permits a public HTTPS endpoint and localhost only with explicit local mode", () => {
    expect(normalizeCompatibleBaseUrl("https://provider.com/v1/")).toBe("https://provider.com/v1");
    expect(() => normalizeCompatibleBaseUrl("http://localhost:11434/v1")).toThrow();
    expect(normalizeCompatibleBaseUrl("http://localhost:11434/v1", true)).toBe("http://localhost:11434/v1");
  });
});
