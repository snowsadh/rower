import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { ExecuteRequestSchema, ModelsRequestSchema } from "../shared/contracts.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { openRouterProvider } from "./providers/openrouter.js";
import { openAIProvider } from "./providers/openai.js";
import { compatibleProvider, normalizeCompatibleBaseUrl } from "./providers/compatible.js";
import { ProviderError } from "./providers/shared.js";
import type { ProviderAdapter } from "./providers/types.js";

const app = new Hono<{ Bindings: Env; Variables: { apiKey: string } }>();
const providers: Record<string, ProviderAdapter> = {
  anthropic: anthropicProvider, openrouter: openRouterProvider,
  openai: openAIProvider, compatible: compatibleProvider
};

app.use("/api/*", secureHeaders());
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (c.req.method === "POST") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Use Rower from this website." }, 403);
    if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return c.json({ error: "Send a JSON request." }, 415);
    }
    const limiter = c.req.path === "/api/models" ? c.env.MODELS_LIMITER : c.env.EXECUTE_LIMITER;
    // Coarse abuse protection. People sharing a network share this allowance.
    const { success } = await limiter.limit({ key: c.req.header("cf-connecting-ip") || "local" });
    if (!success) {
      c.header("Retry-After", "60");
      return c.json({ error: "A few too many requests. Give it a minute, then try again.", retryable: true, retryAfterMs: 60000 }, 429);
    }
  }
  await next();
});
app.use("/api/*", bodyLimit({
  maxSize: 3 * 1024 * 1024,
  onError: (c) => c.json({ error: "This batch is too large. Select fewer columns or reduce the rows per batch." }, 413)
}));

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/models", async (c) => {
  const input = ModelsRequestSchema.parse(await c.req.json());
  c.set("apiKey", input.apiKey);
  const baseUrl = input.provider === "compatible"
    ? normalizeCompatibleBaseUrl(input.baseUrl, import.meta.env.DEV) : undefined;
  const models = await providers[input.provider].listModels(input.apiKey, baseUrl);
  return c.json({ models });
});

app.post("/api/execute", async (c) => {
  const input = ExecuteRequestSchema.parse(await c.req.json());
  c.set("apiKey", input.apiKey);
  const baseUrl = input.provider === "compatible"
    ? normalizeCompatibleBaseUrl(input.baseUrl, import.meta.env.DEV) : undefined;
  const result = await providers[input.provider].execute({ ...input, baseUrl, signal: c.req.raw.signal });
  return c.json(result);
});

app.notFound((c) => c.json({ error: "This API route does not exist." }, 404));
app.onError((error, c) => {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return c.json({ error: "Check " + (issue.path.join(".") || "your request") + ": " + issue.message }, 400);
  }
  if (error instanceof SyntaxError) return c.json({ error: "The request contains invalid JSON." }, 400);
  if (c.req.raw.signal.aborted) return c.json({ error: "Request cancelled.", retryable: false }, 499 as ContentfulStatusCode);
  if (error instanceof ProviderError) {
    const key = c.get("apiKey");
    const message = (key ? error.message.split(key).join("[redacted]") : error.message).slice(0, 600);
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
    return c.json({ error: message, retryable: error.retryable, retryAfterMs: error.retryAfterMs }, status as ContentfulStatusCode);
  }
  // Never log request bodies, provider keys, or unexpected upstream payloads.
  return c.json({ error: "Rower could not complete this request. Please try again.", retryable: false }, 500);
});

export default app;
