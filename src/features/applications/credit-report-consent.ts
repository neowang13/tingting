import { ApiError } from "@/lib/api";
import type { ApplicationDraft } from "@/features/applications/schemas";
import type { ApplicationFileRecord } from "@/features/applications/contracts";

export const CREDIT_REPORT_CONSENT_VERSION = "2026-10-15.1";
export function assertCreditReportVoluntary(draft: ApplicationDraft, files: ApplicationFileRecord[]) {
  if (files.some((file) => file.documentType === "credit_score_report") && !draft.creditReportVoluntary) {
    throw new ApiError(400, "CREDIT_REPORT_CONFIRMATION_REQUIRED", "Confirm that you voluntarily provide your uploaded credit score report before signing.");
  }
}
