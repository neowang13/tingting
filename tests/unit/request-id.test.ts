import { describe, expect, it, vi } from "vitest";
import { createRequestId } from "../../src/lib/request-id";

describe("createRequestId", () => {
  it("uses the browser-native randomUUID implementation when available", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000001");
    const cryptoSource = {
      randomUUID,
      getRandomValues: vi.fn()
    } as unknown as Crypto;

    expect(createRequestId(cryptoSource)).toBe(
      "00000000-0000-4000-8000-000000000001"
    );
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(cryptoSource.getRandomValues).not.toHaveBeenCalled();
  });

  it("creates an RFC 4122 version 4 UUID when randomUUID is unavailable", () => {
    const cryptoSource = {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        (array as Uint8Array).fill(0xff);
        return array;
      }
    };

    expect(createRequestId(cryptoSource)).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff"
    );
  });
});
