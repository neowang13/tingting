import { describe, expect, it } from "vitest";
import { readServerEnvironment } from "../../src/lib/env";

describe("server environment validation", () => {
  it("allows a local memory demo with mock providers", () => {
    expect(readServerEnvironment({
      NODE_ENV: "development",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "demo",
      NOTIFICATION_PROVIDER_MODE: "mock",
      LOCAL_ADMIN_EMAIL: "admin@example.test",
      LOCAL_ADMIN_PASSWORD_HASH: "scrypt:16384:8:1:salt:hash",
      LOCAL_ADMIN_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters"
    }, { fresh: true })).toMatchObject({
      DATA_BACKEND: "memory",
      notificationProviderMode: "mock"
    });
  });

  it("prevents production mode from starting on memory persistence", () => {
    expect(() => readServerEnvironment({
      NODE_ENV: "production",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "production"
    }, { fresh: true })).toThrow("Required production services are not configured");
  });
});
