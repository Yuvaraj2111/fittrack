const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

function csrfToken() {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((part) => part.startsWith("csrf_token="))?.split("=")[1] ?? "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", csrfToken());
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.error?.message ?? "Something went wrong. Please try again.", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const today = () => new Date().toISOString().slice(0, 10);
