import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireClientRequest: vi.fn(),
  startOrReuseClientApplication: vi.fn(),
  assertActionRateLimit: vi.fn()
}));

vi.mock("@/lib/client-auth", () => ({ requireClientRequest: mocks.requireClientRequest }));
vi.mock("@/features/applications/service", () => ({
  startOrReuseClientApplication: mocks.startOrReuseClientApplication
}));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: mocks.assertActionRateLimit }));

import { POST } from "@/app/api/client/applications/start/route";

const identity = {
  userId: "00000000-0000-4000-8000-000000000501",
  email: "client@example.test",
  displayName: "Client"
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://tingting.example/api/client/applications/start", {
    method: "POST",
    headers: {
      origin: "https://tingting.example",
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

describe("Client self-start application route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireClientRequest.mockResolvedValue(identity);
    mocks.assertActionRateLimit.mockResolvedValue(undefined);
    mocks.startOrReuseClientApplication.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000502" });
  });

  it("uses the authenticated Client identity and a same-origin property slug", async () => {
    const response = await POST(request({ propertySlug: "howe-street-one-bedroom" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { applicationId: "00000000-0000-4000-8000-000000000502" }
    });
    expect(mocks.startOrReuseClientApplication).toHaveBeenCalledWith(identity, "howe-street-one-bedroom");
  });

  it("rejects caller-supplied ownership and malformed rental slugs", async () => {
    const response = await POST(request({
      propertySlug: "../admin",
      ownerUserId: "00000000-0000-4000-8000-000000000599"
    }));

    expect(response.status).toBe(400);
    expect(mocks.startOrReuseClientApplication).not.toHaveBeenCalled();
  });

  it("blocks cross-site application creation before authenticating", async () => {
    const response = await POST(request(
      { propertySlug: "howe-street-one-bedroom" },
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" }
    ));

    expect(response.status).toBe(403);
    expect(mocks.requireClientRequest).not.toHaveBeenCalled();
  });
});
