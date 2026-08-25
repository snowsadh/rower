interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  MODELS_LIMITER: RateLimitBinding;
  EXECUTE_LIMITER: RateLimitBinding;
}

declare module "cloudflare:workers" {
  export const env: Env;
}
