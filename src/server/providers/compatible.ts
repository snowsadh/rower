import type { ExecuteResponse, ModelInfo } from "../../shared/contracts.js";
import { createPrompt, createResultSchema } from "../prompt.js";
import { parseJsonObject, providerFetch, ProviderError, readProviderJson, validateProviderResults } from "./shared.js";
import type { ProviderAdapter } from "./types.js";

export function normalizeCompatibleBaseUrl(value: unknown, allowLocal = false) {
  if (typeof value !== "string" || !value.trim()) throw new ProviderError("Enter the compatible endpoint’s API base URL.", 400);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ProviderError("Enter a valid API base URL.", 400); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  const local = allowLocal && loopback;
  if (url.username || url.password || url.search || url.hash) {
    throw new ProviderError("Use an API base URL without credentials, a query string, or a fragment.", 400);
  }
  if ((!local && (url.protocol !== "https:" || (url.port && url.port !== "443"))) || (local && !["http:", "https:"].includes(url.protocol))) {
    throw new ProviderError("Use a public HTTPS API endpoint. Localhost is available only in local development.", 400);
  }
  if (!local && (loopback || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host) || host === "metadata.google.internal")) {
    throw new ProviderError("Use a public provider hostname, not a local address or IP address.", 400);
  }
  return url.toString().replace(/\/$/, "");
}

export const compatibleProvider: ProviderAdapter = {
  async listModels(apiKey, baseUrl): Promise<ModelInfo[]> {
    const response = await providerFetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } }, { timeoutMs: 30_000 });
    if (response.status === 404 || response.status === 405) return [];
    const value = await readProviderJson(response, "The compatible endpoint");
    const data = Array.isArray(value.data) ? value.data : [];
    return data.flatMap((item) => {
      const id = item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined;
      return typeof id === "string" ? [{ id, name: id, web: false, structuredOutput: false }] : [];
    });
  },

  async execute(request): Promise<ExecuteResponse> {
    if (request.task.web) throw new ProviderError("Web search is not portable across OpenAI-compatible endpoints.", 400);
    const body: Record<string, unknown> = {
      model: request.model,
      messages: [
        { role: "system", content: "Transform spreadsheet records into one JSON object only." },
        { role: "user", content: createPrompt(request) }
      ],
      temperature: 0
    };
    if (request.structuredOutput) {
      body.response_format = { type: "json_schema", json_schema: { name: "rower_results", strict: true, schema: createResultSchema(request) } };
    }
    const response = await providerFetch(`${request.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }, { signal: request.signal, timeoutMs: 120_000 });
    const value = await readProviderJson(response, "The compatible endpoint");
    const choices = Array.isArray(value.choices) ? value.choices as Array<Record<string, unknown>> : [];
    const message = (choices[0]?.message ?? {}) as Record<string, unknown>;
    const text = typeof message.content === "string" ? message.content : "";
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    return {
      results: validateProviderResults(parseJsonObject(text), request),
      usage: {
        inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
        outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined
      },
      citations: []
    };
  }
};
