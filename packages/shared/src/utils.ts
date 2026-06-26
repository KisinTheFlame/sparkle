import type { HealthResponse } from "./schemas/health.js";

export function createHealthResponse(service: string): HealthResponse {
  return {
    status: "ok",
    service,
    timestamp: new Date().toISOString(),
  };
}

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}
