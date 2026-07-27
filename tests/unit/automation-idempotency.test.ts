import { describe, expect, it } from "vitest";
import {
  canonicalRequestHash,
  type IdempotencyRecord,
  type IdempotencyStore,
  withAutomationIdempotency
} from "@/features/automation/idempotency";

class TestStore implements IdempotencyStore {
  records = new Map<string, IdempotencyRecord>();
  async claim(input: { serviceAccountId: string; key: string; requestHash: string }) {
    const mapKey = `${input.serviceAccountId}:${input.key}`;
    const existing = this.records.get(mapKey);
    if (existing) return { state: "existing" as const, record: existing };
    const record: IdempotencyRecord = {
      serviceAccountId: input.serviceAccountId,
      key: input.key,
      requestHash: input.requestHash,
      status: "in_progress",
      responseStatus: null,
      responseRedacted: null,
      failureCode: null
    };
    this.records.set(mapKey, record);
    return { state: "claimed" as const, record };
  }
  async complete(input: { serviceAccountId: string; key: string; responseStatus: number; responseRedacted: unknown }) {
    Object.assign(this.records.get(`${input.serviceAccountId}:${input.key}`)!, {
      status: "completed",
      responseStatus: input.responseStatus,
      responseRedacted: input.responseRedacted
    });
  }
  async fail(input: { serviceAccountId: string; key: string; failureCode: string }) {
    Object.assign(this.records.get(`${input.serviceAccountId}:${input.key}`)!, {
      status: "failed",
      failureCode: input.failureCode
    });
  }
}

describe("automation idempotency", () => {
  it("returns the completed result on replay and rejects changed requests", async () => {
    const store = new TestStore();
    const serviceAccountId = crypto.randomUUID();
    const key = crypto.randomUUID();
    let calls = 0;
    const input = {
      serviceAccountId,
      key,
      method: "POST",
      path: "/api/automation/v1/rentals",
      contentType: "application/json",
      bodyDigest: "sha256:".padEnd(71, "a")
    };
    const first = await withAutomationIdempotency(store, input, async () => {
      calls += 1;
      return { status: 201, data: { id: "one" } };
    });
    const replay = await withAutomationIdempotency(store, input, async () => {
      calls += 1;
      return { status: 201, data: { id: "two" } };
    });
    expect(first.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(replay.data).toEqual({ id: "one" });
    expect(calls).toBe(1);
    await expect(withAutomationIdempotency(
      store,
      { ...input, bodyDigest: "sha256:".padEnd(71, "b") },
      async () => ({ status: 201, data: {} })
    )).rejects.toThrow(/another request/i);
  });

  it("canonicalizes stable request attributes", () => {
    expect(canonicalRequestHash("post", "//api//automation/v1", "application/json; charset=utf-8", "x"))
      .toBe(canonicalRequestHash("POST", "/api/automation/v1", "application/json", "x"));
  });
});

