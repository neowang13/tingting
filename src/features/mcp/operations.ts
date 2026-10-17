import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api";
import { mcpServiceClient, type McpPrincipal } from "./auth";

interface Operation {
  id: string; credential_id: string; actor_user_id: string; tool: string; input_sha256: string;
  status: "pending" | "completed" | "uncertain"; result: Record<string, unknown> | null;
}
declare global { var __tingtingMcpOperations: Map<string, Operation> | undefined }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function getMcpOperation(principal: McpPrincipal, id: string) {
  let operation: Operation | null | undefined;
  if (process.env.DATA_BACKEND !== "supabase") operation = globalThis.__tingtingMcpOperations?.get(id);
  else {
    const { data, error } = await mcpServiceClient().from("mcp_operations").select("*").eq("id", id)
      .eq("credential_id", principal.credentialId).eq("actor_user_id", principal.admin.userId).maybeSingle();
    if (error) throw new ApiError(503, "MCP_AUDIT_UNAVAILABLE", "The operation record could not be loaded.");
    operation = data as Operation | null;
  }
  if (!operation || operation.credential_id !== principal.credentialId || operation.actor_user_id !== principal.admin.userId) {
    throw new ApiError(404, "MCP_OPERATION_NOT_FOUND", "Operation not found.");
  }
  return operation;
}
export async function runMcpWrite(principal: McpPrincipal, id: string, tool: string, input: unknown, write: () => Promise<Record<string, unknown>>) {
  const operation: Operation = { id, credential_id: principal.credentialId, actor_user_id: principal.admin.userId,
    tool, input_sha256: createHash("sha256").update(canonical(input)).digest("hex"), status: "pending", result: null };
  let claimed: boolean;
  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingMcpOperations ??= new Map();
    claimed = !globalThis.__tingtingMcpOperations.has(id);
    if (claimed) globalThis.__tingtingMcpOperations.set(id, operation);
  } else {
    const { error } = await mcpServiceClient().from("mcp_operations").insert(operation);
    if (error && error.code !== "23505") throw new ApiError(503, "MCP_AUDIT_UNAVAILABLE", "The action was not started because its audit record could not be saved.");
    claimed = !error;
  }
  if (!claimed) {
    const previous = await getMcpOperation(principal, id);
    if (previous.tool !== tool || previous.input_sha256 !== operation.input_sha256) throw new ApiError(409, "MCP_OPERATION_REUSED", "Use a new operation ID for a different action.");
    if (previous.status === "completed") return { ...previous.result, operationId: id, replayed: true };
    throw new ApiError(409, "MCP_OUTCOME_UNCERTAIN", "This action is pending or uncertain. Check its record and current resource before taking further action; do not retry with a new ID blindly.");
  }
  try {
    const result = await write();
    await finish(operation, "completed", result);
    return { ...result, operationId: id };
  } catch (error) {
    // The domain change or email may already have committed. Never auto-retry it.
    await finish(operation, "uncertain", { code: error instanceof ApiError ? error.code : "MCP_ACTION_FAILED" }).catch(() => undefined);
    throw error;
  }
}
async function finish(operation: Operation, status: Operation["status"], result: Record<string, unknown>) {
  if (process.env.DATA_BACKEND !== "supabase") {
    Object.assign(operation, { status, result });
    return;
  }
  const { data, error } = await mcpServiceClient().from("mcp_operations").update({ status, result, updated_at: new Date().toISOString() })
    .eq("id", operation.id).eq("status", "pending").select("id").maybeSingle();
  if (error || !data) throw new ApiError(503, "MCP_OUTCOME_UNCERTAIN", "The action may have completed, but its result could not be saved. Check current state before any retry.");
}
