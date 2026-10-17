import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { POST, GET, DELETE } from "@/app/api/mcp/route";
import { GET as setup } from "@/app/api/mcp/setup/route";
import { authenticateMcp, mcpScopes } from "@/features/mcp/auth";
import { store } from "@/data/store";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { resetDemoApplicationsForTests, listApplicationsForStaff } from "@/features/applications/service";
import { manageShowingSchema } from "@/features/showings/management";
import { runMcpWrite } from "@/features/mcp/operations";
import sharp from "sharp";

const token = "test_connector_token_" + "x".repeat(43);
const actor = "00000000-0000-4000-8000-000000000001";
const rentalId = "20000000-0000-4000-8000-000000000001";
const applicationId = "30000000-0000-4000-8000-000000000009";
const credential = { id: "owner-muse", adminUserId: actor, tokenSha256: createHash("sha256").update(token).digest("hex"),
  expiresAt: "2099-01-01T00:00:00Z", scopes: [...mcpScopes] };
const grantId = "00000000-0000-4000-8000-000000000050";
function grant() { return globalThis.__tingtingMcpOAuth!.grants.get(grantId)!; }
const clients: Client[] = [];
function request(headers: Record<string,string> = {}) {
  return new Request("http://localhost:3000/api/mcp", { headers: { authorization: `Bearer ${token}`, ...headers } });
}
async function connect() {
  const client = new Client({ name: "test-muse-client", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (url, init) => {
      const req = new Request(url, init);
      return req.method === "DELETE" ? DELETE(req) : req.method === "GET" ? GET(req) : POST(req);
    }
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}
async function call(client: Client, name: string, args: Record<string,unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ text: string }>;
  let data;
  try { data = JSON.parse(content[0].text); } catch { data = { message: content[0].text }; }
  return { error: result.isError === true, data };
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATA_BACKEND", "memory");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000"); vi.stubEnv("MCP_ENABLED", "true");
  vi.stubEnv("MCP_CREDENTIALS_JSON", JSON.stringify([credential])); vi.stubEnv("MCP_ALLOWED_ORIGINS", "");
  vi.stubEnv("EMAIL_PROVIDER_MODE", "mock"); vi.stubEnv("SMS_PROVIDER_MODE", "disabled");
  vi.stubEnv("NEXT_PUBLIC_ADMIN_MFA_REQUIRED", "false");
  globalThis.__tingtingMcpOAuth = { clients: new Map(), consents: new Map(), codes: new Map(), grants: new Map([[grantId, {
    id: grantId, client_id: crypto.randomUUID(), admin_user_id: actor, resource: "http://localhost:3000/api/mcp", scopes: [...mcpScopes],
    assurance_level: "aal1", authenticated_at: new Date().toISOString(), expires_at: credential.expiresAt, revoked_at: null
  }]]), tokens: new Map([[credential.tokenSha256, { token_sha256: credential.tokenSha256, grant_id: grantId, kind: "access", expires_at: credential.expiresAt, consumed_at: null }]]) };
  globalThis.__tingtingActionRateLimits = new Map(); globalThis.__tingtingMcpOperations = new Map();
  globalThis.__tingtingPropertyViewingSchedules = new Map(); globalThis.__tingtingViewingDrafts = new Map();
  globalThis.__tingtingShowingRequests = [];
  store.reset(); resetRepositoryForTests(); resetDemoApplicationsForTests();
});
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("private administrator MCP authentication", () => {
  it("offers credential-free setup instructions only while enabled", async () => {
    expect(await (await setup()).text()).toContain("http://localhost:3000/api/mcp");
    expect(await (await setup()).text()).not.toContain(token);
    vi.stubEnv("MCP_ENABLED", "false"); expect((await setup()).status).toBe(404);
  });
  it("is disabled by default and never accepts browser cookies or query tokens", async () => {
    vi.stubEnv("MCP_ENABLED", "false"); expect((await GET(request())).status).toBe(404);
    vi.stubEnv("MCP_ENABLED", "true");
    expect((await POST(new Request(`http://localhost:3000/api/mcp?token=${token}`, { headers: { cookie: "tt-session=anything" } }))).status).toBe(401);
  });
  it("rejects invalid, expired, legacy static and cross-origin credentials", async () => {
    await expect(authenticateMcp(request({ origin: "https://attacker.example" }))).rejects.toMatchObject({ status: 403 });
    await expect(authenticateMcp(request({ authorization: `Bearer ${"y".repeat(43)}` }))).rejects.toMatchObject({ status: 401 });
    globalThis.__tingtingMcpOAuth!.tokens.get(credential.tokenSha256)!.expires_at = "2020-01-01T00:00:00Z";
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("MCP_CREDENTIALS_JSON", JSON.stringify([credential, credential]));
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 401 });
  });
  it("fails closed for production memory data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(request())).status).toBe(503);
  });
  it("revalidates revocation on every request and hides out-of-scope tools", async () => {
    grant().scopes = ["rentals:read"];
    const client = await connect();
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(["get_operation", "list_rentals", "get_rental", "get_rental_editor", "list_rental_images"]);
    const result = await call(client, "set_application_status", {}); expect(result.error).toBe(true);
    grant().revoked_at = new Date().toISOString();
    await expect(client.listTools()).rejects.toThrow();
  });
});

describe("official SDK Streamable HTTP interoperability and management", () => {
  it("does not repeat in-flight or uncertain writes and prevents cross-credential audit access", async () => {
    const principal = await authenticateMcp(request());
    const id = crypto.randomUUID();
    let finish!: (result: Record<string,unknown>) => void;
    const work = vi.fn(() => new Promise<Record<string,unknown>>(resolve => { finish = resolve; }));
    const first = runMcpWrite(principal, id, "manage_showing", { id: "same" }, work);
    await expect(runMcpWrite(principal, id, "manage_showing", { id: "same" }, work)).rejects.toMatchObject({ code: "MCP_OUTCOME_UNCERTAIN" });
    expect(work).toHaveBeenCalledTimes(1);
    finish({ status: "accepted" }); await first;
    await expect(runMcpWrite({ ...principal, credentialId: "different" }, id, "manage_showing", { id: "same" }, work))
      .rejects.toMatchObject({ code: "MCP_OPERATION_NOT_FOUND" });
    const failureId = crypto.randomUUID();
    const fail = vi.fn(async () => { throw new Error("After commit failure"); });
    await expect(runMcpWrite(principal, failureId, "manage_showing", {}, fail)).rejects.toThrow();
    await expect(runMcpWrite(principal, failureId, "manage_showing", {}, fail)).rejects.toMatchObject({ code: "MCP_OUTCOME_UNCERTAIN" });
    expect(fail).toHaveBeenCalledTimes(1);
  });
  it("negotiates initialize and tools/list with the official client; validates payloads", async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(16);
    expect(tools.find(t => t.name === "set_application_status")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect((await call(client, "list_rentals")).data.total).toBeGreaterThan(0);
    expect((await call(client, "list_rentals", { limit: 10000 })).error).toBe(true);
    expect((await call(client, "set_rental_publication", { confirmed: false })).error).toBe(true);
  });
  it("unpublishes once, replays the saved result, and refuses ID reuse or stale edits", async () => {
    const client = await connect();
    const rental = await getRepository().getRental(rentalId);
    const args = { operationId: crypto.randomUUID(), confirmed: true, id: rentalId, action: "unpublish", expectedUpdatedAt: rental.updatedAt,
      expectedViewingDraftVersion: null, expectedViewingPublishedVersion: null };
    expect((await call(client, "set_rental_publication", args)).data.rental.status).toBe("draft");
    expect((await call(client, "set_rental_publication", args)).data.replayed).toBe(true);
    expect((await call(client, "set_rental_publication", { ...args, action: "publish" })).data.code).toBe("MCP_OPERATION_REUSED");
    const failed = await call(client, "set_rental_publication", { ...args, operationId: crypto.randomUUID() });
    expect(failed.error).toBe(true);
    const audit = await call(client, "get_operation", { operationId: args.operationId });
    expect(audit.data).toMatchObject({ status: "completed", tool: "set_rental_publication" });
    grant().scopes = ["rentals:read"];
    expect((await call(client, "get_operation", { operationId: args.operationId })).data.code).toBe("MCP_SCOPE_DENIED");
  });
  it("publishes calendar and listing together, and rejects stale calendar versions", async () => {
    const client = await connect();
    const draft = await call(client, "update_viewing_calendar", { operationId: crypto.randomUUID(), confirmed: true, id: rentalId,
      schedule: { timezone: "America/Vancouver", openWeekdays: [1], dateOverrides: [] }, expectedDraftVersion: null, expectedPublishedVersion: null });
    expect(draft.error).toBe(false); expect(draft.data.published).toBe(false);
    const { rental, viewingDraft } = (await call(client, "get_rental", { id: rentalId })).data;
    const args = { operationId: crypto.randomUUID(), confirmed: true, id: rentalId, action: "publish", expectedUpdatedAt: rental.updatedAt,
      expectedViewingDraftVersion: viewingDraft.updatedAt, expectedViewingPublishedVersion: viewingDraft.publishedUpdatedAt };
    expect((await call(client, "set_rental_publication", { ...args, expectedViewingDraftVersion: "stale" })).error).toBe(true);
    expect((await call(client, "set_rental_publication", { ...args, operationId: crypto.randomUUID() })).data.rental.status).toBe("published");
  });
  it("creates a rental with uploaded photos, edits details, publishes it, and removes it from the website", async () => {
    const client = await connect();
    const editor = (await call(client, "get_rental_editor")).data;
    expect(editor.schema.properties).toHaveProperty("pricing");
    const photo = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#446644" } }).png().toBuffer();
    const image = await call(client, "upload_rental_image", { operationId: crypto.randomUUID(), confirmed: true, filename: "living-room.png", altText: "Living room", base64: photo.toString("base64") });
    expect(image.error).toBe(false);
    const listing = { ...editor.template, slug: "mcp-new-home", title: "New rental home", description: "Administrator supplied rental details.",
      property: { ...editor.template.property, streetAddress: "1 Test Street", provinceCode: "BC" },
      pricing: { monthlyRentCents: 280000, currencyCode: "CAD" }, availability: { ...editor.template.availability, status: "available_now" },
      images: [{ mediaAssetId: image.data.mediaAssetId, sortOrder: 0, isCover: true }] };
    const createArgs = { operationId: crypto.randomUUID(), confirmed: true, listing };
    const created = await call(client, "create_rental", createArgs);
    expect(created.error).toBe(false); expect(created.data.rental.status).toBe("draft");
    expect(created.data.missingForPublication).toEqual([]);
    expect((await call(client, "create_rental", createArgs)).data.replayed).toBe(true);
    let current = (await call(client, "get_rental", { id: created.data.rental.id })).data;
    const updated = await call(client, "update_rental", { operationId: crypto.randomUUID(), confirmed: true, id: current.rental.id,
      expectedUpdatedAt: current.rental.updatedAt, listing: { ...current.listing, title: "Updated rental home" } });
    expect(updated.error).toBe(false); expect(updated.data.rental.title).toBe("Updated rental home");
    current = (await call(client, "get_rental", { id: created.data.rental.id })).data;
    const published = await call(client, "set_rental_publication", { operationId: crypto.randomUUID(), confirmed: true, id: current.rental.id,
      action: "publish", expectedUpdatedAt: current.rental.updatedAt, expectedViewingDraftVersion: current.viewingDraft.updatedAt,
      expectedViewingPublishedVersion: current.viewingDraft.publishedUpdatedAt });
    expect(published.error).toBe(false); expect((await getRepository().getPublicRentalBySlug(listing.slug))?.title).toBe("Updated rental home");
    const removed = await call(client, "set_rental_publication", { operationId: crypto.randomUUID(), confirmed: true, id: current.rental.id,
      action: "unpublish", expectedUpdatedAt: published.data.rental.updatedAt, expectedViewingDraftVersion: null, expectedViewingPublishedVersion: null });
    expect(removed.error).toBe(false); expect(await getRepository().getPublicRentalBySlug(listing.slug)).toBeNull();
  });
  it("moves submitted applications through requests for information directly to review", async () => {
    const principal = await authenticateMcp(request());
    await listApplicationsForStaff(principal.admin);
    globalThis.__tingtingClientApplications!.get(applicationId)!.status = "submitted";
    const client = await connect();
    const initial = (await call(client, "get_application", { id: applicationId })).data;
    const args = { id: applicationId, expectedUpdatedAt: initial.updatedAt, confirmed: true, operationId: crypto.randomUUID() };
    expect((await call(client, "set_application_status", { ...args, status: "received" })).error).toBe(true);
    const needsInformation = await call(client, "set_application_status", { ...args, status: "needs_information" });
    expect(needsInformation.error).toBe(false);
    expect(needsInformation.data.application.status).toBe("needs_information");
    const review = await call(client, "set_application_status", { ...args, operationId: crypto.randomUUID(),
      expectedUpdatedAt: needsInformation.data.application.updatedAt, status: "under_review" });
    expect(review.error).toBe(false);
    expect(review.data.application.status).toBe("under_review");
  });
  it("enforces application transitions, screening, versions, and no duplicate approval notification", async () => {
    const principal = await authenticateMcp(request());
    await listApplicationsForStaff(principal.admin);
    const stored = globalThis.__tingtingClientApplications!.get(applicationId)!;
    const client = await connect();
    const initial = (await call(client, "get_application", { id: applicationId })).data;
    const args = { id: applicationId, expectedUpdatedAt: initial.updatedAt, confirmed: true, status: "approved", operationId: crypto.randomUUID() };
    expect((await call(client, "set_application_status", args)).data.code).toBe("INVALID_APPLICATION_STATUS");
    stored.status = "submitted";
    stored.files = [{ id: crypto.randomUUID(), documentType: "credit_score_report", originalFilename: "report.pdf", mimeType: "application/pdf", byteSize: 1, scanStatus: "screening_pending", uploadedAt: initial.updatedAt }];
    expect((await call(client, "set_application_status", { ...args, status: "under_review", operationId: crypto.randomUUID() })).data.code).toBe("APPLICATION_FILES_NOT_CLEARED");
    stored.files[0].scanStatus = "cleared";
    const review = await call(client, "set_application_status", { ...args, status: "under_review", operationId: crypto.randomUUID() });
    expect(review.error).toBe(false);
    const approvedArgs = { ...args, expectedUpdatedAt: review.data.application.updatedAt, operationId: crypto.randomUUID() };
    const approved = await call(client, "set_application_status", approvedArgs);
    expect(approved.error).toBe(false); expect(approved.data.application.status).toBe("approved");
    expect((await call(client, "set_application_status", approvedArgs)).data.replayed).toBe(true);
    expect((await call(client, "set_application_status", { ...approvedArgs, operationId: crypto.randomUUID() })).data.code).toBe("APPLICATION_STATUS_CHANGED");
  });
  it("manages viewing times and cancellation without inventing visitor notifications", async () => {
    const client = await connect();
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);
    globalThis.__tingtingPropertyViewingSchedules!.set(rentalId, { rentalListingId: rentalId, timezone: "America/Vancouver", openWeekdays: [1,2,3,4,5,6,7], dateOverrides: [], updatedAt: now });
    const id = crypto.randomUUID();
    globalThis.__tingtingShowingRequests!.push({ id, createdAt: now, propertyId: rentalId, propertySlug: "howe-street-one-bedroom", propertyTitle: "Test", propertyAddress: "Test", requestedStartAt: null, requestedLocalDate: tomorrow, requestedLocalTime: null, timezone: "America/Vancouver", name: "Visitor", phone: "6045550111", email: "visitor@example.test", notes: "", status: "accepted", acceptedAt: now });
    const args = { operationId: crypto.randomUUID(), confirmed: true, id, expectedUpdatedAt: now, action: "accept", time: "14:00", reason: "Owner confirmed with visitor" };
    const confirmed = await call(client, "manage_showing", args);
    expect(confirmed.error).toBe(false); expect(confirmed.data).toMatchObject({ time: "14:00", notification: "not_sent" });
    const cancel = await call(client, "manage_showing", { operationId: crypto.randomUUID(), confirmed: true, id, expectedUpdatedAt: confirmed.data.updatedAt, action: "cancel", reason: "Visitor cancelled" });
    expect(cancel.data.status).toBe("cancelled");
    expect((await call(client, "manage_showing", { ...args, operationId: crypto.randomUUID() })).error).toBe(true);
    expect(manageShowingSchema.safeParse({ id, expectedUpdatedAt: now, action: "reschedule", reason: "Move" }).success).toBe(false);
  });
});
