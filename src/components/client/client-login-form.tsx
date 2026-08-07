"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { getClientAuthBrowserClient } from "@/lib/client-auth-browser";
import { clientEmailConfirmationRedirect } from "@/lib/client-signup";

export function ClientLoginForm({ authMode, nextPath = "/client/applications" }: { authMode: "local" | "supabase"; nextPath?: string }) {
  const router = useRouter();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = useMemo(() => url && anonKey ? getClientAuthBrowserClient(url, anonKey) : null, [url, anonKey]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      setRecoveryMessage("");
      setUnverifiedEmail("");
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      let response: Response;
      if (authMode === "local") {
        response = await fetch("/api/client/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
        });
      } else {
        if (!supabase) {
          setError("Client authentication is not configured.");
          setBusy(false);
          return;
        }
        const signedIn = await supabase.auth.signInWithPassword({ email, password });
        if (signedIn.error || !signedIn.data.session) {
          if (signedIn.error?.message.toLowerCase().includes("email not confirmed")) {
            setUnverifiedEmail(email.trim().toLowerCase());
            setError("Verify your email before signing in. You can request another verification email below.");
          } else {
            setError("Email or password is incorrect, or this account is not authorized.");
          }
          setBusy(false);
          return;
        }
        response = await fetch("/api/client/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: signedIn.data.session.access_token, refreshToken: signedIn.data.session.refresh_token })
        });
        if (!response.ok) await supabase.auth.signOut();
      }
      if (!response.ok) {
        setError(response.status === 429 ? "Too many sign-in attempts. Wait and try again." : "Email or password is incorrect, or this account is not authorized.");
        setBusy(false);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    }}>
      <div className="field">
        <label htmlFor="client-email">Email</label>
        <input id="client-email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="client-password">Password</label>
        <input id="client-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button>
      {authMode === "supabase" && <button className="text-button client-password-help" type="button" disabled={busy} onClick={async () => {
        const email = String(new FormData(formRef.current ?? undefined).get("email") ?? "").trim();
        setError(""); setRecoveryMessage("");
        if (!email || !supabase) { setError("Enter your account email before requesting a recovery link."); return; }
        setBusy(true);
        const result = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/client/auth/recover`
        });
        setBusy(false);
        if (result.error) setError("A recovery link could not be requested. Confirm the email and try again.");
        else setRecoveryMessage("If this authorized client account exists, a recovery link has been sent.");
      }}>Forgot password?</button>}
      {authMode === "supabase" && unverifiedEmail && <button className="text-button" type="button" disabled={busy} onClick={async () => {
        if (!supabase) return;
        setBusy(true); setRecoveryMessage("");
        const result = await supabase.auth.resend({
          type: "signup",
          email: unverifiedEmail,
          options: { emailRedirectTo: clientEmailConfirmationRedirect(window.location.origin) }
        });
        setBusy(false);
        if (result.error) setError("A verification email could not be requested yet. Wait a moment and try again.");
        else { setError(""); setRecoveryMessage("If this address can be registered, another verification email has been sent."); }
      }}>Resend verification email</button>}
      {recoveryMessage && <p className="form-status success" role="status" aria-live="polite">{recoveryMessage}</p>}
      {error && <p className="form-status error" role="alert" aria-live="assertive">{error}</p>}
    </form>
  );
}
