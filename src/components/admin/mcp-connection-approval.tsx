"use client";
import { useState } from "react";
import type { McpScope } from "@/features/mcp/config";
import { permissionLabels } from "@/features/mcp/permission-labels";
export function McpConnectionApproval({ requestId, scopes }: { requestId: string; scopes: McpScope[] }) {
  const [selected, setSelected] = useState(scopes); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function decide(decision: "allow" | "deny") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mcp/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision, scopes: decision === "allow" ? selected : [] }) });
      const data = await response.json();
      if (!response.ok || !data.redirectUri) throw new Error(data.error_description ?? "The connection could not be authorized.");
      window.location.assign(data.redirectUri);
    } catch (error) { setError(error instanceof Error ? error.message : "The connection could not be authorized."); setBusy(false); }
  }
  return <div>
    <fieldset className="mcp-permissions" disabled={busy}><legend>Choose what this app may do</legend>
      {scopes.map(scope => <label key={scope}><input type="checkbox" checked={selected.includes(scope)}
        onChange={event => setSelected(event.target.checked ? [...selected, scope] : selected.filter(s => s !== scope))} /> {permissionLabels[scope]}</label>)}
    </fieldset>
    <p>Approving an application may send its approval email. Publishing makes the current property and viewing dates public. Your Admin password stays with this website.</p>
    <div className="mcp-consent-actions"><button className="button" disabled={busy || !selected.length} onClick={() => decide("allow")}>Allow connection</button>
      <button className="button secondary" disabled={busy} onClick={() => decide("deny")}>Deny</button></div>
    {error && <p className="form-status error" role="alert">{error}</p>}
  </div>;
}
