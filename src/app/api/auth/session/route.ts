import { cookies } from "next/headers";
import { handleApiError, ok } from "@/lib/api";
import { assertSameOrigin, isDemoMode, requireAdminRequest } from "@/lib/auth";
import { writeSecurityAudit } from "@/lib/security-audit";

const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
type MfaFlow = "challenge" | "enrollment";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    if (isDemoMode()) return ok({ established: true }, requestId);

    const admin = await requireAdminRequest(request, { allowUntrackedSession: true });
    let mfaFlow: MfaFlow | undefined;
    try {
      const body = await request.json() as { mfaFlow?: unknown };
      if (body.mfaFlow === "challenge" || body.mfaFlow === "enrollment") mfaFlow = body.mfaFlow;
    } catch {
      // The body is optional; identity and AAL always come from the verified Cookie Session.
    }
    const cookieStore = await cookies();
    const now = Date.now();
    const options = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS
    };
    cookieStore.set("tt-last-active", String(now), options);
    cookieStore.set("tt-session-started", String(now), options);
    await writeSecurityAudit({
      actorUserId: admin.userId,
      action: "auth.login_succeeded",
      targetType: "auth_session",
      targetId: admin.userId,
      metadata: { assuranceLevel: admin.assuranceLevel }
    });
    if (mfaFlow) {
      await writeSecurityAudit({
        actorUserId: admin.userId,
        action: mfaFlow === "enrollment"
          ? "auth.mfa_enrollment_succeeded"
          : "auth.mfa_challenge_succeeded",
        targetType: "auth_session",
        targetId: admin.userId
      });
      if (mfaFlow === "enrollment") {
        await writeSecurityAudit({
          actorUserId: admin.userId,
          action: "auth.mfa_challenge_succeeded",
          targetType: "auth_session",
          targetId: admin.userId
        });
      }
    }
    return ok({ established: true, administratorId: admin.userId }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
