"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export function ClientResetPasswordForm() {
  const router = useRouter();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = useMemo(() => url && anonKey ? createBrowserClient(url, anonKey, { auth: { detectSessionInUrl: false } }) : null, [anonKey, url]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(supabase ? "" : "Password recovery is not configured.");

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void (async () => {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const result = fragment.get("type") === "recovery" && accessToken && refreshToken
        ? await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        : await supabase.auth.getSession();
      if (accessToken) window.history.replaceState(null, "", window.location.pathname);
      if (!active) return;
      if (result.error || !result.data.session) setError("This password recovery link is invalid or expired.");
      else { setReady(true); setError(""); }
    })().catch(() => active && setError("This password recovery link is invalid or expired."));
    return () => { active = false; };
  }, [supabase]);

  return <form onSubmit={async (event) => {
    event.preventDefault();
    if (!supabase || !ready) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    if (password !== String(data.get("confirmation"))) { setError("The passwords do not match."); return; }
    setBusy(true); setError("");
    const result = await supabase.auth.updateUser({ password });
    if (result.error) { setError("The password could not be updated. Request a new recovery link."); setBusy(false); return; }
    await supabase.auth.signOut();
    router.replace("/client/login?reset=success");
    router.refresh();
  }}>
    <div className="field"><label htmlFor="new-client-password">New password</label><input id="new-client-password" name="password" type="password" autoComplete="new-password" minLength={14} required disabled={!ready || busy} /></div>
    <div className="field"><label htmlFor="confirm-client-password">Confirm new password</label><input id="confirm-client-password" name="confirmation" type="password" autoComplete="new-password" minLength={14} required disabled={!ready || busy} /></div>
    <button className="button" type="submit" disabled={!ready || busy}>{busy ? "Updating…" : "Update password"}</button>
    {!ready && !error && <p>Validating the recovery link…</p>}
    {error && <p className="form-status error" role="alert" aria-live="assertive">{error}</p>}
  </form>;
}
