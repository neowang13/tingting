import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
import { deleteStoredApplicantFile } from "@/features/applications/applicant-signing";
import { processApplicationFileCleanup } from "@/features/applications/file-cleanup";
import { hashGuestToken } from "@/lib/application-guest-auth";
const context = { requestId: "file-removal-test", userAgentHash: "test-agent" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("DATA_BACKEND", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictional-test-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("atomic file removal requests", () => {
  it("queues detachment, audit and the storage locator through one transaction; never deletes storage from the request", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mocks.client.mockReturnValue({ rpc });
    await deleteStoredApplicantFile("application", "applicant", "file", "user", context);
    expect(rpc).toHaveBeenCalledWith("remove_unsigned_application_file", expect.objectContaining({ p_application_id: "application", p_applicant_id: "applicant", p_file_id: "file", p_user_id: "user", p_session_sha256: null, p_request_context: context }));
    await deleteStoredApplicantFile("application", "applicant", "file", "user", context, "guest-session");
    expect(rpc).toHaveBeenLastCalledWith("remove_unsigned_application_file", expect.objectContaining({ p_session_sha256: hashGuestToken("guest-session") }));
  });
  it.each([["TT409", "APPLICATION_SIGNATURES_LOCKED"], ["TT401", "APPLICATION_GUEST_SESSION_INVALID"], ["TT404", "APPLICATION_FILE_NOT_FOUND"], ["FETCH_ERROR", "APPLICATION_FILE_DELETE_UNAVAILABLE"]])("maps %s without attempting an unrecorded cleanup", async (code, expected) => {
    mocks.client.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }) });
    await expect(deleteStoredApplicantFile("application", "applicant", "file", "user", context)).rejects.toMatchObject({ code: expected });
  });
  it("can retry after a committed transaction loses its response", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { code: "FETCH_ERROR" } }).mockResolvedValue({ data: true, error: null });
    mocks.client.mockReturnValue({ rpc });
    await expect(deleteStoredApplicantFile("application", "applicant", "file", "user", context)).rejects.toMatchObject({ code: "APPLICATION_FILE_DELETE_UNAVAILABLE" });
    await expect(deleteStoredApplicantFile("application", "applicant", "file", "user", context)).resolves.toBeUndefined();
  });
});

function workerFixture() {
  const job = { file_id: "file", storage_bucket: "private-bucket", storage_path: "private/test.pdf", lease_token: "lease-1", attempts: 2 };
  const query = { eq: vi.fn(), select: vi.fn().mockResolvedValue({ data: [{ file_id: "file" }], error: null }) };
  query.eq.mockReturnValue(query);
  const update = vi.fn().mockReturnValue(query), remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const rpc = vi.fn().mockResolvedValue({ data: [job], error: null });
  mocks.client.mockReturnValue({ rpc, from: vi.fn(() => ({ update })), storage: { from: vi.fn(() => ({ remove })) } });
  return { job, query, update, remove, rpc };
}
describe("recoverable cleanup worker", () => {
  it("only clears its leased locator after storage confirms removal, including an already missing object", async () => {
    const { query, update, remove, rpc } = workerFixture();
    expect(await processApplicationFileCleanup({ fileId: "file", limit: 1 })).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith("claim_application_file_cleanup", { p_limit: 1, p_file_id: "file" });
    expect(remove).toHaveBeenCalledWith(["private/test.pdf"]);
    expect(update.mock.invocationCallOrder[0]).toBeGreaterThan(remove.mock.invocationCallOrder[0]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", storage_path: null }));
    expect(query.eq.mock.calls).toContainEqual(["lease_token", "lease-1"]);
  });
  it("leaves the locator intact and schedules retry when storage is unavailable", async () => {
    const { update, remove } = workerFixture(); remove.mockResolvedValue({ error: { message: "unavailable" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processApplicationFileCleanup()).toEqual({ claimed: 1, completed: 0, failed: 1 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ next_attempt_at: expect.any(String), locked_until: null }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ storage_path: null }));
  });
  it("relies on lease recovery if both cleanup and retry-state persistence fail", async () => {
    const { update, remove } = workerFixture(); remove.mockRejectedValue(new Error("offline")); update.mockImplementation(() => { throw new Error("database offline"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processApplicationFileCleanup()).toEqual({ claimed: 1, completed: 0, failed: 1 });
  });
  it("does not let an expired worker overwrite a newer lease", async () => {
    const { query, update } = workerFixture(); query.select.mockResolvedValue({ data: [], error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processApplicationFileCleanup()).toEqual({ claimed: 1, completed: 0, failed: 1 });
    expect(update).toHaveBeenCalledTimes(2);
    expect(query.eq.mock.calls.filter(([key]) => key === "lease_token")).toEqual([["lease_token", "lease-1"], ["lease_token", "lease-1"]]);
  });
});
