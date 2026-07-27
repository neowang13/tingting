import { describe, expect, it, vi } from "vitest";
import { invokeReminderCron } from "../../scripts/invoke-reminder-cron";

describe("Render reminder Cron invoker", () => {
  it("refuses non-public HTTP application URLs", async () => {
    const request = vi.fn();
    await expect(invokeReminderCron({
      APP_BASE_URL: "http://localhost:3000",
      REMINDER_CRON_SECRET: "test-secret-that-is-at-least-24-characters"
    }, request as typeof fetch)).rejects.toThrow("public HTTPS");
    expect(request).not.toHaveBeenCalled();
  });

  it("posts to the fixed worker path without exposing the secret in its result", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      requestId: "request-123",
      data: {}
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const secret = "test-secret-that-is-at-least-24-characters";
    const result = await invokeReminderCron({
      APP_BASE_URL: "https://admin.example.test",
      REMINDER_CRON_SECRET: secret
    }, request as typeof fetch);

    expect(request).toHaveBeenCalledWith(
      new URL("https://admin.example.test/api/internal/reminders/run"),
      expect.objectContaining({
        method: "POST",
        headers: { authorization: `Bearer ${secret}` }
      })
    );
    expect(result).toEqual({ status: 200, requestId: "request-123" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
