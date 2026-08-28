import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecuteRequestSchema } from "../../shared/contracts.js";
import { anthropicProvider } from "./anthropic.js";
import { compatibleProvider } from "./compatible.js";
import { openAIProvider } from "./openai.js";
import { openRouterProvider } from "./openrouter.js";

const baseRequest = ExecuteRequestSchema.parse({
  provider: "openrouter",
  model: "vendor/model",
  apiKey: "test-key",
  structuredOutput: true,
  webStrength: "medium",
  task: {
    name: "Find websites",
    prompt: "Find the official website.",
    inputColumns: ["company"],
    outputFields: [{ name: "website", description: "Official URL", type: "string" }],
    web: true
  },
  records: [
    { id: "row-1", values: { company: "Acme" } },
    { id: "row-2", values: { company: "Globex" } }
  ]
});

afterEach(() => vi.unstubAllGlobals());

describe("provider request translation", () => {
  it("only offers current OpenAI text families and reports conservative capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "gpt-5-mini" },
      { id: "gpt-4.1-nano" },
      { id: "gpt-4o-mini" },
      { id: "gpt-3.5-turbo" },
      { id: "gpt-5-audio" }
    ] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const models = await openAIProvider.listModels("secret");
    expect(models.map((item) => item.id)).toEqual(["gpt-4.1-nano", "gpt-4o-mini", "gpt-5-mini"]);
    expect(models.find((item) => item.id === "gpt-4.1-nano")).toMatchObject({ web: true, structuredOutput: true });
    expect(models.find((item) => item.id === "gpt-4o-mini")).toMatchObject({ web: false, structuredOutput: true });
  });

  it("maps medium search strength to bounded Exa research", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, server_tool_use: { web_search_requests: 2 } }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await openRouterProvider.execute({ ...baseRequest, apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools[0].parameters).toEqual({ engine: "exa", max_results: 5, max_total_results: 20, max_characters: 2200 });
    expect(body.max_tool_calls).toBe(4);
    expect(result.usage.webSearches).toBe(2);
  });

  it("maps low search strength to the smallest Exa limits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) } }],
      usage: { server_tool_use: { web_search_requests: 1 } }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await openRouterProvider.execute({ ...baseRequest, webStrength: "low", apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools[0].parameters).toEqual({ engine: "exa", max_results: 3, max_total_results: 6, max_characters: 1200 });
    expect(body.max_tool_calls).toBe(2);
  });

  it("maps high search strength to larger Exa limits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await openRouterProvider.execute({ ...baseRequest, webStrength: "high", apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools[0].parameters).toEqual({ engine: "exa", max_results: 8, max_total_results: 48, max_characters: 4000 });
    expect(body.max_tool_calls).toBe(6);
  });

  it("does not combine Anthropic web citations with constrained JSON output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) }],
      usage: { input_tokens: 20, output_tokens: 10, server_tool_use: { web_search_requests: 2 } }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await anthropicProvider.execute({ ...baseRequest, provider: "anthropic", model: "claude-haiku-4-5", apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools[0].type).toBe("web_search_20250305");
    expect(body.tools[0].max_uses).toBe(4);
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBe(8192);
  });

  it.each([
    ["low", 2],
    ["high", 6]
  ] as const)("maps %s search strength to Anthropic's search-use limit", async (webStrength, maxUses) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) }],
      usage: { server_tool_use: { web_search_requests: 1 } }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await anthropicProvider.execute({ ...baseRequest, provider: "anthropic", model: "claude-haiku-4-5", webStrength, apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools[0].max_uses).toBe(maxUses);
  });

  it("does not accept a successful HTTP response containing an Anthropic search failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{
        type: "web_search_tool_result",
        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" }
      }],
      stop_reason: "end_turn",
      usage: { server_tool_use: { web_search_requests: 1 } }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(anthropicProvider.execute({ ...baseRequest, provider: "anthropic", model: "claude-haiku-4-5", apiKey: "secret" }))
      .rejects.toThrow(/max_uses_exceeded/i);
  });

  it("uses the OpenAI Responses API with native structured output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) }] }, { type: "web_search_call" }],
      usage: { input_tokens: 20, output_tokens: 10 }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await openAIProvider.execute({ ...baseRequest, provider: "openai", model: "gpt-5.4-nano", apiKey: "secret" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools).toEqual([{ type: "web_search", search_context_size: "medium" }]);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(result.usage.webSearches).toBe(1);
  });

  it("never forces an incompatible reasoning effort on OpenAI web search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }),
      output: [{ type: "web_search_call" }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await openAIProvider.execute({ ...baseRequest, provider: "openai", model: "gpt-5-mini", apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools).toEqual([{ type: "web_search", search_context_size: "medium" }]);
    expect(body.reasoning).toBeUndefined();
  });

  it.each(["low", "high"] as const)("passes %s search strength to OpenAI", async (webStrength) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }),
      output: [{ type: "web_search_call" }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await openAIProvider.execute({ ...baseRequest, provider: "openai", model: "gpt-5-mini", webStrength, apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools).toEqual([{ type: "web_search", search_context_size: webStrength }]);
  });

  it("does not impose optional output limits on routed models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await openRouterProvider.execute({ ...baseRequest, apiKey: "secret" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("does not impose an output limit on compatible endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }) } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await compatibleProvider.execute({
      ...baseRequest,
      provider: "compatible",
      task: { ...baseRequest.task, web: false },
      apiKey: "secret",
      baseUrl: "https://example.test/v1"
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("accepts the Responses API top-level output_text field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ results: [
        { id: "row-1", output: { website: "https://acme.test" } },
        { id: "row-2", output: { website: "https://globex.test" } }
      ] }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 20, output_tokens: 10 }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await openAIProvider.execute({ ...baseRequest, provider: "openai", model: "gpt-5.6-luna", apiKey: "secret" });
    expect(result.results).toHaveLength(2);
  });

  it("propagates cancellation to an active provider request", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const execution = openAIProvider.execute({
      ...baseRequest,
      provider: "openai",
      task: { ...baseRequest.task, web: false },
      apiKey: "secret",
      signal: controller.signal
    });

    controller.abort();
    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });
});
