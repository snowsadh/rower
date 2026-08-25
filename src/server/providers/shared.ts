import type { ExecuteRequest, RowResult } from "../../shared/contracts.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly retryable = false,
    public readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

export function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

// Busy responses can be retried; ambiguous server failures stop the run.
export function isSafeToRetry(status: number) {
  return status === 429 || status === 529;
}

export async function readProviderJson(response: Response, providerName: string) {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new ProviderError("The provider response was too large. Try fewer rows or a smaller output.", 502);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed as Record<string, unknown>;
  } catch { /* The HTTP status below still provides a useful error. */ }
  if (!response.ok) {
    const error = value.error as Record<string, unknown> | undefined;
    const message = typeof error?.message === "string" ? error.message : `${providerName} returned HTTP ${response.status}.`;
    throw new ProviderError(message, response.status, isSafeToRetry(response.status), retryAfterMilliseconds(response));
  }
  return value;
}

export function requireReportedWebResearch(webRequested: boolean, webSearches: number | undefined) {
  if (webRequested && webSearches === 0) {
    throw new ProviderError("The provider returned an answer without using web search, so the batch was not accepted.");
  }
}

export async function providerFetch(
  input: string,
  init: RequestInit,
  options: { signal?: AbortSignal; timeoutMs: number }
) {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  try {
    // Workers supports manual redirects; reject them below instead of following one.
    const response = await fetch(input, { ...init, redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) throw new ProviderError("Provider redirects are not supported. Enter the final API base URL.", 502);
    return response;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timeoutSignal.aborted) throw new ProviderError("The provider request timed out. The run was stopped before another batch was requested.", 504);
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("Could not reach the provider. Check the API endpoint and try again.", 502);
  }
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new ProviderError("The model did not return a JSON object.");
  }
}

export function validateProviderResults(
  value: Record<string, unknown>,
  request: ExecuteRequest
): RowResult[] {
  if (!Array.isArray(value.results)) {
    throw new ProviderError("The provider response did not include a results array.");
  }

  const expectedIds = new Set(request.records.map((record) => record.id));
  const seenIds = new Set<string>();
  const results: RowResult[] = [];

  for (const candidate of value.results) {
    if (!candidate || typeof candidate !== "object") {
      throw new ProviderError("A provider result was not an object.");
    }
    const row = candidate as Record<string, unknown>;
    if (typeof row.id !== "string" || !expectedIds.has(row.id) || seenIds.has(row.id)) {
      throw new ProviderError("The provider returned a missing, duplicate, or unknown row ID.");
    }
    if (!row.output || typeof row.output !== "object" || Array.isArray(row.output)) {
      throw new ProviderError(`The provider returned invalid output for ${row.id}.`);
    }

    const output = row.output as Record<string, unknown>;
    const expectedFields = new Set(request.task.outputFields.map((field) => field.name));
    if (Object.keys(output).some((field) => !expectedFields.has(field))) {
      throw new ProviderError(`The provider returned an undeclared output field for ${row.id}.`);
    }
    for (const field of request.task.outputFields) {
      const fieldValue = output[field.name];
      if (fieldValue === undefined || typeof fieldValue !== field.type) {
        throw new ProviderError(`Output field ${field.name} was missing or had the wrong type.`);
      }
    }
    results.push({ id: row.id, output });
    seenIds.add(row.id);
  }

  if (seenIds.size !== expectedIds.size) {
    throw new ProviderError("The provider omitted one or more source records.");
  }
  return results;
}
