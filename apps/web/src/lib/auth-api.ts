import type {
  AuthLoginUrlResponse,
  AuthLogoutResponse,
  AuthStatusResponse,
} from "@sparkle/shared/schemas/auth";

const BASE = "/auth/claude-code";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchClaudeCodeStatus(): Promise<AuthStatusResponse> {
  return requestJson<AuthStatusResponse>(`${BASE}/status`);
}

export function startClaudeCodeLogin(): Promise<AuthLoginUrlResponse> {
  return requestJson<AuthLoginUrlResponse>(`${BASE}/login`, { method: "POST" });
}

export function logoutClaudeCode(): Promise<AuthLogoutResponse> {
  return requestJson<AuthLogoutResponse>(`${BASE}/logout`, { method: "POST" });
}
