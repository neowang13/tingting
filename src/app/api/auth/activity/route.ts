import { cookies } from "next/headers";
import { assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { handleApiError, ok } from "@/lib/api";
import { ADMIN_LAST_ACTIVE_COOKIE, ADMIN_SESSION_STARTED_COOKIE, adminSessionTimes } from "@/lib/admin-session-policy";

async function activity(request: Request, touch: boolean) {
  const requestId = crypto.randomUUID();
  try {
    if (touch) assertSameOrigin(request);
    await requireAdminRequest(request);
    const store = await cookies();
    const now = Date.now();
    if (touch) store.set(ADMIN_LAST_ACTIVE_COOKIE, String(now), {
      httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 12 * 60 * 60
    });
    const times = adminSessionTimes(touch ? String(now) : store.get(ADMIN_LAST_ACTIVE_COOKIE)?.value, store.get(ADMIN_SESSION_STARTED_COOKIE)?.value, now);
    const response = ok(times, requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) { return handleApiError(error, requestId); }
}
export const GET = (request: Request) => activity(request, false);
export const POST = (request: Request) => activity(request, true);
