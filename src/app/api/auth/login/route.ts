import { cookies } from "next/headers";
import { z } from "zod";
import { handleApiError, ok, readJson, ApiError } from "@/lib/api";
import { assertSameOrigin, isDemoMode } from "@/lib/auth";
import {
  createLocalAdminSession,
  LOCAL_ADMIN_SESSION_COOKIE,
  LOCAL_ADMIN_SESSION_SECONDS,
  verifyLocalAdminCredentials
} from "@/lib/local-admin-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256)
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    if (!isDemoMode()) {
      throw new ApiError(404, "NOT_FOUND", "This sign-in method is unavailable.");
    }

    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const actorKey = forwardedFor || request.headers.get("x-real-ip") || "local";
    await assertActionRateLimit(actorKey, "admin-login", 8, 15 * 60);

    const input = loginSchema.parse(await readJson(request));
    if (!(await verifyLocalAdminCredentials(input.email, input.password))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    const cookieStore = await cookies();
    cookieStore.set(LOCAL_ADMIN_SESSION_COOKIE, createLocalAdminSession(input.email), {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: LOCAL_ADMIN_SESSION_SECONDS
    });
    cookieStore.delete("tt-last-active");
    cookieStore.delete("tt-session-started");
    return ok({ signedIn: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
