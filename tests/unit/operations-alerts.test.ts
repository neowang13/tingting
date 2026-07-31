import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRepositoryForTests } from "../../src/data/repository";
import {
  deliverOperationalAlerts,
  warningsBeforeReminderRepair
} from "../../src/features/operations/alerts";
import type { EmailProvider } from "@/features/notifications/providers/types";

describe("operational alert delivery", () => {
  const originalMode = process.env.EMAIL_PROVIDER_MODE;
  const originalRecipient = process.env.ALERT_TO_EMAIL;

  beforeEach(() => {
    resetRepositoryForTests();
    process.env.DATA_BACKEND = "memory";
    process.env.EMAIL_PROVIDER_MODE = "mock";
    process.env.ALERT_TO_EMAIL = "admin@example.com";
  });

  afterEach(() => {
    process.env.EMAIL_PROVIDER_MODE = originalMode;
    process.env.ALERT_TO_EMAIL = originalRecipient;
    resetRepositoryForTests();
  });

  it("sends one safe mock alert per warning bucket", async () => {
    const warning = "Several provider attempts have failed. Review delivery history before retrying.";
    await expect(deliverOperationalAlerts([warning], "job-1")).resolves.toEqual({
      considered: 1,
      sent: 1,
      failed: 0,
      skipped: 0
    });
    await expect(deliverOperationalAlerts([warning], "job-2")).resolves.toEqual({
      considered: 1,
      sent: 0,
      failed: 0,
      skipped: 1
    });
  });

  it("fails closed without contacting a disabled provider", async () => {
    process.env.EMAIL_PROVIDER_MODE = "disabled";
    await expect(deliverOperationalAlerts(["Operational warning"], "job-3")).resolves.toEqual({
      considered: 1,
      sent: 0,
      failed: 0,
      skipped: 1
    });
  });

  it("explains a reconciliation gap only after repair still failed", async () => {
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "reconciliation-email",
      status: "queued"
    });
    const warning = "Daily reminder reconciliation found missing schedule events.";

    await expect(deliverOperationalAlerts(
      [warning],
      "job-readable",
      { send } as EmailProvider
    )).resolves.toMatchObject({ sent: 1, failed: 0 });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Ting Ting action needed: a rent reminder could not be repaired",
      text: expect.stringContaining("No tenant reminder was confirmed"),
      html: expect.stringContaining("Admin → Email activity")
    }));
  });

  it("does not alert on a reconciliation gap before the worker gets a repair attempt", () => {
    expect(warningsBeforeReminderRepair([
      "Daily reminder reconciliation found missing schedule events.",
      "Several provider attempts have failed. Review delivery history before retrying."
    ], false)).toEqual([
      "Several provider attempts have failed. Review delivery history before retrying."
    ]);
  });
});
