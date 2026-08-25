import type { ExecuteResponse, ModelInfo } from "../../shared/contracts.js";
import { createPrompt, createResultSchema } from "../prompt.js";
import { parseJsonObject, providerFetch, ProviderError, readProviderJson, requireReportedWebResearch, validateProviderResults } from "./shared.js";
import type { ProviderAdapter } from "./types.js";

const API = "https://api.anthropic.com/v1";

// Anthropic's Messages API requires max_tokens. Unlike the optional limits in
// the other adapters, this cannot be omitted. Keep enough room for ordinary
// batched JSON without pretending we know each model's full output capacity.
function requiredOutputAllowance(recordCount: number, web: boolean) {
  if (web) return 8192;
  return Math.min(8192, Math.max(4096, 1024 + recordCount * 256));
}

function headers(apiKey: string) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
}

function supportsStructuredOutput(id: string) {
  return /(?:haiku-4-5|sonnet-4-[5-9]|opus-4-[5-9]|fable-5|mythos-5)/i.test(id);
}

function supportsWeb(id: string) {
  return /(?:claude-(?:3-5-haiku|3-7-sonnet|[4-9])|(?:haiku|sonnet|opus|fable|mythos)-(?:4|5))/i.test(id);
}

export const anthropicProvider: ProviderAdapter = {
  async listModels(apiKey): Promise<ModelInfo[]> {
    const response = await providerFetch(`${API}/models?limit=100`, { headers: headers(apiKey) }, { timeoutMs: 30_000 });
    const value = await readProviderJson(response, "Anthropic");
    const data = Array.isArray(value.data) ? value.data : [];
    return data.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const model = item as Record<string, unknown>;
      if (typeof model.id !== "string") return [];
      return [{
        id: model.id,
        name: typeof model.display_name === "string" ? model.display_name : model.id,
        web: supportsWeb(model.id),
        structuredOutput: supportsStructuredOutput(model.id)
      }];
    });
  },

  async execute(request): Promise<ExecuteResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: requiredOutputAllowance(request.records.length, request.task.web),
      system: "You transform spreadsheet records into validated structured data. Follow the task exactly and never omit a record.",
      messages: [{ role: "user", content: createPrompt(request) }]
    };

    if (request.task.web) {
      const searchesPerRecord = { low: 1, medium: 2, high: 3 }[request.webStrength];
      body.tools = [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: request.records.length * searchesPerRecord
      }];
    }
    // Anthropic citations and JSON output constraints cannot currently be combined.
    // Web responses are still validated after parsing.
    if (request.structuredOutput && !request.task.web) {
      body.output_config = {
        format: { type: "json_schema", schema: createResultSchema(request) }
      };
    }

    const response = await providerFetch(`${API}/messages`, {
      method: "POST",
      headers: headers(request.apiKey),
      body: JSON.stringify(body)
    }, { signal: request.signal, timeoutMs: request.task.web ? 300_000 : 120_000 });
    const value = await readProviderJson(response, "Anthropic");
    const blocks = Array.isArray(value.content) ? value.content as Array<Record<string, unknown>> : [];
    const searchErrors = blocks.flatMap((block) => {
      if (block.type !== "web_search_tool_result" || !block.content || typeof block.content !== "object" || Array.isArray(block.content)) return [];
      const content = block.content as Record<string, unknown>;
      return content.type === "web_search_tool_result_error" && typeof content.error_code === "string" ? [content.error_code] : [];
    });
    if (searchErrors.length) throw new ProviderError(`Anthropic web search failed: ${[...new Set(searchErrors)].join(", ")}.`);
    if (value.stop_reason === "pause_turn") throw new ProviderError("Anthropic paused the server-tool turn before returning results; the batch was not accepted.");
    if (value.stop_reason === "max_tokens") throw new ProviderError("Anthropic stopped before completing the batch because its required output allowance was exhausted.");
    const text = blocks.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string).join("\n");
    const citations = [...new Set(blocks.flatMap((block) => {
      if (!Array.isArray(block.citations)) return [];
      return block.citations.flatMap((citation) => {
        if (!citation || typeof citation !== "object") return [];
        const url = (citation as Record<string, unknown>).url;
        return typeof url === "string" ? [url] : [];
      });
    }))];
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    const serverUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
    const webSearches = typeof serverUse.web_search_requests === "number" ? serverUse.web_search_requests : undefined;
    requireReportedWebResearch(request.task.web, webSearches);

    return {
      results: validateProviderResults(parseJsonObject(text), request),
      usage: {
        inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
        webSearches
      },
      citations
    };
  }
};
