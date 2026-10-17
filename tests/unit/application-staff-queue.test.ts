import { describe, expect, it } from "vitest";
import type { ApplicationStatus, ClientApplicationRecord } from "@/features/applications/contracts";
import { matchesApplicationQueueFilter, resolveApplicationQueueFilter } from "@/features/applications/staff-queue";

const lease = { id: "lease", originalFilename: "lease.pdf", mimeType: "application/pdf" as const, byteSize: 100, uploadedAt: "2026-10-17T12:00:00Z" };
const application = (status: ApplicationStatus, leaseDocument: ClientApplicationRecord["leaseDocument"] = null) => ({ status, leaseDocument });

describe("staff application views", () => {
  it.each(["submitted", "received", "under_review", "needs_information"] as const)("includes %s in Under review", status => {
    expect(matchesApplicationQueueFilter(application(status), "under_review")).toBe(true);
  });

  it.each(["draft", "approved", "declined", "withdrawn"] as const)("excludes %s from Under review", status => {
    expect(matchesApplicationQueueFilter(application(status), "under_review")).toBe(false);
  });

  it("keeps decisions and signed contracts in their existing views", () => {
    expect(matchesApplicationQueueFilter(application("approved"), "approved")).toBe(true);
    expect(matchesApplicationQueueFilter(application("declined"), "rejected")).toBe(true);
    expect(matchesApplicationQueueFilter(application("approved"), "rejected")).toBe(false);
    expect(matchesApplicationQueueFilter(application("approved"), "contract_signed")).toBe(false);
    expect(matchesApplicationQueueFilter(application("approved", lease), "contract_signed")).toBe(true);
    expect(matchesApplicationQueueFilter(application("under_review", lease), "contract_signed")).toBe(false);
  });

  it.each([undefined, "open", "unknown", ["approved"]])("defaults legacy or invalid view %s to Under review", view => {
    expect(resolveApplicationQueueFilter(view)).toBe("under_review");
  });

  it.each(["under_review", "approved", "rejected", "contract_signed"] as const)("retains explicit %s links", view => {
    expect(resolveApplicationQueueFilter(view)).toBe(view);
  });
});
