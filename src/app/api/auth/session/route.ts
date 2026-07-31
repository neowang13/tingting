import { cookies } from "next/headers";
import { ApiError, handleApiError, ok } from "@/lib/api";
import {
  assertSameOrigin,
  establishAdminSession,
  isDemoMode,
  requireAdminRequest
} from "@/lib/auth";
import { writeSecurityAudit } from "@/lib/security-audit";

const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
type MfaFlow = "challenge" | "enrollment";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    if (isDemoMode()) return ok({ established: true }, requestId);

    let mfaFlow: MfaFlow | undefined;
    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    try {
      const body = await request.json() as {
        mfaFlow?: unknown;
        accessToken?: unknown;
        refreshToken?: unknown;
      };
      if (body.mfaFlow === "challenge" || body.mfaFlow === "enrollment") mfaFlow = body.mfaFlow;
      if (typeof body.accessToken === "string") accessToken = body.accessToken;
      if (typeof body.refreshToken === "string") refreshToken = body.refreshToken;
    } catch {
      // The body is optional; identity and AAL always come from the verified Cookie Session.
    }
    if (Boolean(accessToken) !== Boolean(refreshToken)) {
      throw new ApiError(400, "INVALID_SESSION_TOKENS", "Both session tokens are required.");
    }
    const admin = accessToken && refreshToken
      ? await establishAdminSession({ accessToken, refreshToken })
      : await requireAdminRequest(request, { allowUntrackedSession: true });
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
