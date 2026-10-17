import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
export const mcpScopes = ["rentals:read", "rentals:write", "applications:read", "applications:write", "showings:read", "showings:write"] as const;
export type McpScope = typeof mcpScopes[number];
export function mcpOrigin() {
  if (process.env.MCP_ENABLED !== "true") throw new ApiError(404, "NOT_FOUND", "Not found.");
  let url: URL;
  try { url = new URL(process.env.APP_BASE_URL ?? ""); } catch { throw new ApiError(503, "MCP_UNAVAILABLE", "MCP origin is not configured."); }
  if (process.env.NODE_ENV === "production" && (process.env.DATA_BACKEND !== "supabase" || url.protocol !== "https:")) {
    throw new ApiError(503, "MCP_UNAVAILABLE", "Production MCP requires durable storage and HTTPS.");
  }
  return url.origin;
}
export function mcpResource() { return `${mcpOrigin()}/api/mcp`; }
export function mcpServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, "MCP_UNAVAILABLE", "MCP storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function tokenHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
