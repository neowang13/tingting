import { readFile } from "node:fs/promises";
import path from "node:path";
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
  CLIENT_PASSWORD_MIN_LENGTH,
  clientEmailConfirmationRedirect,
  clientSignupErrorMessage,
  parseClientSignup,
  sanitizeClientNextPath
} from "../../src/lib/client-signup";
import { CLIENT_SUPABASE_COOKIE_NAME } from "../../src/lib/client-auth-config";
import { GET as confirmClientEmail } from "../../src/app/client/auth/confirm/route";
import { GET as recoverClientPassword } from "../../src/app/client/auth/recover/route";

const originalEnvironment = { ...process.env };

describe("client signup input", () => {
  it("exports the password minimum for signup UI reuse", () => {
    expect(CLIENT_PASSWORD_MIN_LENGTH).toBe(11);
  });

  it("accepts the documented name and password boundaries", () => {
    expect(parseClientSignup({
      name: "  Ada Applicant  ",
      email: "ada@example.test",
      password: "x".repeat(11)
    })).toEqual({
      name: "Ada Applicant",
      email: "ada@example.test",
      password: "x".repeat(11)
    });

    expect(parseClientSignup({
      name: "n".repeat(120),
      email: "long@example.test",
      password: "x".repeat(256)
    })).toBeDefined();
  });

  it.each([
    { name: "", email: "valid@example.test", password: "x".repeat(11) },
    { name: "   ", email: "valid@example.test", password: "x".repeat(11) },
    { name: "n".repeat(121), email: "valid@example.test", password: "x".repeat(11) },
    { name: "Valid", email: "not-an-email", password: "x".repeat(11) },
    { name: "Valid", email: "valid@example.test", password: "x".repeat(10) },
    { name: "Valid", email: "valid@example.test", password: "x".repeat(257) }
  ])("rejects invalid signup input %#", (input) => {
    expect(() => parseClientSignup(input)).toThrow();
  });

  it("rejects caller-supplied authorization metadata", () => {
    expect(() => parseClientSignup({
      name: "Mallory",
      email: "mallory@example.test",
      password: "x".repeat(11),
      role: "admin"
    })).toThrow();
  });
});

describe("client signup errors", () => {
  it("explains disabled registration without exposing provider details", () => {
    expect(clientSignupErrorMessage({
      code: "signup_disabled",
      message: "Signups not allowed for this instance"
    })).toBe("Client registration is temporarily unavailable. Please contact info@silverkey.ca for help.");
  });

  it("gives actionable guidance for rate limits and password errors", () => {
    expect(clientSignupErrorMessage({ code: "over_email_send_rate_limit" }))
      .toBe("Too many registration attempts were made. Wait a moment and try again.");
    expect(clientSignupErrorMessage({ message: "Password should contain more characters" }))
      .toBe("Use a stronger password with at least 11 characters.");
  });

  it("uses a non-enumerating fallback for other provider errors", () => {
    expect(clientSignupErrorMessage({ message: "User already registered" }))
      .toBe("The registration request could not be completed. Check the details and try again.");
  });
});

describe("client-only redirect paths", () => {
  it("builds an exact PKCE confirmation callback without an implicit-flow fallback", () => {
    expect(clientEmailConfirmationRedirect("http://localhost:3000"))
      .toBe("http://localhost:3000/client/auth/confirm");
    expect(clientEmailConfirmationRedirect("http://127.0.0.1:3300"))
      .toBe("http://127.0.0.1:3300/client/auth/confirm");
  });

  it("preserves a local client path, query, and fragment", () => {
    expect(sanitizeClientNextPath("/client/applications?property=home#form"))
      .toBe("/client/applications?property=home#form");
    expect(sanitizeClientNextPath("/client/apply/howe-street-one-bedroom"))
      .toBe("/client/apply/howe-street-one-bedroom");
  });

  it("returns generic client sign-ins to the public homepage", () => {
    expect(sanitizeClientNextPath(undefined)).toBe("/");
    expect(sanitizeClientNextPath(null)).toBe("/");
  });

  it.each([
    "https://evil.example/client/applications",
    "//evil.example/client/applications",
    "/\\evil.example/client/applications",
    "/admin",
    "/client/../admin",
    "/client/%2e%2e/admin",
    "/client-login"
  ])("rejects unsafe or non-client redirect %s", (candidate) => {
    expect(sanitizeClientNextPath(candidate)).toBe("/");
  });
});

describe("client email confirmation callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    mocks.cookies.mockResolvedValue({
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn()
    });
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("exchanges the PKCE code and redirects to the fixed client login success URL", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerClient.mockReturnValue({ auth: { exchangeCodeForSession, signOut } });

    const response = await confirmClientEmail(new Request(
      "https://tingting.example/client/auth/confirm?code=one-time-code&next=https://evil.example"
    ));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-test",
      expect.objectContaining({ cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME } })
    );
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://tingting.example/client/login?verification=success");
  });

  it("passes cleared Supabase session cookies to the response cookie store", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ getAll: vi.fn().mockReturnValue([]), set });
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockImplementation(async () => {
          options.cookies.setAll([{
            name: "sb-project-auth-token",
            value: "",
            options: { path: "/", maxAge: 0 }
          }]);
          return { error: null };
        })
      }
    }));

    await confirmClientEmail(new Request(
      "https://tingting.example/client/auth/confirm?code=one-time-code"
    ));

    expect(set).toHaveBeenCalledWith(
      "sb-project-auth-token",
      "",
      expect.objectContaining({ path: "/", maxAge: 0 })
    );
  });

  it("fails closed when the post-confirmation session cannot be cleared", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ getAll: vi.fn().mockReturnValue([]), set });
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        exchangeCodeForSession: vi.fn().mockImplementation(async () => {
          options.cookies.setAll([{
            name: `${CLIENT_SUPABASE_COOKIE_NAME}.0`,
            value: "temporary-session",
            options: { path: "/", httpOnly: true }
          }]);
          return { error: null };
        }),
        signOut: vi.fn().mockResolvedValue({ error: new Error("sign out failed") })
      }
    }));

    const response = await confirmClientEmail(new Request(
      "https://tingting.example/client/auth/confirm?code=one-time-code"
    ));

    expect(response.headers.get("location"))
      .toBe("https://tingting.example/client/login?verification=error");
    expect(set).toHaveBeenCalledWith(
      `${CLIENT_SUPABASE_COOKIE_NAME}.0`,
      "",
      expect.objectContaining({ path: "/", maxAge: 0 })
    );
  });

  it.each([
    "https://tingting.example/client/auth/confirm",
    "https://tingting.example/client/auth/confirm?code="
  ])("fails closed when the PKCE code is missing", async (url) => {
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn() }
    });

    const response = await confirmClientEmail(new Request(url));

    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://tingting.example/client/login?verification=error");
  });

  it("fails closed when Supabase rejects the PKCE code", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error("expired") })
      }
    });

    const response = await confirmClientEmail(new Request(
      "https://tingting.example/client/auth/confirm?code=expired"
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://tingting.example/client/login?verification=error");
  });

  it("fails closed when Supabase auth is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const response = await confirmClientEmail(new Request(
      "https://tingting.example/client/auth/confirm?code=valid"
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://tingting.example/client/login?verification=error");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});

describe("client password recovery PKCE callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    mocks.cookies.mockResolvedValue({
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn()
    });
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("exchanges only a query PKCE code into the Client cookie and opens the reset form", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession,
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "00000000-0000-4000-8000-000000000901", email_confirmed_at: "2026-08-07T00:00:00Z" } },
          error: null
        }),
        signOut: vi.fn()
      }
    });
    mocks.createClient.mockReturnValue({
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: table === "client_profiles" ? { is_active: true } : null,
              error: null
            })
          })
        })
      }))
    });

    const response = await recoverClientPassword(new Request(
      "https://tingting.example/client/auth/recover?code=recovery-code"
    ));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("recovery-code");
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-test",
      expect.objectContaining({ cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME } })
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://tingting.example/client/reset-password");
  });

  it.each([
    "https://tingting.example/client/auth/recover",
    "https://tingting.example/client/auth/recover?code=",
    "https://tingting.example/client/auth/recover#access_token=leaked&refresh_token=leaked"
  ])("rejects recovery requests without a query code: %s", async (url) => {
    const exchangeCodeForSession = vi.fn();
    mocks.createServerClient.mockReturnValue({ auth: { exchangeCodeForSession } });

    const response = await recoverClientPassword(new Request(url));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://tingting.example/client/login?recovery=error");
  });

  it("fails closed when the recovery code is expired or auth is unavailable", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error("expired") }) }
    });
    const expired = await recoverClientPassword(new Request(
      "https://tingting.example/client/auth/recover?code=expired"
    ));
    expect(expired.headers.get("location"))
      .toBe("https://tingting.example/client/login?recovery=error");

    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const unavailable = await recoverClientPassword(new Request(
      "https://tingting.example/client/auth/recover?code=valid"
    ));
    expect(unavailable.headers.get("location"))
      .toBe("https://tingting.example/client/login?recovery=error");
  });

  it("uses the recovery callback and never parses bearer tokens from the reset-page hash", async () => {
    const [loginForm, loginPage, resetForm] = await Promise.all([
      readFile(path.resolve("src/components/client/client-login-form.tsx"), "utf8"),
      readFile(path.resolve("src/app/client/login/page.tsx"), "utf8"),
      readFile(path.resolve("src/components/client/client-reset-password-form.tsx"), "utf8")
    ]);

    expect(loginForm).toContain("/client/auth/recover");
    expect(loginForm).not.toContain("redirectTo: `${window.location.origin}/client/reset-password`");
    expect(resetForm).not.toMatch(/location\.hash|access_token|refresh_token|setSession/);
    expect(resetForm).not.toContain("auth.updateUser");
    expect(resetForm).not.toContain("auth.signOut");
    expect(resetForm).toContain('/api/client/auth/recovery');
    expect(loginPage).toContain("recovery?: string");
    expect(loginPage).toContain('query.recovery === "error"');
    expect(loginPage).toContain("Request a new password recovery email");
  });
});

describe("local Supabase signup policy", () => {
  it("requires email confirmation and an 11-character password", async () => {
    const config = await readFile(path.resolve("supabase/config.toml"), "utf8");
    expect(config).toMatch(/enable_signup\s*=\s*true/);
    expect(config).toMatch(/minimum_password_length\s*=\s*11/);
    expect(config).toMatch(/enable_confirmations\s*=\s*true/);
    expect(config).toContain("http://localhost:3000/client/auth/confirm");
    expect(config).toContain("http://127.0.0.1:3000/client/auth/confirm");
    expect(config).toContain("http://localhost:3300/client/auth/confirm");
    expect(config).toContain("http://127.0.0.1:3300/client/auth/confirm");
    expect(config).toContain("http://localhost:3000/client/auth/recover");
    expect(config).toContain("http://127.0.0.1:3000/client/auth/recover");
    expect(config).toContain("http://localhost:3300/client/auth/recover");
    expect(config).toContain("http://127.0.0.1:3300/client/auth/recover");
  });

  it("enables the local confirmation inbox discoverable through supabase status", async () => {
    const config = await readFile(path.resolve("supabase/config.toml"), "utf8");
    expect(config).toMatch(/\[local_smtp\]\s*\nenabled\s*=\s*true/);
  });
});
