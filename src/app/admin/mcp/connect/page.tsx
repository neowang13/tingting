import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";
import { mcpOrigin } from "@/features/mcp/config";
import { getOAuthClient, getOAuthConsent } from "@/features/mcp/oauth-store";
import { McpConnectionApproval } from "@/components/admin/mcp-connection-approval";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (process.env.MCP_ENABLED !== "true") notFound();
  mcpOrigin(); const admin = await requireAdminPage(); const { id } = await searchParams;
  let consent; let client;
  try { consent = await getOAuthConsent(id ?? "", admin.userId); client = await getOAuthClient(consent.client_id); } catch { /* Expired requests must be restarted from the client. */ }
  return <main className="admin-body admin-auth-page"><section className="admin-auth-card mcp-consent-card">
    <div className="admin-auth-brand">Silverkey Admin</div><h1>Connect your assistant</h1>
    {consent && client ? <>
      <p>Signed in as <strong>{admin.email}</strong>.</p>
      <p><strong>{client.client_name}</strong> is asking to manage your website.</p>
      <p>After authorization you will return to <strong>{new URL(consent.redirect_uri).origin}</strong>. Only allow a connection you started and a destination you recognize.</p>
      <McpConnectionApproval requestId={consent.id} scopes={consent.scopes} />
      <p>Access expires after seven days. You can revoke it at any time in <Link href="/admin/mcp">Connected apps</Link>.</p>
    </> : <p role="alert">This connection request expired or is unavailable. Start the connection again in your assistant.</p>}
  </section></main>;
}
