import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  createClient: vi.fn()
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import {
  CLIENT_RECOVERY_COOKIE_NAME,
  CLIENT_RECOVERY_TTL_SECONDS,
  createClientRecoveryMarker,
  verifyClientRecoveryMarker
} from "@/lib/client-recovery";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";
import { GET as recoverClientPassword } from "@/app/client/auth/recover/route";
import {
  GET as checkClientRecovery,
  POST as updateRecoveredClientPassword
} from "@/app/api/client/auth/recovery/route";

const originalEnvironment = { ...process.env };
const clientId = "00000000-0000-4000-8000-000000000901";

function cookieStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const set = vi.fn((name: string, value: string) => values.set(name, value));
  return {
    values,
    getAll: vi.fn(() => [...values].map(([name, value]) => ({ name, value }))),
    get: vi.fn((name: string) => values.has(name) ? { name, value: values.get(name)! } : undefined),
    set,
    delete: vi.fn((name: string) => values.delete(name))
  };
}

function serviceClient(options: { clientActive?: boolean; adminActive?: boolean } = {}) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: table === "client_profiles"
              ? { is_active: options.clientActive ?? true }
              : options.adminActive ? { is_active: true } : null,
            error: null
          })
        })
      })
    }))
  };
}

function authenticatedClient() {
  return {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: clientId, email_confirmed_at: "2026-08-07T00:00:00.000Z" } },
        error: null
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null })
    }
  };
}

describe("Client recovery marker", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "local-service-role-secret-for-recovery-tests";
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("binds a short-lived signed marker to the Client subject", () => {
    const now = Date.parse("2026-08-07T00:00:00.000Z");
    const marker = createClientRecoveryMarker(clientId, now);

    expect(verifyClientRecoveryMarker(marker, now)).toEqual({
      sub: clientId,
      exp: Math.floor(now / 1000) + CLIENT_RECOVERY_TTL_SECONDS
    });
  });

  it("rejects expired and tampered markers", () => {
    const now = Date.parse("2026-08-07T00:00:00.000Z");
    const marker = createClientRecoveryMarker(clientId, now);
    const [payload, signature] = marker.split(".");

    expect(verifyClientRecoveryMarker(
      marker,
      now + (CLIENT_RECOVERY_TTL_SECONDS + 1) * 1000
    )).toBeNull();
    expect(verifyClientRecoveryMarker(`${payload.slice(0, -1)}x.${signature}`, now)).toBeNull();
  });
});

describe("Client recovery intent and identity boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "local-service-role-secret-for-recovery-tests";
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("issues an HttpOnly recovery marker only for an active Client that is not an Admin", async () => {
    const store = cookieStore();
    const auth = authenticatedClient();
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(auth);
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await recoverClientPassword(new Request(
      "https://tingting.example/client/auth/recover?code=recovery-code"
    ));

    expect(response.headers.get("location")).toBe("https://tingting.example/client/reset-password");
    expect(auth.auth.getUser).toHaveBeenCalledOnce();
    expect(store.set).toHaveBeenCalledWith(
      CLIENT_RECOVERY_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" })
    );
  });

  it("rejects an active Admin and expires Client auth base/chunk cookies", async () => {
    const store = cookieStore({
      [CLIENT_SUPABASE_COOKIE_NAME]: "base-session",
      [`${CLIENT_SUPABASE_COOKIE_NAME}.0`]: "chunk-zero",
      [`${CLIENT_SUPABASE_COOKIE_NAME}.1`]: "chunk-one"
    });
    const auth = authenticatedClient();
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(auth);
    mocks.createClient.mockReturnValue(serviceClient({ adminActive: true }));

    const response = await recoverClientPassword(new Request(
      "https://tingting.example/client/auth/recover?code=admin-code"
    ));

    expect(response.headers.get("location")).toBe("https://tingting.example/client/login?recovery=error");
    expect(auth.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    for (const name of [
      CLIENT_RECOVERY_COOKIE_NAME,
      CLIENT_SUPABASE_COOKIE_NAME,
      `${CLIENT_SUPABASE_COOKIE_NAME}.0`,
      `${CLIENT_SUPABASE_COOKIE_NAME}.1`
    ]) {
      expect(store.set).toHaveBeenCalledWith(name, "", expect.objectContaining({ maxAge: 0 }));
    }
  });

  it("does not enable password reset for an ordinary Client login session without a marker", async () => {
    const store = cookieStore({ [CLIENT_SUPABASE_COOKIE_NAME]: "ordinary-session" });
    const auth = authenticatedClient();
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(auth);
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await checkClientRecovery(new Request("https://tingting.example/api/client/auth/recovery"));

    expect(response.status).toBe(401);
    expect(auth.auth.getUser).not.toHaveBeenCalled();
  });

  it.each(["tampered", "expired"])("rejects a %s recovery marker", async (kind) => {
    const now = Date.now();
    const valid = createClientRecoveryMarker(
      clientId,
      kind === "expired" ? now - (CLIENT_RECOVERY_TTL_SECONDS + 1) * 1000 : now
    );
    const marker = kind === "tampered" ? `${valid}x` : valid;
    const store = cookieStore({ [CLIENT_RECOVERY_COOKIE_NAME]: marker });
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(authenticatedClient());
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await checkClientRecovery(new Request("https://tingting.example/api/client/auth/recovery"));

    expect(response.status).toBe(401);
  });

  it("accepts a valid marker only when it matches the current active Client session", async () => {
    const marker = createClientRecoveryMarker(clientId);
    const store = cookieStore({ [CLIENT_RECOVERY_COOKIE_NAME]: marker });
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(authenticatedClient());
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await checkClientRecovery(new Request("https://tingting.example/api/client/auth/recovery"));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ success: true, data: { ready: true } });
  });

  it("updates the password server-side, signs out, and consumes the recovery session", async () => {
    const marker = createClientRecoveryMarker(clientId);
    const store = cookieStore({
      [CLIENT_RECOVERY_COOKIE_NAME]: marker,
      [CLIENT_SUPABASE_COOKIE_NAME]: "recovery-session",
      [`${CLIENT_SUPABASE_COOKIE_NAME}.0`]: "chunk-zero"
    });
    const auth = authenticatedClient();
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(auth);
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await updateRecoveredClientPassword(recoveryPost("correct-horse-battery"));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ success: true, data: { updated: true } });
    expect(auth.auth.updateUser).toHaveBeenCalledWith({ password: "correct-horse-battery" });
    expect(auth.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    for (const name of [CLIENT_RECOVERY_COOKIE_NAME, CLIENT_SUPABASE_COOKIE_NAME, `${CLIENT_SUPABASE_COOKIE_NAME}.0`]) {
      expect(store.set).toHaveBeenCalledWith(name, "", expect.objectContaining({ maxAge: 0 }));
    }
  });

  it("rejects password updates without a recovery marker", async () => {
    const store = cookieStore({ [CLIENT_SUPABASE_COOKIE_NAME]: "ordinary-session" });
    const auth = authenticatedClient();
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(auth);
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await updateRecoveredClientPassword(recoveryPost("correct-horse-battery"));

    expect(response.status).toBe(401);
    expect(auth.auth.updateUser).not.toHaveBeenCalled();
  });

  it("consumes the recovery marker and session when the password update fails", async () => {
    const marker = createClientRecoveryMarker(clientId);
    const store = cookieStore({
      [CLIENT_RECOVERY_COOKIE_NAME]: marker,
      [CLIENT_SUPABASE_COOKIE_NAME]: "recovery-session"
    });
    const auth = authenticatedClient();
    auth.auth.updateUser.mockResolvedValue({ error: new Error("update failed") });
    mocks.cookies.mockResolvedValue(store);
    mocks.createServerClient.mockReturnValue(auth);
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await updateRecoveredClientPassword(recoveryPost("correct-horse-battery"));

    expect(response.status).toBe(400);
    expect(auth.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    for (const name of [CLIENT_RECOVERY_COOKIE_NAME, CLIENT_SUPABASE_COOKIE_NAME]) {
      expect(store.set).toHaveBeenCalledWith(name, "", expect.objectContaining({ maxAge: 0 }));
    }
  });

  it.each(["short", "x".repeat(257)])("rejects an invalid recovery password", async (password) => {
    const marker = createClientRecoveryMarker(clientId);
    mocks.cookies.mockResolvedValue(cookieStore({ [CLIENT_RECOVERY_COOKIE_NAME]: marker }));
    const auth = authenticatedClient();
    mocks.createServerClient.mockReturnValue(auth);
    mocks.createClient.mockReturnValue(serviceClient());

    const response = await updateRecoveredClientPassword(recoveryPost(password));

    expect(response.status).toBe(400);
    expect(auth.auth.updateUser).not.toHaveBeenCalled();
  });
});

function recoveryPost(password: string) {
  return new Request("https://tingting.example/api/client/auth/recovery", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://tingting.example",
      "sec-fetch-site": "same-origin"
    },
    body: JSON.stringify({ password })
  });
}
