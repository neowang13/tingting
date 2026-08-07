"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import type { ClientAccount, Tenant } from "@/lib/contracts";

export function ClientManager({
  initialClients,
  tenants
}: {
  initialClients: ClientAccount[];
  tenants: Tenant[];
}) {
  const [clients, setClients] = useState(initialClients);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function replaceClient(updated: ClientAccount) {
    setClients((current) => current.map((client) =>
      client.userId === updated.userId ? updated : client
    ));
  }

  async function linkClient(client: ClientAccount, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tenantId = String(new FormData(event.currentTarget).get("tenantId") ?? "");
    setBusyClientId(client.userId);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(client.userId)}/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message ?? "The client could not be linked.");
      }
      replaceClient(result.data);
      setMessage(`${client.displayName} is linked to the selected tenant.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The client could not be linked.");
    } finally {
      setBusyClientId(null);
    }
  }

  async function unlinkClient(client: ClientAccount) {
    setBusyClientId(client.userId);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(client.userId)}/unlink`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message ?? "The client could not be unlinked.");
      }
      replaceClient(result.data);
      setMessage(`${client.displayName} is no longer linked to a tenant.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The client could not be unlinked.");
    } finally {
      setBusyClientId(null);
    }
  }

  return (
    <div className="prototype-page clients-page">
      <section className="prototype-status-banner waiting">
        Tenant access is granted only through an explicit link below. Matching email addresses are never linked automatically.
      </section>
      {message && <p className="prototype-notice" role="status">{message}</p>}
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr><th>Registered client</th><th>Current tenant</th><th>Link tenant</th><th>History</th></tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.userId}>
                <td>
                  <strong>{client.displayName}</strong><br />
                  <small>{client.email ?? "Email unavailable"}</small><br />
                  <span className={`prototype-status ${client.emailConfirmedAt ? "success" : "waiting"}`}>
                    {client.emailConfirmedAt ? "Verified" : "Waiting for verification"}
                  </span>{" "}
                  <span className={`prototype-status ${client.isActive ? "success" : "neutral"}`}>
                    {client.isActive ? "Active client" : "Inactive client"}
                  </span>
                </td>
                <td>
                  {client.currentTenant ? (
                    <>
                      <strong>{client.currentTenant.fullName}</strong><br />
                      <small>{tenantLabel(client.currentTenant)}</small><br />
                      <Link className="row-action" href={`/admin/tenants/${client.currentTenant.id}`}>Manage tenant</Link>{" "}
                      <button
                        className="button secondary"
                        disabled={busyClientId === client.userId}
                        onClick={() => void unlinkClient(client)}
                        type="button"
                      >
                        Unlink
                      </button>
                    </>
                  ) : "Not linked"}
                </td>
                <td>
                  <form onSubmit={(event) => void linkClient(client, event)}>
                    <label className="sr-only" htmlFor={`tenant-${client.userId}`}>Tenant for {client.displayName}</label>
                    <select
                      defaultValue={client.currentTenant?.id ?? ""}
                      disabled={!client.isActive || !client.emailConfirmedAt || busyClientId === client.userId}
                      id={`tenant-${client.userId}`}
                      key={client.currentTenant?.id ?? "unlinked"}
                      name="tenantId"
                      required
                    >
                      <option value="">Choose a current tenant</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.fullName} — {tenantLabel(tenant)}
                        </option>
                      ))}
                    </select>
                    <button className="button" disabled={!client.isActive || !client.emailConfirmedAt || busyClientId === client.userId} type="submit">
                      {client.currentTenant ? "Change link" : "Link tenant"}
                    </button>
                  </form>
                </td>
                <td>
                  {client.linkHistory.length === 0 ? "No links yet" : (
                    <details>
                      <summary>{client.linkHistory.length} {client.linkHistory.length === 1 ? "link" : "links"}</summary>
                      <ul>
                        {client.linkHistory.map((link) => (
                          <li key={link.id}>
                            {link.tenant.fullName} — {link.archivedAt ? "Archived" : "Current"}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {clients.length === 0 && <p className="prototype-empty-row">No registered client accounts yet.</p>}
    </div>
  );
}

function tenantLabel(tenant: Pick<Tenant, "propertyLabel" | "unitLabel">) {
  return tenant.unitLabel ? `${tenant.propertyLabel}, ${tenant.unitLabel}` : tenant.propertyLabel;
}
