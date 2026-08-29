import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireClientRequest: vi.fn(),
  rateLimit: vi.fn(),
  createInvitation: vi.fn(),
  exchangeInvitation: vi.fn(),
  getGuestApplication: vi.fn(),
}));

vi.mock("@/lib/client-auth", () => ({ requireClientRequest: mocks.requireClientRequest }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: mocks.rateLimit }));
vi.mock("@/features/applications/applicant-signing", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/applications/applicant-signing")>();
  return {
    ...original,
    createCoApplicantInvitation: mocks.createInvitation,
    exchangeCoApplicantInvitation: mocks.exchangeInvitation,
    getGuestApplication: mocks.getGuestApplication,
  };
});

import { POST as invite } from "@/app/api/client/applications/[id]/applicants/route";
import { POST as exchange } from "@/app/api/application-guests/session/route";

const identity = { userId: crypto.randomUUID(), email: "owner@example.test", displayName: "Owner" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  mocks.requireClientRequest.mockResolvedValue(identity);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.createInvitation.mockResolvedValue({
    applicant: { id: "applicant-1", role: "co_applicant", legalName: "Guest Person", email: "guest@example.test", status: "invited" },
    invitationToken: "secret-token",
    invitationUrl: "https://example.test/application/guest#token=secret-token",
  });
});

describe("multi-applicant route boundaries", () => {
  it("never exposes the co-applicant bearer invitation to the owner response", async () => {
    const request = new Request("https://example.test/api/client/applications/application-1/applicants", {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ legalName: "Guest Person", email: "guest@example.test" }),
    });
    const response = await invite(request, { params: Promise.resolve({ id: "application-1" }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.applicant.id).toBe("applicant-1");
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(body.data).not.toHaveProperty("invitationUrl");
  });

  it("exchanges a bearer once into an HttpOnly no-store guest cookie", async () => {
    const token = "a".repeat(43);
    mocks.exchangeInvitation.mockResolvedValue({ sessionToken: "b".repeat(43), expiresAt: "2026-08-27T00:00:00.000Z" });
    mocks.getGuestApplication.mockResolvedValue({ application: { id: "application-1" }, applicant: { id: "applicant-1" } });
    const request = new Request("https://example.test/api/application-guests/session", {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const response = await exchange(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.exchangeInvitation).toHaveBeenCalledWith(token, expect.objectContaining({ requestId: expect.any(String) }));
  });
});
