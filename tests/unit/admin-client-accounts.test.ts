import { beforeEach, describe, expect, it } from "vitest";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import { clientTenantLinkInputSchema } from "@/lib/schemas";

describe("administrator client account management", () => {
  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    store.reset();
    resetRepositoryForTests();
  });

  it("lists registered client profiles without matching a tenant by email", async () => {
    const repository = getRepository();
    const [client] = await repository.listClientAccounts();

    expect(client).toMatchObject({
      displayName: "Demo Client",
      email: "tenant@example.com",
      emailConfirmedAt: "2026-07-31T12:00:00.000Z",
      isActive: true,
      currentTenant: null
    });
    expect(client.linkHistory).toEqual([]);
  });

  it("links only when an admin explicitly selects a current tenant", async () => {
    const repository = getRepository();
    const [client] = await repository.listClientAccounts();
    const [firstTenant] = await repository.listTenants();

    const linked = await repository.linkClientToTenant(
      client.userId,
      { tenantId: firstTenant.id },
      "00000000-0000-4000-8000-000000000001"
    );

    expect(linked.currentTenant).toMatchObject({
      id: firstTenant.id,
      fullName: firstTenant.fullName
    });
    expect(linked.linkHistory).toHaveLength(1);
    expect(linked.linkHistory[0]).toMatchObject({
      tenantId: firstTenant.id,
      archivedAt: null
    });
  });

  it("archives the old link on reassignment and keeps only one current tenant", async () => {
    const repository = getRepository();
    const [client] = await repository.listClientAccounts();
    const [firstTenant] = await repository.listTenants();
    const secondTenant = await repository.createTenant({
      fullName: "Second Tenant",
      propertyLabel: "Second Property",
      unitLabel: "2",
      moveInDate: "2026-08-01",
      leaseType: "month_to_month",
      leaseEndDate: null,
      rentDueDay: 1,
      email: "second@example.test",
      phoneE164: null,
      preferredChannels: ["email"],
      emailContactStatus: "allowed",
      smsContactStatus: "unconfirmed",
      emailContactStatusReason: "test",
      smsContactStatusReason: null,
      emailContactStatusSource: "test",
      smsContactStatusSource: null,
      contactPermissionNote: "test",
      contactPermissionUpdatedAt: "2026-08-06T12:00:00.000Z",
      timezone: "America/Vancouver",
      internalNotes: null,
      isActive: true
    }, "00000000-0000-4000-8000-000000000001");

    await repository.linkClientToTenant(client.userId, { tenantId: firstTenant.id }, "admin-1");
    const reassigned = await repository.linkClientToTenant(client.userId, { tenantId: secondTenant.id }, "admin-2");

    expect(reassigned.currentTenant?.id).toBe(secondTenant.id);
    expect(reassigned.linkHistory).toHaveLength(2);
    expect(reassigned.linkHistory.filter((link) => link.archivedAt === null)).toHaveLength(1);
    expect(reassigned.linkHistory.find((link) => link.tenantId === firstTenant.id)?.archivedAt).not.toBeNull();
  });

  it("unlinks the current tenant while preserving link history", async () => {
    const repository = getRepository();
    const [client] = await repository.listClientAccounts();
    const [tenant] = await repository.listTenants();
    await repository.linkClientToTenant(client.userId, { tenantId: tenant.id }, "admin-1");

    const unlinked = await repository.unlinkClientFromTenant(client.userId, "admin-2");

    expect(unlinked.currentTenant).toBeNull();
    expect(unlinked.linkHistory).toHaveLength(1);
    expect(unlinked.linkHistory[0].archivedAt).not.toBeNull();
  });

  it("archives the current link when its tenant is archived", async () => {
    const repository = getRepository();
    const [client] = await repository.listClientAccounts();
    const [tenant] = await repository.listTenants();
    await repository.linkClientToTenant(client.userId, { tenantId: tenant.id }, "admin-1");

    await repository.archiveTenant(tenant.id, tenant.updatedAt, "admin-2");
    const [updated] = await repository.listClientAccounts();

    expect(updated.currentTenant).toBeNull();
    expect(updated.linkHistory).toHaveLength(1);
    expect(updated.linkHistory[0].archivedAt).not.toBeNull();
  });

  it("validates link input without accepting identity or email fields", () => {
    const tenantId = "00000000-0000-4000-8000-000000000010";
    expect(clientTenantLinkInputSchema.parse({ tenantId })).toEqual({ tenantId });
    expect(() => clientTenantLinkInputSchema.parse({ tenantId, email: "tenant@example.com" })).toThrow();
    expect(() => clientTenantLinkInputSchema.parse({ tenantId: "tenant@example.com" })).toThrow();
  });
});
