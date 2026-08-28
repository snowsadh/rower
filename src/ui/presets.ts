import type { OutputField } from "../shared/contracts";

export type PresetId = "website" | "compare" | "custom";

interface TaskPreset {
  id: PresetId;
  label: string;
  name: string;
  prompt: string;
  outputFields: OutputField[];
  web: boolean;
  batchSize: number;
}

export const presets: TaskPreset[] = [
  {
    id: "website",
    label: "Official website",
    name: "Find the official website",
    prompt: "Find the official website for the organization in each record. Prefer a company-owned domain over directories, social profiles, marketplaces, and news pages. If uncertain, say so instead of guessing.",
    outputFields: [
      { name: "official_website", description: "Canonical official website URL, or an empty string when unresolved", type: "string" },
      { name: "status", description: "One of FOUND, UNCERTAIN, or NOT_FOUND", type: "string" },
      { name: "source", description: "The strongest supporting source URL", type: "string" }
    ],
    web: true,
    batchSize: 5
  },
  {
    id: "compare",
    label: "Compare values",
    name: "Compare two values semantically",
    prompt: "Decide whether the two selected values describe the same role or concept. Consider abbreviations and ordinary wording differences. Treat materially different seniority, discipline, or employment type as different. Explain the decisive distinction briefly.",
    outputFields: [
      { name: "same", description: "Whether the two values are semantically equivalent", type: "boolean" },
      { name: "confidence", description: "One of high, medium, or low", type: "string" },
      { name: "reason", description: "A brief explanation", type: "string" }
    ],
    web: false,
    batchSize: 25
  },
  {
    id: "custom",
    label: "Custom task",
    name: "Custom task",
    prompt: "Transform each record according to the requested result.",
    outputFields: [
      { name: "result", description: "The requested result", type: "string" }
    ],
    web: false,
    batchSize: 20
  }
];
