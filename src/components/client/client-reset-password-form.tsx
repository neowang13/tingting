"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CLIENT_PASSWORD_MIN_LENGTH } from "@/lib/client-signup";

export function ClientResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/client/auth/recovery", { method: "GET", cache: "no-store" });
      const result = await response.json();
      if (!active) return;
      if (!response.ok || !result.success || !result.data?.ready) setError("This password recovery link is invalid or expired.");
      else { setReady(true); setError(""); }
    })().catch(() => active && setError("This password recovery link is invalid or expired."));
    return () => { active = false; };
  }, []);

  return <form onSubmit={async (event) => {
    event.preventDefault();
    if (!ready) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    if (password !== String(data.get("confirmation"))) { setError("The passwords do not match."); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/client/auth/recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(
        result?.error?.code === "PASSWORD_UNCHANGED"
          ? "Choose a new password that is different from your current password."
          : "The password could not be updated. Request a new recovery link."
      );
      setBusy(false);
      return;
    }
    router.replace("/client/login?reset=success");
    router.refresh();
  }}>
    <div className="field"><label htmlFor="new-client-password">New password</label><input id="new-client-password" name="password" type="password" autoComplete="new-password" minLength={CLIENT_PASSWORD_MIN_LENGTH} required disabled={!ready || busy} /></div>
    <div className="field"><label htmlFor="confirm-client-password">Confirm new password</label><input id="confirm-client-password" name="confirmation" type="password" autoComplete="new-password" minLength={CLIENT_PASSWORD_MIN_LENGTH} required disabled={!ready || busy} /></div>
    <button className="button" type="submit" disabled={!ready || busy}>{busy ? "Updating…" : "Update password"}</button>
    {!ready && !error && <p>Validating the recovery link…</p>}
    {error && <p className="form-status error" role="alert" aria-live="assertive">{error}</p>}
  </form>;
}
