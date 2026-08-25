import type { ExecuteResponse, ModelInfo } from "../../shared/contracts.js";
import { createPrompt, createResultSchema } from "../prompt.js";
import { parseJsonObject, providerFetch, readProviderJson, requireReportedWebResearch, validateProviderResults } from "./shared.js";
import type { ProviderAdapter } from "./types.js";

const API = "https://openrouter.ai/api/v1";

export const openRouterProvider: ProviderAdapter = {
  async listModels(apiKey): Promise<ModelInfo[]> {
    const response = await providerFetch(`${API}/models`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined
    }, { timeoutMs: 30_000 });
    const value = await readProviderJson(response, "OpenRouter");
    const data = Array.isArray(value.data) ? value.data : [];
    return data.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const model = item as Record<string, unknown>;
      if (typeof model.id !== "string") return [];
      const params = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
      const pricing = (model.pricing ?? {}) as Record<string, unknown>;
      const free = pricing.prompt === "0" && pricing.completion === "0";
      return [{
        id: model.id,
        name: `${typeof model.name === "string" ? model.name : model.id}${free ? " · free" : ""}`,
        web: true,
        structuredOutput: params.includes("structured_outputs") || params.includes("response_format")
      }];
    }).sort((a, b) => Number(b.name.endsWith("· free")) - Number(a.name.endsWith("· free")) || a.name.localeCompare(b.name));
  },

  async execute(request): Promise<ExecuteResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: [
        { role: "system", content: "You transform spreadsheet records into validated structured data. Respond with one JSON object only." },
        { role: "user", content: createPrompt(request) }
      ],
      temperature: 0
    };
    if (request.task.web) {
      const profile = {
        low: { maxResults: 3, maxCharacters: 1200, callsPerRecord: 1 },
        medium: { maxResults: 5, maxCharacters: 2200, callsPerRecord: 2 },
        high: { maxResults: 8, maxCharacters: 4000, callsPerRecord: 3 }
      }[request.webStrength];
      const maxToolCalls = request.records.length * profile.callsPerRecord;
      const searchParameters = {
        engine: "exa",
        max_results: profile.maxResults,
        max_total_results: maxToolCalls * profile.maxResults,
        max_characters: profile.maxCharacters
      };
      body.tools = [{
        type: "openrouter:web_search",
        parameters: searchParameters
      }];
      body.max_tool_calls = maxToolCalls;
    }
    if (request.structuredOutput) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "rower_results", strict: true, schema: createResultSchema(request) }
      };
      body.provider = { require_parameters: true };
    }

    const response = await providerFetch(`${API}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
        "X-Title": "Rower"
      },
      body: JSON.stringify(body)
    }, { signal: request.signal, timeoutMs: request.task.web ? 300_000 : 120_000 });
    const value = await readProviderJson(response, "OpenRouter");
    const choices = Array.isArray(value.choices) ? value.choices as Array<Record<string, unknown>> : [];
    const message = (choices[0]?.message ?? {}) as Record<string, unknown>;
    const content = message.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, unknown>).text as string] : []).join("\n")
        : "";
    const annotations = Array.isArray(message.annotations) ? message.annotations as Array<Record<string, unknown>> : [];
    const citations = [...new Set(annotations.flatMap((annotation) => {
      const citation = annotation.url_citation as Record<string, unknown> | undefined;
      return typeof citation?.url === "string" ? [citation.url] : [];
    }))];
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    const serverUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
    const webSearches = typeof serverUse.web_search_requests === "number" ? serverUse.web_search_requests : undefined;
    requireReportedWebResearch(request.task.web, webSearches);

    return {
      results: validateProviderResults(parseJsonObject(text), request),
      usage: {
        inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
        outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
        webSearches
      },
      citations
    };
  }
};
