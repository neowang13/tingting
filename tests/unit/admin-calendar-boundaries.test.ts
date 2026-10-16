import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdminRequest: vi.fn(), recent: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...await original<typeof import("@/lib/auth")>(), requireAdminRequest: mocks.requireAdminRequest, assertRecentAuthentication: mocks.recent
}));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: mocks.rateLimit }));
import { DELETE, GET, PATCH, POST } from "@/app/api/admin/[...segments]/route";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import { ApiError } from "@/lib/api";
const id = "20000000-0000-4000-8000-000000000001";
const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });
const request = (method: string, body?: unknown) => new Request("https://example.test/api/admin", {
  method, headers: { "content-type": "application/json", origin: "https://example.test" }, body: body === undefined ? undefined : JSON.stringify(body)
});
beforeEach(() => {
  process.env.DATA_BACKEND = "memory";
  store.reset(); resetRepositoryForTests();
  globalThis.__tingtingPropertyViewingSchedules = new Map();
  globalThis.__tingtingViewingDrafts = new Map();
  mocks.requireAdminRequest.mockResolvedValue({ userId: "admin", email: "admin@example.test", displayName: "Admin" });
  mocks.recent.mockResolvedValue(undefined); mocks.rateLimit.mockResolvedValue(undefined);
});
describe("admin calendar and tenant boundaries", () => {
  it("requires admin authentication to access calendars and user directory", async () => {
    mocks.requireAdminRequest.mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sign in."));
    expect((await GET(request("GET"), context(["rentals", id, "viewing-schedule"]))).status).toBe(401);
    mocks.requireAdminRequest.mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sign in."));
    expect((await GET(request("GET"), context(["users"]))).status).toBe(401);
    mocks.requireAdminRequest.mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sign in."));
    expect((await GET(request("GET"), context(["rentals", id, "viewing-draft"]))).status).toBe(401);
  });
  it("validates property identity and version, isolates writes, and rejects stale edits", async () => {
    const data = { timezone: "America/Vancouver", openWeekdays: [1], dateOverrides: [], expectedUpdatedAt: null };
    expect((await PATCH(request("PATCH", data), context(["rentals", "missing", "viewing-schedule"]))).status).toBe(404);
    expect((await PATCH(request("PATCH", { ...data, expectedUpdatedAt: undefined }), context(["rentals", id, "viewing-schedule"]))).status).toBe(400);
    const saved = await PATCH(request("PATCH", data), context(["rentals", id, "viewing-schedule"]));
    expect(saved.status).toBe(200);
    expect((await PATCH(request("PATCH", data), context(["rentals", id, "viewing-schedule"]))).status).toBe(409);
    const other = await GET(request("GET"), context(["rentals", "20000000-0000-4000-8000-000000000002", "viewing-schedule"]));
    expect((await other.json()).data.openWeekdays).toEqual([]);
  });
  it("requires both calendar version tokens and recent authentication for draft saves", async () => {
    const data = { timezone: "America/Vancouver", openWeekdays: [1], dateOverrides: [], expectedUpdatedAt: null, expectedPublishedUpdatedAt: null };
    expect((await PATCH(request("PATCH", { ...data, expectedPublishedUpdatedAt: undefined }), context(["rentals", id, "viewing-draft"]))).status).toBe(400);
    expect((await PATCH(request("PATCH", { ...data, expectedUpdatedAt: undefined }), context(["rentals", id, "viewing-draft"]))).status).toBe(400);
    mocks.recent.mockRejectedValueOnce(new ApiError(403, "RECENT_AUTH_REQUIRED", "Sign in again."));
    expect((await PATCH(request("PATCH", data), context(["rentals", id, "viewing-draft"]))).status).toBe(403);
    expect(globalThis.__tingtingViewingDrafts?.size).toBe(0);
    expect((await PATCH(request("PATCH", data), context(["rentals", id, "viewing-draft"]))).status).toBe(200);
    expect((await PATCH(request("PATCH", data), context(["rentals", id, "viewing-draft"]))).status).toBe(409);
  });
  it("requires admin, recent authentication and a current version before deletion", async () => {
    const rental = await getRepository().getRental(id);
    const data = { expectedVersion: rental.updatedAt };
    mocks.requireAdminRequest.mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED", "Sign in."));
    expect((await DELETE(request("DELETE", data), context(["rentals", id]))).status).toBe(401);
    mocks.recent.mockRejectedValueOnce(new ApiError(403, "RECENT_AUTH_REQUIRED", "Sign in again."));
    expect((await DELETE(request("DELETE", data), context(["rentals", id]))).status).toBe(403);
    expect((await DELETE(request("DELETE", {}), context(["rentals", id]))).status).toBe(400);
    expect((await DELETE(request("DELETE", { expectedVersion: "stale" }), context(["rentals", id]))).status).toBe(409);
    expect((await getRepository().getRental(id)).id).toBe(id);
  });
  it("deletes the public snapshot, admin listing and calendar without deleting other properties", async () => {
    const repository = getRepository();
    const rental = await repository.getRental(id);
    await PATCH(request("PATCH", { timezone: "America/Vancouver", openWeekdays: [1], dateOverrides: [],
      expectedUpdatedAt: null, expectedPublishedUpdatedAt: null }), context(["rentals", id, "viewing-draft"]));
    expect(globalThis.__tingtingViewingDrafts?.has(id)).toBe(true);
    expect((await DELETE(request("DELETE", { expectedVersion: rental.updatedAt }), context(["rentals", id]))).status).toBe(200);
    expect((await repository.listRentals()).some((item) => item.id === id)).toBe(false);
    expect(await repository.getPublicRentalBySlug(rental.slug)).toBeNull();
    await expect(repository.getRental(id)).rejects.toMatchObject({ status: 404 });
    expect(globalThis.__tingtingViewingDrafts?.has(id)).toBe(false);
    expect(globalThis.__tingtingPropertyViewingSchedules?.has(id)).toBe(false);
    expect((await repository.getRental("20000000-0000-4000-8000-000000000002")).id).toBeTruthy();
  });
  it("blocks direct tenant creation and manual user linking", async () => {
    const repository = getRepository();
    const before = await repository.listTenants();
    expect((await POST(request("POST", {}), context(["tenants"]))).status).toBe(409);
    expect((await POST(request("POST", { tenantId: before[0].id }), context(["clients", "client-id", "link"]))).status).toBe(409);
    expect(await repository.listTenants()).toHaveLength(before.length);
  });
});
