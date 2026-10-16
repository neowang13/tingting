import { beforeEach, describe, expect, it } from "vitest";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import { listApplicationsForStaff } from "@/features/applications/service";
import { buildAdminUsers } from "@/features/users/service";
import { applicationTenantConversionSchema } from "@/features/applications/schemas";
import type { ClientAccount, ClientTenantLink } from "@/lib/contracts";

const admin = { userId: "admin", email: "admin@example.test", displayName: "Admin", authenticatedAt: new Date().toISOString(), assuranceLevel: "aal2" as const };

beforeEach(() => { process.env.DATA_BACKEND = "memory"; store.reset(); resetRepositoryForTests(); });

async function fixtures() {
  const [account] = await getRepository().listClientAccounts();
  const [application] = await listApplicationsForStaff(admin);
  const [tenant] = await getRepository().listTenants();
  const link: ClientTenantLink = {
    id: "link-1", clientUserId: account.userId, tenantId: tenant.id, linkedAt: new Date().toISOString(), linkedBy: "admin",
    archivedAt: null, archivedBy: null,
    tenant: { id: tenant.id, fullName: tenant.fullName, propertyLabel: tenant.propertyLabel, unitLabel: tenant.unitLabel, isActive: true, archivedAt: null }
  };
  const linked: ClientAccount = { ...account, currentTenant: link.tenant, linkHistory: [link] };
  const signed = { ...application, ownerUserId: account.userId, status: "approved" as const, convertedTenantId: tenant.id, convertedAt: new Date().toISOString(), leaseDocument: {
    id: "lease-1", originalFilename: "signed-lease.pdf", mimeType: "application/pdf" as const, byteSize: 128, uploadedAt: new Date().toISOString()
  } };
  return { account, linked, signed };
}

describe("admin users and verified tenant status", () => {
  it("includes unverified and inactive registered users without requiring an application", async () => {
    const { account } = await fixtures();
    const users = buildAdminUsers([{ ...account, isActive: false, emailConfirmedAt: null }], []);
    expect(users[0]).toMatchObject({ userId: account.userId, tenantStatus: "user", isActive: false, emailConfirmedAt: null, applications: [] });
  });

  it("does not mark an approved applicant or an uploaded lease as a tenant before admin conversion", async () => {
    const { account, signed } = await fixtures();
    const users = buildAdminUsers([account], [{ ...signed, convertedTenantId: null, convertedAt: null }]);
    expect(users[0].tenantStatus).toBe("user");
    expect(users[0].applications[0].hasSignedLease).toBe(true);
    expect(users[0].applications[0]).not.toHaveProperty("draft");
    expect(users[0].applications[0]).not.toHaveProperty("files");
  });

  it("marks a linked user as a tenant only after confirmed signed-lease conversion", async () => {
    const { linked, signed } = await fixtures();
    expect(buildAdminUsers([linked], [signed])[0].tenantStatus).toBe("tenant");
    expect(buildAdminUsers([linked], [{ ...signed, leaseDocument: null }])[0].tenantStatus).toBe("needs_review");
    expect(buildAdminUsers([linked], [{ ...signed, ownerUserId: "different-user" }])[0].tenantStatus).toBe("needs_review");
  });

  it("preserves legacy links as requiring verification and identifies ended tenancies", async () => {
    const { linked, signed } = await fixtures();
    expect(buildAdminUsers([linked], [])[0].tenantStatus).toBe("needs_review");
    const historical = { ...linked, currentTenant: null, linkHistory: linked.linkHistory.map((link) => ({ ...link, archivedAt: new Date().toISOString() })) };
    expect(buildAdminUsers([historical], [signed])[0].tenantStatus).toBe("former_tenant");
  });

  it("requires explicit signed-agreement confirmation in the conversion payload", () => {
    const payload = { propertyLabel: "Test home", unitLabel: null, moveInDate: "2026-10-15", leaseType: "month_to_month", leaseEndDate: null, rentDueDay: 1 };
    expect(applicationTenantConversionSchema.safeParse(payload).success).toBe(false);
    expect(applicationTenantConversionSchema.safeParse({ ...payload, signedAgreementConfirmed: false }).success).toBe(false);
    expect(applicationTenantConversionSchema.safeParse({ ...payload, signedAgreementConfirmed: true }).success).toBe(true);
  });
});
