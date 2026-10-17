"use client";
import { useState } from "react";
import type { McpScope } from "@/features/mcp/config";
import { permissionLabels } from "@/features/mcp/permission-labels";
interface Connection { id: string; client_name: string; scopes: McpScope[]; expires_at: string; revoked_at: string | null }
export function McpConnections({ connections }: { connections: Connection[] }) {
  const [items, setItems] = useState(connections); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState("");
  async function revoke(id: string) {
    setBusy(id); setError("");
    try {
      const response = await fetch("/api/admin/mcp/connections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("This connection could not be revoked. Try again.");
      setItems(items => items.map(item => item.id === id ? { ...item, revoked_at: new Date().toISOString() } : item));
    } catch (error) { setError(error instanceof Error ? error.message : "Try again."); } finally { setBusy(null); }
  }
  return <section className="mcp-connections"><h2>Your connected apps</h2>
    {!items.length && <p>No assistant connections have been authorized.</p>}
    {items.map(item => <div className="mcp-connection" key={item.id}><h3>{item.client_name}</h3>
      <p>{item.revoked_at ? "Revoked" : "Authorization expires"} · {new Date(item.revoked_at ?? item.expires_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })} Pacific</p>
      <ul>{item.scopes.map(scope => <li key={scope}>{permissionLabels[scope]}</li>)}</ul>
      {!item.revoked_at && <button className="button secondary" disabled={busy !== null} onClick={() => revoke(item.id)}>{busy === item.id ? "Revoking…" : "Revoke access"}</button>}
    </div>)}
    {error && <p role="alert" className="form-status error">{error}</p>}
  </section>;
}
