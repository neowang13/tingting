"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  automationScopes,
  type AutomationScope,
  type AutomationServiceAccount
} from "@/features/automation/contracts";

const primaryAutomationScopes: AutomationScope[] = [
  "tenants:import",
  "rentals:publish",
  "permissions:grant",
  "schedules:enable"
];

export function ServiceAccountManager({
  initialAccounts,
  delegatedAdminUserId
}: {
  initialAccounts: AutomationServiceAccount[];
  delegatedAdminUserId: string;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [token, setToken] = useState<string | null>(null);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [message, setMessage] = useState("Tokens cannot be revealed after this page is closed.");
  const [busy, setBusy] = useState(false);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopes = automationScopes.filter((scope) => form.get(`scope-${scope}`));
    setBusy(true);
    setMessage("Creating service account…");
    try {
      const response = await fetch("/api/admin/automation/service-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name")),
          delegatedAdminUserId,
          scopes,
          expiresAt: form.get("expiresAt")
            ? new Date(String(form.get("expiresAt"))).toISOString()
            : null
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message ?? "Service account could not be created.");
      }
      setAccounts((items) => [result.data.account, ...items]);
      setToken(result.data.token);
      setTokenSaved(false);
      setMessage("Service account created. Save the token now; it will not be shown again.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Service account could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function rotate(account: AutomationServiceAccount) {
    setBusy(true);
    setMessage(`Rotating ${account.name}…`);
    try {
      const response = await fetch(`/api/admin/automation/service-accounts/${account.id}/tokens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresAt: account.expiresAt, revokePreviousAfterHours: 0 })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Token could not be rotated.");
      setAccounts((items) => items.map((item) => item.id === account.id ? result.data.account : item));
      setToken(result.data.token);
      setTokenSaved(false);
      setMessage("Replacement token created and previous active tokens revoked. Save it now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Token could not be rotated.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(account: AutomationServiceAccount) {
    const typed = window.prompt(`Type "${account.name}" to deactivate this service account.`);
    if (typed !== account.name) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/automation/service-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: false })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Account could not be deactivated.");
      setAccounts((items) => items.map((item) => item.id === account.id ? result.data : item));
      setMessage(`${account.name} is inactive. New API calls are blocked.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account could not be deactivated.");
    } finally {
      setBusy(false);
    }
  }

  async function updateScopes(
    account: AutomationServiceAccount,
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopes = automationScopes.filter((scope) => form.get(`edit-${account.id}-${scope}`));
    setBusy(true);
    setMessage(`Updating scopes for ${account.name}…`);
    try {
      const response = await fetch(`/api/admin/automation/service-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scopes })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message ?? "Scopes could not be updated.");
      }
      setAccounts((items) =>
        items.map((item) => item.id === account.id ? result.data : item)
      );
      setMessage(`Scopes for ${account.name} were updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scopes could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  function downloadToken() {
    if (!token) return;
    const blob = new Blob([
      "Ting Ting Automation API token\n",
      "Store this value in OpenClaw secret configuration. Do not paste it into chat or source code.\n\n",
      token,
      "\n"
    ], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tingting-automation-token.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="prototype-page service-accounts-page">
      <div className="prototype-breadcrumb">
        <Link href="/admin/automation">Automation &amp; imports</Link> / Service accounts
      </div>
      {token && (
        <section className="prototype-token-reveal" aria-labelledby="token-heading">
          <h2 id="token-heading">Save this token now — it won&apos;t be shown again</h2>
          <code className="token-value">{token}</code>
          <div className="admin-action-bar">
            <button className="button secondary" type="button" onClick={() => void navigator.clipboard.writeText(token)}>
              Copy token
            </button>
            <button className="button secondary" type="button" onClick={downloadToken}>Download text file</button>
          </div>
          <label className="check-field">
            <input checked={tokenSaved} onChange={(event) => setTokenSaved(event.target.checked)} type="checkbox" />
            I saved this token in an approved secret store.
          </label>
          <button
            className="button"
            disabled={!tokenSaved}
            type="button"
            onClick={() => {
              setToken(null);
              setTokenSaved(false);
              setMessage("The raw token was removed from this screen.");
            }}
          >
            Done
          </button>
        </section>
      )}

      <form className="prototype-form-card admin-form" onSubmit={createAccount}>
        <h2>Create service account</h2>
        <div className="field-grid">
          <label className="field">
            <span>Account name</span>
            <input name="name" minLength={3} maxLength={120} required placeholder="OpenClaw import bot" />
          </label>
          <label className="field">
            <span>Expires (optional)</span>
            <input name="expiresAt" type="date" />
          </label>
          <fieldset className="field-wide prototype-scope-grid">
            <legend>Scopes</legend>
            {primaryAutomationScopes.map((scope) => (
              <label className="check-field" key={scope}>
                <input name={`scope-${scope}`} type="checkbox" defaultChecked={scope === "tenants:import"} />
                <span>
                  {scope}
                  {scope === "rentals:publish" && " (affects the live website)"}
                  {scope === "permissions:grant" && " (grants contact permission)"}
                  {scope === "schedules:enable" && " (turns on automatic emails)"}
                </span>
              </label>
            ))}
            <details className="field-wide prototype-more-actions">
              <summary>Advanced scopes</summary>
              <div className="prototype-scope-grid">
                {automationScopes.filter((scope) => !primaryAutomationScopes.includes(scope)).map((scope) => (
                  <label className="check-field" key={scope}>
                    <input name={`scope-${scope}`} type="checkbox" />
                    <span>{scope}</span>
                  </label>
                ))}
              </div>
            </details>
          </fieldset>
        </div>
        <button className="button" disabled={busy} type="submit">Create service account</button>
      </form>

      <section aria-label="Service accounts">
        {accounts.length === 0 ? (
          <div className="card empty-state">
            <h3>No service accounts</h3>
            <p>Create a least-privilege account when the Automation API is ready for local or staged testing.</p>
          </div>
        ) : (
          <div className="table-scroll" tabIndex={0} aria-label="Scrollable service account table">
            <table className="admin-table">
              <caption className="sr-only">Automation service accounts and token status</caption>
              <thead><tr><th>Name</th><th>Status</th><th>Token</th><th>Last used</th><th /></tr></thead>
              <tbody>{accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    {account.name}
                    <details className="prototype-more-actions scope-editor-details">
                      <summary>Manage scopes</summary>
                      <form className="scope-editor" onSubmit={(event) => void updateScopes(account, event)}>
                        <fieldset>
                          <legend className="sr-only">Scopes for {account.name}</legend>
                          {automationScopes.map((scope) => (
                            <label className="check-field" key={scope}>
                              <input
                                defaultChecked={account.scopes.includes(scope)}
                                name={`edit-${account.id}-${scope}`}
                                type="checkbox"
                              />
                              {scope}
                            </label>
                          ))}
                        </fieldset>
                        <button className="icon-text-button" disabled={busy} type="submit">Save scopes</button>
                      </form>
                    </details>
                  </td>
                  <td className={`prototype-status ${account.isActive ? "success" : "neutral"}`}>{account.isActive ? "Active" : "Inactive"}</td>
                  <td><code>{account.tokens.map((item) => item.prefix).join(", ") || "None"}</code></td>
                  <td>{account.tokens.find((item) => item.lastUsedAt)?.lastUsedAt
                    ? new Date(account.tokens.find((item) => item.lastUsedAt)!.lastUsedAt!).toLocaleString()
                    : "Never"}</td>
                  <td>
                    <div className="table-actions">
                      <button className="icon-text-button" disabled={busy || !account.isActive} type="button" onClick={() => void rotate(account)}>Rotate</button>
                      <button className="icon-text-button danger-text" disabled={busy || !account.isActive} type="button" onClick={() => void deactivate(account)}>Deactivate</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {message && <p className="admin-save-status" aria-live="polite">{message}</p>}
    </div>
  );
}
