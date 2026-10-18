import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
import { deleteStoredApplicantFile } from "@/features/applications/applicant-signing";

const context = { requestId: "file-removal-test", userAgentHash: "test-agent" };
function storageMock(result: { data: { storage_path: string } | null; error: { code: string } | null }) {
  const query = { delete: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) };
  query.delete.mockReturnValue(query); query.eq.mockReturnValue(query); query.select.mockReturnValue(query);
  const remove = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  mocks.client.mockReturnValue({ from: vi.fn((table: string) => table === "client_application_files" ? query : { insert }), storage: { from: vi.fn(() => ({ remove })) } });
  return { query, remove, insert };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictional-test-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("private application file removal", () => {
  it("scopes the database deletion to application and applicant before removing its returned storage object", async () => {
    const { query, remove, insert } = storageMock({ data: { storage_path: "private/test.pdf" }, error: null });
    await deleteStoredApplicantFile("application", "applicant", "file", "user", context);
    expect(query.eq.mock.calls).toEqual([["id", "file"], ["application_id", "application"], ["applicant_id", "applicant"]]);
    expect(remove).toHaveBeenCalledWith(["private/test.pdf"]);
    expect(query.maybeSingle.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ actor_user_id: "user", action: "application.file_removed", request_context: expect.objectContaining({ fileId: "file", applicantId: "applicant" }) }));
  });
  it.each([
    [{ data: null, error: { code: "TT409" } }, "APPLICATION_SIGNATURES_LOCKED"],
    [{ data: null, error: { code: "XX000" } }, "APPLICATION_FILE_DELETE_UNAVAILABLE"],
    [{ data: null, error: null }, "APPLICATION_FILE_NOT_FOUND"]
  ])("leaves storage intact when a signature wins the race, the database fails, or ownership matches no file", async (result, code) => {
    const { remove, insert } = storageMock(result);
    await expect(deleteStoredApplicantFile("application", "applicant", "file", "user", context)).rejects.toMatchObject({ code });
    expect(remove).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it("keeps the removed file detached and records private cleanup information when storage is unavailable", async () => {
    const { remove, insert } = storageMock({ data: { storage_path: "private/test.pdf" }, error: null });
    remove.mockRejectedValue(new Error("storage unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deleteStoredApplicantFile("application", "applicant", "file", "user", context)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ request_context: expect.objectContaining({ storageCleanupPending: true, storagePath: "private/test.pdf" }) }));
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls[0][0]).not.toContain("private/test.pdf");
  });
});
