import { z } from "zod";

export const ProviderIdSchema = z.enum(["anthropic", "openrouter", "openai", "compatible"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const OutputFieldSchema = z.object({
  name: z.string().trim().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  description: z.string().trim().max(2000).default(""),
  type: z.enum(["string", "boolean", "number"]).default("string")
});
export type OutputField = z.infer<typeof OutputFieldSchema>;

export const TaskSchema = z.object({
  name: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(20000),
  inputColumns: z.array(z.string().min(1).max(500)).min(1).max(64),
  outputFields: z.array(OutputFieldSchema).min(1).max(32),
  web: z.boolean().default(false)
}).superRefine((task, context) => {
  if (new Set(task.inputColumns).size !== task.inputColumns.length) {
    context.addIssue({ code: "custom", message: "Input columns must be unique.", path: ["inputColumns"] });
  }
  const names = task.outputFields.map((field) => field.name);
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: "custom", message: "Output column names must be unique.", path: ["outputFields"] });
  }
});

export const SourceRecordSchema = z.object({
  id: z.string().min(1).max(100),
  values: z.record(z.string().max(500), z.union([z.string().max(100000), z.number(), z.boolean(), z.null()]))
    .refine((values) => Object.keys(values).length <= 64, "Select at most 64 input columns.")
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const ModelsRequestSchema = z.object({
  provider: ProviderIdSchema,
  apiKey: z.string().trim().min(1, "Enter your provider API key.").max(4096),
  baseUrl: z.string().trim().max(2048).optional()
});

export const ExecuteRequestSchema = ModelsRequestSchema.extend({
  model: z.string().trim().min(1).max(200),
  structuredOutput: z.boolean().default(false),
  webStrength: z.enum(["low", "medium", "high"]).default("medium"),
  task: TaskSchema,
  records: z.array(SourceRecordSchema).min(1).max(25)
}).superRefine((request, context) => {
  if (request.task.web && request.records.length > 10) {
    context.addIssue({ code: "custom", message: "Web research supports at most 10 rows per batch.", path: ["records"] });
  }
  if (new Set(request.records.map((row) => row.id)).size !== request.records.length) {
    context.addIssue({ code: "custom", message: "Row IDs must be unique.", path: ["records"] });
  }
});
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

export function selectRecordColumns(records: SourceRecord[], columns: string[]): SourceRecord[] {
  return records.map((record) => ({ id: record.id, values: Object.fromEntries(columns.map((column) => [column, record.values[column] ?? null])) }));
}

export interface RowResult {
  id: string;
  output: Record<string, unknown>;
}

export interface ExecuteResponse {
  results: RowResult[];
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    webSearches?: number;
  };
  citations: string[];
}

export interface ModelInfo {
  id: string;
  name: string;
  web: boolean;
  structuredOutput: boolean;
}
