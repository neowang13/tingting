"use client";

import { useEffect } from "react";
import { ADMIN_IDLE_TIMEOUT_MS } from "@/lib/admin-session-policy";

export function AdminSessionGuard({ lastActiveAt }: { lastActiveAt?: string }) {
  useEffect(() => {
    let idleDeadline = lastActiveAt ? Date.parse(lastActiveAt) + ADMIN_IDLE_TIMEOUT_MS : Date.now() + ADMIN_IDLE_TIMEOUT_MS;
    let absoluteDeadline = Infinity;
    let lastTouch = 0;
    let pending = false;
    let ending = false;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("silverkey-admin-session") : null;
    const originalFetch = window.fetch.bind(window);
    async function logout(broadcast = true) {
      if (ending) return;
      ending = true;
      if (broadcast) channel?.postMessage({ type: "logout" });
      try { await originalFetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(3000) }); }
      catch { /* Expired sessions still leave the protected page if logout is offline. */ }
      finally { window.location.replace("/admin/login?error=session_expired"); }
    }
    async function check(touch = false) {
      const now = Date.now();
      if (ending || pending) return;
      if (idleDeadline && (now >= idleDeadline || now >= absoluteDeadline)) { void logout(); return; }
      if (touch && now - lastTouch < 30_000) return;
      pending = true;
      try {
        const response = await originalFetch("/api/auth/activity", { method: touch ? "POST" : "GET", cache: "no-store" });
        if (response.status === 401) { void logout(); return; }
        if (!response.ok) return;
        const body = await response.json();
        if (body.data.expired) { void logout(); return; }
        idleDeadline = body.data.idleExpiresAt;
        absoluteDeadline = body.data.absoluteExpiresAt;
        if (touch) { lastTouch = Date.now(); channel?.postMessage({ type: "activity", idleDeadline }); }
      } catch { /* An unavailable connection never extends the inactivity deadline. */ }
      finally { pending = false; }
    }
    const activity = (event: Event) => { if (event.isTrusted) void check(true); };
    const wake = () => { if (document.visibilityState === "visible") void check(); };
    const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"];
    events.forEach((name) => window.addEventListener(name, activity, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    channel?.addEventListener("message", (event) => {
      if (event.data?.type === "logout") void logout(false);
      if (event.data?.type === "activity" && Number.isFinite(event.data.idleDeadline)) {
        idleDeadline = Math.min(event.data.idleDeadline, Date.now() + ADMIN_IDLE_TIMEOUT_MS);
      }
    });
    const guardedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/admin/") && response.status === 401) void logout();
      return response;
    };
    window.fetch = guardedFetch;
    void check();
    const timer = window.setInterval(() => {
      if (idleDeadline && (Date.now() >= idleDeadline || Date.now() >= absoluteDeadline)) void logout();
    }, 1000);
    const poll = window.setInterval(() => void check(), 60_000);
    return () => {
      window.clearInterval(timer); window.clearInterval(poll); channel?.close();
      events.forEach((name) => window.removeEventListener(name, activity, true));
      document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake);
      if (window.fetch === guardedFetch) window.fetch = originalFetch;
    };
  }, [lastActiveAt]);
  return null;
}
