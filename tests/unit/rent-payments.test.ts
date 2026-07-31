import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import {
  buildRentReportSnapshot,
  currentPaymentPeriod,
  paymentPeriod,
  rentDueDateForPeriod,
  rentReportWindow,
  validateRentReceipt
} from "@/features/rent-payments/service";
import type { Tenant, TenantRentPayment } from "@/lib/contracts";

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: crypto.randomUUID(),
    fullName: "Rent Tenant",
    propertyLabel: "Main Street",
    unitLabel: "202",
    moveInDate: "2026-01-01",
    leaseType: "month_to_month",
    leaseEndDate: null,
    rentDueDay: 1,
    email: "rent@example.com",
    phoneE164: null,
    preferredChannels: ["email"],
    emailContactStatus: "allowed",
    smsContactStatus: "unconfirmed",
    emailContactStatusReason: null,
    smsContactStatusReason: null,
    emailContactStatusSource: "test",
    smsContactStatusSource: null,
    contactPermissionNote: null,
    contactPermissionUpdatedAt: null,
    timezone: "America/Vancouver",
    internalNotes: null,
    isActive: true,
    archivedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides
  };
}

function payment(
  tenantId: string,
  dueDate: string,
  status: "due" | "collected" = "due"
): TenantRentPayment {
  return {
    id: crypto.randomUUID(),
    tenantId,
    paymentPeriod: `${dueDate.slice(0, 7)}-01`,
    dueDate,
    status,
    receiptId: status === "collected" ? crypto.randomUUID() : null,
    collectedAt: status === "collected" ? "2026-07-31T20:00:00.000Z" : null,
    collectedByType: status === "collected" ? "admin" : null,
    collectedById: status === "collected" ? crypto.randomUUID() : null,
    note: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z"
  };
}

describe("rent payment dates and reporting", () => {
  it("normalizes monthly periods and clamps 29/30/31 including leap years", () => {
    expect(paymentPeriod("2028-02")).toBe("2028-02-01");
    expect(rentDueDateForPeriod("2028-02", 31)).toBe("2028-02-29");
    expect(rentDueDateForPeriod("2027-02", 31)).toBe("2027-02-28");
    expect(rentDueDateForPeriod("2026-04", 31)).toBe("2026-04-30");
  });

  it("uses natural Monday weeks for Friday reports and survives Vancouver DST", () => {
    const friday = rentReportWindow("2026-07-31T19:00:00.000Z", "America/Vancouver");
    expect(friday.weekStart).toBe("2026-07-27");
    expect(friday.weekEnd).toBe("2026-08-03");
    expect(friday.nextWeekStart).toBe("2026-08-03");
    expect(friday.nextWeekEnd).toBe("2026-08-10");
    expect(currentPaymentPeriod("2026-11-01T08:30:00.000Z", "America/Vancouver"))
      .toBe("2026-11-01");
  });

  it("keeps due, collected, and outstanding sets reconcilable", () => {
    const first = tenant();
    const second = tenant({ id: crypto.randomUUID(), fullName: "Second Tenant" });
    const snapshot = buildRentReportSnapshot({
      tenants: [first, second],
      payments: [
        payment(first.id, "2026-07-31", "collected"),
        payment(second.id, "2026-08-01", "due")
      ],
      instant: "2026-07-31T19:00:00.000Z",
      timezone: "America/Vancouver"
    });
    expect(snapshot.thisWeek.due).toHaveLength(2);
    expect(snapshot.thisWeek.collected).toHaveLength(1);
    expect(snapshot.thisWeek.outstanding).toHaveLength(1);
    expect(snapshot.thisWeek.due.length - snapshot.thisWeek.collected.length)
      .toBe(snapshot.thisWeek.outstanding.length);
  });

  it("separates fixed-term expiry windows, expired active leases, and month-to-month", () => {
    const monthly = tenant();
    const soon = tenant({
      id: crypto.randomUUID(),
      leaseType: "fixed_term",
      leaseEndDate: "2026-08-05"
    });
    const later = tenant({
      id: crypto.randomUUID(),
      leaseType: "fixed_term",
      leaseEndDate: "2026-08-20"
    });
    const expired = tenant({
      id: crypto.randomUUID(),
      leaseType: "fixed_term",
      leaseEndDate: "2026-07-20"
    });
    const snapshot = buildRentReportSnapshot({
      tenants: [monthly, soon, later, expired],
      payments: [],
      instant: "2026-07-31T19:00:00.000Z",
      timezone: "America/Vancouver"
    });
    expect(snapshot.leases.monthToMonthCount).toBe(1);
    expect(snapshot.leases.expiringWithin7Days.map((item) => item.tenant.id)).toEqual([soon.id]);
    expect(snapshot.leases.expiringWithin30Days).toHaveLength(2);
    expect(snapshot.leases.expiredActive.map((item) => item.tenant.id)).toEqual([expired.id]);
  });

  it("omits inactive and archived tenants from next-week receivables", () => {
    const active = tenant();
    const inactive = tenant({ id: crypto.randomUUID(), isActive: false });
    const archived = tenant({
      id: crypto.randomUUID(),
      archivedAt: "2026-07-20T12:00:00.000Z"
    });
    const snapshot = buildRentReportSnapshot({
      tenants: [active, inactive, archived],
      payments: [
        payment(active.id, "2026-08-03"),
        payment(inactive.id, "2026-08-04"),
        payment(archived.id, "2026-08-05")
      ],
      instant: "2026-07-31T19:00:00.000Z",
      timezone: "America/Vancouver"
    });

    expect(snapshot.nextWeek.due.map((detail) => detail.tenant.id)).toEqual([active.id]);
  });

  it("uses the Vancouver week boundary and report instant for recent collections", () => {
    const included = tenant();
    const tooEarly = tenant({ id: crypto.randomUUID() });
    const future = tenant({ id: crypto.randomUUID() });
    const includedPayment = payment(included.id, "2026-07-01", "collected");
    includedPayment.collectedAt = "2026-07-27T07:00:00.000Z";
    const tooEarlyPayment = payment(tooEarly.id, "2026-07-01", "collected");
    tooEarlyPayment.collectedAt = "2026-07-27T06:59:59.999Z";
    const futurePayment = payment(future.id, "2026-07-01", "collected");
    futurePayment.collectedAt = "2026-07-31T19:00:00.001Z";

    const snapshot = buildRentReportSnapshot({
      tenants: [included, tooEarly, future],
      payments: [includedPayment, tooEarlyPayment, futurePayment],
      instant: "2026-07-31T19:00:00.000Z",
      timezone: "America/Vancouver"
    });

    expect(snapshot.recentCollections.map((detail) => detail.tenant.id)).toEqual([included.id]);
  });

  it("validates extension, MIME, magic bytes, and size", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 receipt");
    expect(validateRentReceipt("receipt.pdf", "application/pdf", pdf))
      .toMatchObject({ mimeType: "application/pdf", byteSize: pdf.byteLength });
    expect(() => validateRentReceipt("receipt.png", "image/png", pdf))
      .toThrow(/contents/i);
    expect(() => validateRentReceipt("receipt.exe", "application/pdf", pdf))
      .toThrow(/filename/i);
  });
});

describe("rent payment repository", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_BACKEND", "memory");
    resetRepositoryForTests();
    store.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRepositoryForTests();
    store.reset();
  });

  it("deduplicates receipt hashes and keeps one payment under concurrent collection", async () => {
    const repository = getRepository();
    const created = await repository.createTenant({
      fullName: "Payment Tenant",
      propertyLabel: "Oak Avenue",
      unitLabel: "8",
      moveInDate: "2026-01-01",
      leaseType: "month_to_month",
      leaseEndDate: null,
      rentDueDay: 31,
      email: "payment@example.com",
      phoneE164: null,
      preferredChannels: ["email"],
      emailContactStatus: "allowed",
      smsContactStatus: "unconfirmed",
      emailContactStatusReason: null,
      smsContactStatusReason: null,
      emailContactStatusSource: "test",
      smsContactStatusSource: null,
      contactPermissionNote: null,
      contactPermissionUpdatedAt: null,
      timezone: "America/Vancouver",
      internalNotes: null,
      isActive: true
    }, crypto.randomUUID());
    const bytes = new TextEncoder().encode("%PDF-1.7 rent receipt");
    const input = {
      tenantId: created.id,
      paymentPeriod: "2026-07",
      originalFilename: "rent.pdf",
      declaredMimeType: "application/pdf",
      bytes,
      actorType: "admin" as const,
      actorId: crypto.randomUUID()
    };
    const [firstReceipt, duplicateReceipt] = await Promise.all([
      repository.registerTenantRentReceipt(input),
      repository.registerTenantRentReceipt(input)
    ]);
    expect(duplicateReceipt.id).toBe(firstReceipt.id);

    const [first, second] = await Promise.all([
      repository.markTenantRentCollected({
        tenantId: created.id,
        paymentPeriod: "2026-07",
        receiptId: firstReceipt.id,
        actorType: "admin",
        actorId: input.actorId
      }),
      repository.markTenantRentCollected({
        tenantId: created.id,
        paymentPeriod: "2026-07",
        receiptId: firstReceipt.id,
        actorType: "admin",
        actorId: input.actorId
      })
    ]);
    expect(first.id).toBe(second.id);
    await expect(repository.getTenantRentPayment(created.id, "2026-07"))
      .resolves.toMatchObject({ status: "collected", receiptId: firstReceipt.id });
  });

  it("rejects a receipt from another tenant or month", async () => {
    const repository = getRepository();
    const existing = (await repository.listTenants())[0];
    const receipt = await repository.registerTenantRentReceipt({
      tenantId: existing.id,
      paymentPeriod: "2026-07",
      originalFilename: "rent.pdf",
      declaredMimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7 rent receipt"),
      actorType: "admin",
      actorId: crypto.randomUUID()
    });
    await expect(repository.markTenantRentCollected({
      tenantId: existing.id,
      paymentPeriod: "2026-08",
      receiptId: receipt.id,
      actorType: "admin",
      actorId: crypto.randomUUID()
    })).rejects.toThrow(/does not match/i);
  });
});
