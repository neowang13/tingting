import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applicationDraftSchema } from "@/features/applications/schemas";
import { renderApplicationSubmittedNotification } from "@/features/applications/notification";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { loadApplicationSubmissionNotificationData } from "@/features/applications/service";

function submittedRow() {
  const draft = applicationDraftSchema.parse({
    personal: { legalFirstName: "Primary", legalLastName: "Test", email: "primary@example.test", phone: "6045550100" },
    tenancy: { desiredMoveInDate: "2026-11-01", leaseTerm: "one_year", adultCount: 2, childCount: 1, occupantCount: 3, needsShowing: "yes", hasPets: true, petDetails: "One cat", needsParking: true, reasonForChoosing: "Near work" },
    housing: { currentAddress: "123 Fictional Street", currentHousingSince: "2024-01", currentMonthlyRent: 2400, landlordName: "Test Landlord", landlordPhone: "6045550101", reasonForLeaving: "More space" },
    employment: { employmentStatus: "employed", employerOrIncomeSource: "Primary Test Company", occupation: "Manager", employmentSince: "2020-01", grossMonthlyIncome: 8000, contactName: "Test Boss", contactPhone: "6045550102" },
    references: { primary: { name: "Test Reference", relationship: "Colleague", phone: "6045550103" } },
    emergency: { name: "Test Emergency", relationship: "Sibling", phone: "6045550104" },
    documentExplanations: { credit_score_report: "Fictional credit explanation" }
  });
  const applicant = (id: string, role: string, draftPayload: unknown) => ({
    id, role, legal_name: `${id} Test`, email: `${id}@example.test`, status: "signed",
    signed_at: "2026-10-15T18:00:00.000Z", draft_payload: draftPayload
  });
  return {
    id: "test-application", owner_user_id: "test-owner", property_title: "Test Home", property_address: "123 Test Street",
    status: "submitted", submitted_at: "2026-10-15T18:00:00.000Z", draft_payload: draft,
    application_form_versions: { version: "form-1", sha256: "form-sha", legal_review_status: "approved" },
    application_terms_versions: { version: "terms-1", sha256: "terms-sha", legal_review_status: "approved" },
    application_applicants: [
      // Production creates this copy at assignment and saves subsequent primary edits on the application.
      applicant("primary", "primary", applicationDraftSchema.parse({})),
      applicant("co", "co_applicant", { ...draft, housing: { ...draft.housing, currentAddress: "456 Co Applicant Avenue" }, employment: { ...draft.employment, employerOrIncomeSource: "Co Test Company" } }),
      { ...applicant("revoked", "co_applicant", { invalid: true, tenancy: null }), status: "revoked" }
    ],
    client_application_files: ["primary", "co"].map((id) => ({
      id: `${id}-file`, applicant_id: id, document_type: "other", original_filename: `${id}.pdf`,
      mime_type: "application/pdf", byte_size: 100, scan_status: "manual_review_required", uploaded_at: "2026-10-15T17:00:00.000Z"
    }))
  };
}

function mockDatabase(row: ReturnType<typeof submittedRow>) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const is = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ is });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  mocks.createClient.mockReturnValue({ from });
  return { from, eq, is };
}

describe("Supabase application submission notification", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("uses the signed canonical primary draft, preserves co-applicant drafts and file ownership", async () => {
    const row = submittedRow();
    const original = structuredClone(row);
    const query = mockDatabase(row);
    const data = await loadApplicationSubmissionNotificationData(row.id);

    expect(query.from).toHaveBeenCalledWith("client_applications");
    expect(query.eq).toHaveBeenCalledWith("id", row.id);
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(data.applicants.map((a) => a.id)).toEqual(["primary", "co"]);
    expect(data.applicants[0].draft).toEqual(row.draft_payload);
    expect(data.applicants[1].draft.housing.currentAddress).toBe("456 Co Applicant Avenue");
    expect(data.applicants[1].draft.employment.employerOrIncomeSource).toBe("Co Test Company");
    expect(data.applicants.map((a) => a.files.map((f) => f.id))).toEqual([["primary-file"], ["co-file"]]);
    expect(row).toEqual(original);

    const message = renderApplicationSubmittedNotification({ data, appBaseUrl: "https://silverkey.ca", attachedFiles: [], partIndex: 1, partCount: 1 });
    for (const value of ["2026-11-01", "One Year", "One cat", "Near work", "123 Fictional Street", "Test Landlord", "More space", "Primary Test Company", "Test Reference", "Test Emergency", "Fictional credit explanation", "456 Co Applicant Avenue", "Co Test Company"]) {
      expect(message.html).toContain(value);
      expect(message.text).toContain(value);
    }
    expect(message.text).toContain("Adults: 2\nChildren: 1\nTotal occupants: 3\nNeeds showing: Yes\nPets: One cat\nParking: Required");
  });

  it("rejects invalid co-applicant data instead of substituting the primary draft", async () => {
    const row = submittedRow();
    row.application_applicants[1].draft_payload = { tenancy: null };
    mockDatabase(row);
    await expect(loadApplicationSubmissionNotificationData(row.id)).rejects.toMatchObject({ code: "APPLICATION_DRAFT_INVALID" });
  });
});
