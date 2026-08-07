"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  CLIENT_PASSWORD_MIN_LENGTH,
  clientEmailConfirmationRedirect,
  clientSignupSchema
} from "@/lib/client-signup";
import { getClientAuthBrowserClient } from "@/lib/client-auth-browser";

export function ClientSignupForm({ authMode }: { authMode: "local" | "supabase" }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = useMemo(
    () => url && anonKey ? getClientAuthBrowserClient(url, anonKey) : null,
    [anonKey, url]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [resendMessage, setResendMessage] = useState("");

  const redirectTo = () => clientEmailConfirmationRedirect(window.location.origin);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResendMessage("");
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");

    if (!displayName || displayName.length > 120) {
      setError("Enter your name using 120 characters or fewer.");
      return;
    }
    if (password.length < CLIENT_PASSWORD_MIN_LENGTH) {
      setError(`Use a password with at least ${CLIENT_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    const input = clientSignupSchema.safeParse({ name: displayName, email, password });
    if (!input.success) {
      setError("Check your name, email, and password, then try again.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    if (authMode !== "supabase" || !supabase) {
      setError("Email registration is unavailable in the local demo. Use the configured demo client account to sign in.");
      return;
    }

    setBusy(true);
    try {
      const result = await supabase.auth.signUp({
        email: input.data.email,
        password: input.data.password,
        options: {
          data: { display_name: input.data.name, account_type: "client" },
          emailRedirectTo: redirectTo()
        }
      });
      if (result.error) {
        setError(
          result.error.message.toLowerCase().includes("password")
            ? `Use a stronger password with at least ${CLIENT_PASSWORD_MIN_LENGTH} characters.`
            : "The registration request could not be completed. Check the details and try again."
        );
        return;
      }
      setPendingEmail(input.data.email);
    } catch {
      setError("The registration request could not be completed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!supabase || !pendingEmail) return;
    setBusy(true);
    setError("");
    setResendMessage("");
    try {
      const result = await supabase.auth.resend({
        type: "signup",
        email: pendingEmail,
        options: { emailRedirectTo: redirectTo() }
      });
      if (result.error) throw result.error;
      setResendMessage("If this address can be registered, another verification email has been sent.");
    } catch {
      setError("The verification email could not be resent yet. Wait a moment and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (pendingEmail) {
    return (
      <div className="client-auth-result">
        <div className="form-status success" role="status" aria-live="polite">
          <strong>Check your email</strong>
          <p>If this address can be registered, we sent a verification link. Open it before signing in.</p>
        </div>
        <button className="text-button" type="button" disabled={busy} onClick={resendVerification}>
          {busy ? "Sending…" : "Resend verification email"}
        </button>
        {resendMessage && <p className="form-status success" role="status">{resendMessage}</p>}
        {error && <p className="form-status error" role="alert">{error}</p>}
        <Link className="text-link" href="/client/login">Back to Client Login</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="client-signup-name">Name</label>
        <input id="client-signup-name" name="displayName" autoComplete="name" maxLength={120} required />
      </div>
      <div className="field">
        <label htmlFor="client-signup-email">Email</label>
        <input id="client-signup-email" name="email" type="email" autoComplete="email" maxLength={254} required />
      </div>
      <div className="field">
        <label htmlFor="client-signup-password">Password</label>
        <input id="client-signup-password" name="password" type="password" autoComplete="new-password" minLength={CLIENT_PASSWORD_MIN_LENGTH} maxLength={256} required />
        <small>Use at least 11 characters.</small>
      </div>
      <div className="field">
        <label htmlFor="client-signup-confirmation">Confirm password</label>
        <input id="client-signup-confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={CLIENT_PASSWORD_MIN_LENGTH} maxLength={256} required />
      </div>
      <button className="button" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      {error && <p className="form-status error" role="alert" aria-live="assertive">{error}</p>}
    </form>
  );
}
