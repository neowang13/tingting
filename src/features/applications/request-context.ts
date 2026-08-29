import { createHmac } from "node:crypto";
import type { ApplicationRequestContext } from "@/features/applications/applicant-signing";
import { applicationGuestSecret } from "@/lib/application-guest-auth";

export function hashApplicationRequestValue(value: string, purpose: "ip" | "user-agent") {
  return createHmac("sha256", applicationGuestSecret())
    .update(`application-request:${purpose}:`)
    .update(value || "unknown")
    .digest("hex");
}

export function applicationRequestContext(request: Request, requestId: string): ApplicationRequestContext {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return {
    requestId,
    userAgentHash: hashApplicationRequestValue(request.headers.get("user-agent") ?? "unknown", "user-agent"),
    ipHash: hashApplicationRequestValue(forwarded, "ip"),
  };
}
