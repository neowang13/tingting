"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export function ResetPasswordForm() {
  const router = useRouter();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = useMemo(
    () =>
      url && anonKey
        ? createBrowserClient(url, anonKey, {
            auth: { detectSessionInUrl: false }
          })
        : null,
    [anonKey, url]
  );
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    supabase ? "" : "Password recovery is not configured."
  );

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    void (async () => {
      try {
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = fragment.get("access_token");
        const refreshToken = fragment.get("refresh_token");
        const isRecovery = fragment.get("type") === "recovery";
        const hasRecoveryGrant = Boolean(isRecovery && accessToken && refreshToken);
        const result =
          hasRecoveryGrant && accessToken && refreshToken
            ? await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
              })
            : await supabase.auth.getSession();

        if (hasRecoveryGrant) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}`
          );
        }

        if (!active) return;
        if (result.error || !result.data.session) {
          setError("This password recovery link is invalid or expired.");
          return;
        }
        setReady(true);
        setError("");
      } catch {
        if (active) {
          setError("This password recovery link is invalid or expired.");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [supabase]);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!supabase || !ready) return;

        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password"));
        const confirmation = String(form.get("confirmation"));
        if (password !== confirmation) {
          setError("The passwords do not match.");
          setBusy(false);
          return;
        }

        const updated = await supabase.auth.updateUser({ password });
        if (updated.error) {
          setError("The password could not be updated. Request a new recovery link.");
          setBusy(false);
          return;
        }

        await supabase.auth.signOut();
        router.replace("/admin/login?reset=success");
        router.refresh();
      }}
    >
      <div className="field">
        <label htmlFor="new-admin-password">New password</label>
        <input
          id="new-admin-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={14}
          required
          disabled={!ready || busy}
        />
      </div>
      <div className="field">
        <label htmlFor="confirm-admin-password">Confirm new password</label>
        <input
          id="confirm-admin-password"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={14}
          required
          disabled={!ready || busy}
        />
      </div>
      <button className="button" disabled={!ready || busy} type="submit" style={{ marginTop: 16 }}>
        {busy ? "Updating…" : "Update password"}
      </button>
      {!ready && !error && <p>Validating the recovery link…</p>}
      {error && <p role="alert" aria-live="assertive">{error}</p>}
    </form>
  );
}
