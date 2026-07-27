import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRepositoryForTests } from "../../src/data/repository";
import { deliverOperationalAlerts } from "../../src/features/operations/alerts";

describe("operational alert delivery", () => {
  const originalMode = process.env.NOTIFICATION_PROVIDER_MODE;
  const originalRecipient = process.env.ALERT_TO_EMAIL;

  beforeEach(() => {
    resetRepositoryForTests();
    process.env.DATA_BACKEND = "memory";
    process.env.NOTIFICATION_PROVIDER_MODE = "mock";
    process.env.ALERT_TO_EMAIL = "admin@example.com";
  });

  afterEach(() => {
    process.env.NOTIFICATION_PROVIDER_MODE = originalMode;
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
    process.env.NOTIFICATION_PROVIDER_MODE = "disabled";
    await expect(deliverOperationalAlerts(["Operational warning"], "job-3")).resolves.toEqual({
      considered: 1,
      sent: 0,
      failed: 0,
      skipped: 1
    });
  });
});
