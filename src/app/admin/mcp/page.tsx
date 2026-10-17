import { AdminShell } from "@/components/admin/admin-shell";
import { McpConnections } from "@/components/admin/mcp-connections";
import { requireAdminPage } from "@/lib/auth";
import { mcpOrigin } from "@/features/mcp/config";
import { listOAuthGrants } from "@/features/mcp/oauth-store";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function ConnectionsPage() {
  if (process.env.MCP_ENABLED !== "true") notFound();
  mcpOrigin(); const admin = await requireAdminPage();
  return <AdminShell admin={admin} title="Connected apps" description="Manage the assistants you have authorized with your Admin account.">
    <McpConnections connections={await listOAuthGrants(admin.userId)} />
  </AdminShell>;
}
