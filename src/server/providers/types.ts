import type { ExecuteRequest, ExecuteResponse, ModelInfo } from "../../shared/contracts.js";

export interface ProviderAdapter {
  listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]>;
  execute(request: ExecuteRequest & { apiKey: string; baseUrl?: string; signal?: AbortSignal }): Promise<ExecuteResponse>;
}
