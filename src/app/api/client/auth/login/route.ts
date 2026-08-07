import { cookies } from "next/headers";
import { z } from "zod";
import { ApiError, handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin, isDemoMode } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import {
  createLocalClientSession,
  LOCAL_CLIENT_SESSION_COOKIE,
  LOCAL_CLIENT_SESSION_SECONDS,
  verifyLocalClientCredentials
} from "@/lib/local-client-auth";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    if (!isDemoMode()) throw new ApiError(404, "NOT_FOUND", "This sign-in method is unavailable.");
    const actor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
    await assertActionRateLimit(actor, "client-login", 8, 15 * 60);
    const input = schema.parse(await readJson(request));
    if (!(await verifyLocalClientCredentials(input.email, input.password))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    const cookieStore = await cookies();
    const options = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: LOCAL_CLIENT_SESSION_SECONDS
    };
    cookieStore.set(LOCAL_CLIENT_SESSION_COOKIE, createLocalClientSession(input.email), options);
    cookieStore.set("tt-client-last-active", String(Date.now()), options);
    cookieStore.set("tt-client-session-started", String(Date.now()), options);
    return ok({ signedIn: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
