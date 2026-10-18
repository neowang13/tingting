import { afterEach, expect, it, vi } from "vitest";
import { removeAndReconcileFile } from "@/components/client/application-file-sync";
afterEach(() => vi.unstubAllGlobals());

it("recovers a lost successful deletion response by reading only attachments", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValue(new Response(JSON.stringify({ data: { files: [] } })));
  vi.stubGlobal("fetch", fetch);
  expect(await removeAndReconcileFile("/api/files", "file")).toMatchObject({ removed: true, files: [] });
  expect(fetch.mock.calls).toEqual([["/api/files/file", { method: "DELETE" }], ["/api/files", { cache: "no-store", signal: undefined }]]);
});
it("reconciles 404 into already removed, without requiring a page reload", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { files: [] } }))));
  expect(await removeAndReconcileFile("/api/files", "file")).toMatchObject({ removed: true, files: [] });
});
it("preserves a file when deletion failed and the current server list still includes it", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Try again' } }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { files: [{ id: 'file' }] } }))));
  expect(await removeAndReconcileFile("/api/files", "file")).toMatchObject({ removed: false, files: [{ id: 'file' }], error: 'Try again' });
});
it("does not discard local files when both deletion and reconciliation are offline", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error('offline')));
  const result = await removeAndReconcileFile("/api/files", "file");
  expect(result.removed).toBe(false); expect(result.files).toBeUndefined();
});
