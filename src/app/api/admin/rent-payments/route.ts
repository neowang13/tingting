import { getRepository } from "@/data/repository";
import { paymentPeriod } from "@/features/rent-payments/service";
import { ApiError, handleApiError, ok, readJson } from "@/lib/api";
import {
  assertRecentAuthentication,
  assertSameOrigin,
  requireAdminRequest
} from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const admin = await requireAdminRequest(request);
    void admin;
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");
    const period = url.searchParams.get("period");
    if (!tenantId || !period) {
      throw new ApiError(400, "RENT_PAYMENT_QUERY_INVALID", "tenantId and period are required.");
    }
    return ok(
      await getRepository().getTenantRentPayment(tenantId, paymentPeriod(period)),
      requestId
    );
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    await assertRecentAuthentication(admin);
    const form = await request.formData();
    const tenantId = String(form.get("tenantId") ?? "");
    const period = paymentPeriod(String(form.get("period") ?? ""));
    const file = form.get("file");
    const note = String(form.get("note") ?? "").trim() || null;
    if (!tenantId || !(file instanceof File)) {
      throw new ApiError(400, "RECEIPT_REQUIRED", "Choose a receipt before marking rent as collected.");
    }
    const repository = getRepository();
    const current = await repository.getTenantRentPayment(tenantId, period);
    if (current.status === "collected") {
      return ok({ ...current, alreadyCollected: true }, requestId);
    }
    const receipt = await repository.registerTenantRentReceipt({
      tenantId,
      paymentPeriod: period,
      originalFilename: file.name,
      declaredMimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actorType: "admin",
      actorId: admin.userId
    });
    const payment = await repository.markTenantRentCollected({
      tenantId,
      paymentPeriod: period,
      receiptId: receipt.id,
      actorType: "admin",
      actorId: admin.userId,
      note
    });
    return ok({ ...payment, receipt }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    await assertRecentAuthentication(admin);
    const body = await readJson(request) as Record<string, unknown>;
    const tenantId = String(body.tenantId ?? "");
    const period = paymentPeriod(String(body.period ?? ""));
    const expectedVersion = String(body.expectedVersion ?? "");
    if (!tenantId || !expectedVersion) {
      throw new ApiError(400, "RENT_PAYMENT_UPDATE_INVALID", "Tenant, period, and current version are required.");
    }
    return ok(await getRepository().reopenTenantRentPayment({
      tenantId,
      paymentPeriod: period,
      expectedVersion,
      actorId: admin.userId,
      reason: typeof body.reason === "string" ? body.reason.trim() || null : null
    }), requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
