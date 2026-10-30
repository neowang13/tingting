import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { applicationGuestSecret, serializeGuestSessionCookie } from "@/lib/application-guest-auth";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), rateLimit: vi.fn(), primary: vi.fn(), guest: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/lib/client-auth", () => ({ requireClientRequest: mocks.identity }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: mocks.rateLimit }));
vi.mock("@/features/applications/service", () => ({ removeApplicationFile: mocks.primary }));
vi.mock("@/features/applications/applicant-signing", () => ({ removeGuestApplicantFile: mocks.guest }));
import { DELETE as primary } from "@/app/api/client/applications/[id]/files/[fileId]/route";
import { DELETE as guest } from "@/app/api/application-guests/files/[fileId]/route";
const id = "30000000-0000-4000-8000-000000000009", fileId = "40000000-0000-4000-8000-000000000001";
const identity = { userId: "owner", email: "owner@example.test", displayName: "Owner" };
function request(origin = "https://example.test") { return new Request("https://example.test/api/files", { method: "DELETE", headers: { origin, "x-application-applicant-id": id, cookie: serializeGuestSessionCookie("b".repeat(43), applicationGuestSecret(), new Date(Date.now() + 60_000), id).split(";")[0] } }); }
beforeEach(() => { vi.clearAllMocks(); mocks.identity.mockResolvedValue(identity); mocks.primary.mockResolvedValue({ removed: true }); mocks.guest.mockResolvedValue({ removed: true }); });
describe("file removal route boundaries", () => {
  for (const [name, call] of [
    ["primary", (req: Request, invalid = false) => primary(req, { params: Promise.resolve({ id, fileId: invalid ? "invalid" : fileId }) })],
    ["co-applicant", (req: Request, invalid = false) => guest(req, { params: Promise.resolve({ fileId: invalid ? "invalid" : fileId }) })]
  ] as const) {
    it(`${name}: rejects cross-origin, signed-out, and invalid file IDs before any deletion`, async () => {
      expect((await call(request("https://untrusted.example"))).status).toBe(403);
      mocks.identity.mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sign in."));
      expect((await call(request())).status).toBe(401);
      expect((await call(request(), true)).status).toBe(400);
      expect(mocks.primary).not.toHaveBeenCalled(); expect(mocks.guest).not.toHaveBeenCalled();
    });
    it(`${name}: passes the verified account and request context without accepting a client-selected applicant`, async () => {
      const response = await call(request());
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ removed: true });
      const args = name === "primary" ? mocks.primary.mock.calls[0] : mocks.guest.mock.calls[0];
      expect(args).toContain(identity);
      expect(args).toContain(fileId);
      expect(args.at(-1)).toMatchObject({ requestId: expect.any(String), userAgentHash: expect.any(String) });
    });
  }
});
