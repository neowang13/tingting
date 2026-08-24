import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { convertApprovedApplicationToTenant } from "@/features/applications/service";

const originalEnvironment = { ...process.env };
const applicationId = "30000000-0000-4000-8000-000000000009";
const admin = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.test",
  displayName: "Admin",
  authenticatedAt: "2026-08-24T00:00:00.000Z",
  assuranceLevel: "aal2" as const
};
const conversionInput = {
  propertyLabel: "1231 Howe Street",
  unitLabel: "1104",
  moveInDate: "2026-09-01",
  leaseType: "fixed_term" as const,
  leaseEndDate: "2027-08-31",
  rentDueDay: 1
};

function approvedApplicationRow() {
  return {
    id: applicationId,
    owner_user_id: "00000000-0000-4000-8000-000000000009",
    property_title: "Bright Downtown One Bedroom",
    property_address: "1285 Howe Street, Vancouver",
    status: "approved",
    assigned_at: "2026-08-01T00:00:00.000Z",
    submitted_at: "2026-08-02T00:00:00.000Z",
    consented_at: "2026-08-02T00:00:00.000Z",
    retain_until: "2028-08-02T00:00:00.000Z",
    draft_payload: {
      personal: {
        legalFirstName: "Demo",
        legalLastName: "Applicant",
        email: "client@example.test",
        phone: "6045550182"
      }
    },
    draft_updated_at: "2026-08-02T00:00:00.000Z",
    converted_tenant_id: null,
    converted_at: null,
    rental_listings: { slug: "howe-street-one-bedroom" },
    application_form_versions: {
      version: "2026-07-31.1",
      sha256: "form-sha",
      legal_review_status: "approved"
    },
    application_terms_versions: {
      version: "2026-08-08.1",
      sha256: "terms-sha",
      legal_review_status: "approved"
    },
    client_application_files: [],
    client_application_lease_files: [{
      id: "40000000-0000-4000-8000-000000000009",
      original_filename: "signed-tenancy-agreement.pdf",
      mime_type: "application/pdf",
      byte_size: 128,
      uploaded_at: "2026-08-23T00:00:00.000Z",
      superseded_at: null,
      deleted_at: null
    }]
  };
}

function serviceClient(error: { code: string; message: string } | null, data: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: approvedApplicationRow(), error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return {
    from: vi.fn().mockReturnValue({ select }),
    rpc: vi.fn().mockResolvedValue({ data, error })
  };
}

describe("application tenant conversion database failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_BACKEND = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.restoreAllMocks();
  });

  it.each(["42P01", "42883", "PGRST202", "PGRST205"])(
    "reports missing database setup for Supabase error %s",
    async (databaseCode) => {
      mocks.createClient.mockReturnValue(serviceClient({
        code: databaseCode,
        message: "required tenant conversion object is missing"
      }));
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(convertApprovedApplicationToTenant(admin, applicationId, conversionInput))
        .rejects.toMatchObject({
          status: 503,
          code: "APPLICATION_TENANT_CONVERSION_MIGRATION_REQUIRED",
          message: "Tenant conversion is unavailable because the database setup is incomplete. Apply the latest database migrations and try again."
        });

      expect(JSON.parse(String(errorLog.mock.calls[0][0]))).toEqual({
        level: "error",
        message: "Application tenant conversion failed",
        applicationId,
        databaseCode
      });
    }
  );

  it("preserves a database conversion conflict and its safe message", async () => {
    mocks.createClient.mockReturnValue(serviceClient({
      code: "TT409",
      message: "application was already converted"
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(convertApprovedApplicationToTenant(admin, applicationId, conversionInput))
      .rejects.toMatchObject({
        status: 409,
        code: "APPLICATION_TENANT_CONVERSION_CONFLICT",
        message: "application was already converted"
      });
  });

  it("uses the generic failure for an unexpected database error", async () => {
    mocks.createClient.mockReturnValue(serviceClient({
      code: "XX000",
      message: "unexpected database failure"
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(convertApprovedApplicationToTenant(admin, applicationId, conversionInput))
      .rejects.toMatchObject({
        status: 503,
        code: "APPLICATION_TENANT_CONVERSION_FAILED",
        message: "The tenant could not be created from this application."
      });
  });

  it("logs and rejects an empty conversion result", async () => {
    mocks.createClient.mockReturnValue(serviceClient(null));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(convertApprovedApplicationToTenant(admin, applicationId, conversionInput))
      .rejects.toMatchObject({
        status: 503,
        code: "APPLICATION_TENANT_CONVERSION_FAILED"
      });

    expect(JSON.parse(String(errorLog.mock.calls[0][0]))).toMatchObject({ databaseCode: null });
  });
});
