import { describe, expect, it } from "vitest";
import {
  assertAutomationScope,
  confirmationActionScopes,
  routeScopes
} from "@/features/automation/scopes";

describe("automation scope map", () => {
  it("declares one exact scope or explicit token-only access for every route", () => {
    expect(Object.keys(routeScopes)).toHaveLength(28);
    for (const value of Object.values(routeScopes)) {
      expect(value === null || value.includes(":")).toBe(true);
    }
    expect(confirmationActionScopes["tenant.permission.grant"]).toBe("permissions:grant");
    expect(confirmationActionScopes["schedule.enable"]).toBe("schedules:enable");
  });

  it("fails closed when the required scope is absent", () => {
    expect(() => assertAutomationScope(["rentals:read"], "rentals:publish")).toThrow(/scope is required/i);
    expect(() => assertAutomationScope(["rentals:publish"], "rentals:publish")).not.toThrow();
  });
});
