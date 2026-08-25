import type { ExecuteResponse, ModelInfo } from "../../shared/contracts.js";
import { createPrompt, createResultSchema } from "../prompt.js";
import { parseJsonObject, providerFetch, ProviderError, readProviderJson, requireReportedWebResearch, validateProviderResults } from "./shared.js";
import type { ProviderAdapter } from "./types.js";

const API = "https://api.openai.com/v1";

function supportsWeb(id: string) {
  return /^(?:gpt-(?:4\.1|5|[6-9])|chat-latest|o[3-9])/i.test(id);
}

function isTextModel(id: string) {
  return /^(?:gpt-(?:4o|4\.1|5|[6-9])|o[1-9]|chat-)/i.test(id) && !/(?:audio|realtime|transcribe|tts|image|search-preview)/i.test(id);
}

function supportsStructuredOutput(id: string) {
  return /^(?:gpt-(?:4o|4\.1|5|[6-9])|o[3-9])/i.test(id) && !/-pro(?:-|$)/i.test(id);
}

function extractResponsePayload(value: Record<string, unknown>) {
  if (typeof value.output_text === "string" && value.output_text.trim()) {
    return { text: value.output_text, json: undefined as Record<string, unknown> | undefined };
  }

  const output = Array.isArray(value.output) ? value.output as Array<Record<string, unknown>> : [];
  const textParts: string[] = [];
  let json: Record<string, unknown> | undefined;
  let refusal: string | undefined;

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const part of content) {
      if (typeof part.text === "string") textParts.push(part.text);
      else if (part.text && typeof part.text === "object" && typeof (part.text as Record<string, unknown>).value === "string") {
        textParts.push((part.text as Record<string, unknown>).value as string);
      }
      if (part.json && typeof part.json === "object" && !Array.isArray(part.json)) json = part.json as Record<string, unknown>;
      if (typeof part.refusal === "string") refusal = part.refusal;
    }
  }

  if (refusal) throw new ProviderError(`OpenAI refused the request: ${refusal}`, 422);
  if (!json && !textParts.join("\n").trim()) {
    const status = typeof value.status === "string" ? value.status : "unknown";
    const outputTypes = output.map((item) => String(item.type ?? "unknown")).join(", ") || "none";
    const incomplete = value.incomplete_details && typeof value.incomplete_details === "object"
      ? JSON.stringify(value.incomplete_details)
      : "none";
    throw new ProviderError(`OpenAI returned no usable output (status: ${status}; output types: ${outputTypes}; incomplete details: ${incomplete}).`, 422);
  }
  return { text: textParts.join("\n"), json };
}

export const openAIProvider: ProviderAdapter = {
  async listModels(apiKey): Promise<ModelInfo[]> {
    const response = await providerFetch(`${API}/models`, { headers: { authorization: `Bearer ${apiKey}` } }, { timeoutMs: 30_000 });
    const value = await readProviderJson(response, "OpenAI");
    const data = Array.isArray(value.data) ? value.data : [];
    return data.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).id !== "string") return [];
      const id = (item as Record<string, unknown>).id as string;
      if (!isTextModel(id)) return [];
      return [{ id, name: id, web: supportsWeb(id), structuredOutput: supportsStructuredOutput(id) }];
    }).sort((a, b) => a.id.localeCompare(b.id));
  },

  async execute(request): Promise<ExecuteResponse> {
    if (request.task.web && !supportsWeb(request.model)) {
      throw new ProviderError("This OpenAI model does not support web search in the Responses API.", 400);
    }
    const body: Record<string, unknown> = {
      model: request.model,
      instructions: "You transform spreadsheet records into validated structured data. Return every requested record exactly once.",
      input: createPrompt(request)
    };
    if (request.task.web) body.tools = [{ type: "web_search", search_context_size: request.webStrength }];
    if (request.structuredOutput) {
      body.text = {
        format: { type: "json_schema", name: "rower_results", strict: true, schema: createResultSchema(request) }
      };
    }

    const response = await providerFetch(`${API}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }, { signal: request.signal, timeoutMs: request.task.web ? 300_000 : 120_000 });
    const value = await readProviderJson(response, "OpenAI");
    const output = Array.isArray(value.output) ? value.output as Array<Record<string, unknown>> : [];
    const payload = extractResponsePayload(value);
    const citations = [...new Set(output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
      .flatMap((part) => part && typeof part === "object" && Array.isArray((part as Record<string, unknown>).annotations) ? (part as Record<string, unknown>).annotations as Array<Record<string, unknown>> : [])
      .flatMap((annotation) => typeof annotation.url === "string" ? [annotation.url] : []))];
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    const webSearches = output.filter((item) => item.type === "web_search_call").length;
    requireReportedWebResearch(request.task.web, webSearches);
    return {
      results: validateProviderResults(payload.json ?? parseJsonObject(payload.text), request),
      usage: {
        inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
        webSearches
      },
      citations
    };
  }
};
