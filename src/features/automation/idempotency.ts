import { sha256Digest } from "@/features/automation/confirmations";
import { idempotencyKeySchema } from "@/features/automation/schemas";
import { ApiError } from "@/lib/api";

export interface IdempotencyRecord {
  serviceAccountId: string;
  key: string;
  requestHash: string;
  status: "in_progress" | "completed" | "failed";
  responseStatus: number | null;
  responseRedacted: unknown;
  failureCode: string | null;
}

export interface IdempotencyStore {
  claim(input: {
    serviceAccountId: string;
    key: string;
    requestHash: string;
    method: string;
    path: string;
  }): Promise<{ state: "claimed" | "existing"; record: IdempotencyRecord }>;
  complete(input: {
    serviceAccountId: string;
    key: string;
    responseStatus: number;
    responseRedacted: unknown;
    resourceType?: string;
    resourceId?: string;
    resourceVersion?: string | null;
  }): Promise<void>;
  fail(input: { serviceAccountId: string; key: string; failureCode: string }): Promise<void>;
}

export function canonicalRequestHash(method: string, path: string, contentType: string, bodyDigest: string) {
  return sha256Digest({
    method: method.toUpperCase(),
    path: path.replace(/\/+/g, "/"),
    contentType: contentType.split(";")[0].trim().toLowerCase(),
    bodyDigest
  });
}

export async function withAutomationIdempotency<T>(
  store: IdempotencyStore,
  input: {
    serviceAccountId: string;
    key: string | null;
    method: string;
    path: string;
    contentType: string;
    bodyDigest: string;
  },
  operation: () => Promise<{ status: number; data: T; resourceType?: string; resourceId?: string; resourceVersion?: string | null }>
) {
  const key = idempotencyKeySchema.parse(input.key);
  const requestHash = canonicalRequestHash(input.method, input.path, input.contentType, input.bodyDigest);
  const claim = await store.claim({
    serviceAccountId: input.serviceAccountId,
    key,
    requestHash,
    method: input.method,
    path: input.path
  });
  if (claim.state === "existing") {
    if (claim.record.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for another request.");
    }
    if (claim.record.status === "in_progress") {
      throw new ApiError(409, "REQUEST_IN_PROGRESS", "The matching request is still in progress.");
    }
    if (claim.record.status === "completed") {
      return {
        status: claim.record.responseStatus ?? 200,
        data: claim.record.responseRedacted as T,
        replay: true
      };
    }
  }

  try {
    const result = await operation();
    await store.complete({
      serviceAccountId: input.serviceAccountId,
      key,
      responseStatus: result.status,
      responseRedacted: result.data,
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      resourceVersion: result.resourceVersion
    });
    return { status: result.status, data: result.data, replay: false };
  } catch (error) {
    await store.fail({
      serviceAccountId: input.serviceAccountId,
      key,
      failureCode: error instanceof ApiError ? error.code : "INTERNAL_ERROR"
    });
    throw error;
  }
}

