import type { AdminIdentity } from "@/lib/auth";
import type { ClientAccount } from "@/lib/contracts";
import { getRepository } from "@/data/repository";
import { listApplicationsForStaff } from "@/features/applications/service";
import type { ClientApplicationRecord } from "@/features/applications/contracts";

export type UserStatus = "user" | "tenant" | "former_tenant" | "needs_review";
export interface AdminUser extends ClientAccount {
  tenantStatus: UserStatus;
  applications: Array<Pick<ClientApplicationRecord,
    "id" | "propertyTitle" | "propertyAddress" | "status" | "convertedTenantId" | "convertedAt"
  > & { hasSignedLease: boolean; role: "primary" | "co_applicant"; relatedUsers: Array<{ userId: string; legalName: string }> }>;
}

// A manual link or an application signature alone is never evidence of a signed lease.
export function buildAdminUsers(accounts: ClientAccount[], applications: ClientApplicationRecord[]): AdminUser[] {
  return accounts.map((account) => {
    const owned = applications.filter((application) => application.ownerUserId === account.userId || application.applicants.some(a => a.role === "co_applicant" && a.userId === account.userId && a.status !== "revoked"));
    const verifiedTenantIds = new Set(owned.filter((application) =>
      application.status === "approved" && (application.ownerUserId === account.userId || application.applicants.some(a => a.role === "co_applicant" && a.userId === account.userId && a.status === "signed")) && application.convertedTenantId && application.convertedAt && application.leaseDocument
    ).map((application) => application.convertedTenantId));
    const tenantStatus: UserStatus = account.currentTenant && verifiedTenantIds.has(account.currentTenant.id)
      ? "tenant"
      : account.linkHistory.some((link) => !verifiedTenantIds.has(link.tenantId))
        ? "needs_review"
        : verifiedTenantIds.size > 0 ? "former_tenant" : "user";
    return {
      ...account,
      tenantStatus,
      applications: owned.map((application) => ({
        id: application.id,
        propertyTitle: application.propertyTitle,
        propertyAddress: application.propertyAddress,
        status: application.status,
        convertedTenantId: application.convertedTenantId,
        convertedAt: application.convertedAt,
        hasSignedLease: Boolean(application.leaseDocument),
        role: application.ownerUserId === account.userId ? "primary" : "co_applicant",
        relatedUsers: application.applicants.filter(a => a.userId && a.userId !== account.userId && a.status !== "revoked").map(a => ({ userId: a.userId!, legalName: a.legalName }))
      }))
    };
  });
}

export async function listAdminUsers(admin: AdminIdentity) {
  const [accounts, applications] = await Promise.all([
    getRepository().listClientAccounts(), listApplicationsForStaff(admin)
  ]);
  return buildAdminUsers(accounts, applications);
}
