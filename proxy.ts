import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";

const ADMIN_IDLE_TIMEOUT_MS = 30 * 60_000;
const ADMIN_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60_000;
const CLIENT_IDLE_TIMEOUT_MS = 15 * 60_000;
const CLIENT_ABSOLUTE_TIMEOUT_MS = 60 * 60_000;

function readTrackingTime(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sessionExpired(
  request: NextRequest,
  now: number,
  options: { lastActiveCookie: string; startedCookie: string; idleMs: number; absoluteMs: number }
) {
  const lastActive = readTrackingTime(request.cookies.get(options.lastActiveCookie)?.value, now);
  const sessionStarted = readTrackingTime(request.cookies.get(options.startedCookie)?.value, now);
  return (
    now - lastActive > options.idleMs ||
    now - sessionStarted > options.absoluteMs ||
    lastActive > now + 60_000 ||
    sessionStarted > now + 60_000
  );
}

function expiredLoginUrl(request: NextRequest, loginPath: string, preserveClientDestination: boolean) {
  const loginUrl = new URL(loginPath, request.url);
  if (preserveClientDestination && !request.nextUrl.pathname.startsWith("/api/")) {
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  return loginUrl;
}

export async function proxy(request: NextRequest) {
  const clientRoute = request.nextUrl.pathname.startsWith("/client/applications") ||
    request.nextUrl.pathname.startsWith("/client/apply") ||
    request.nextUrl.pathname.startsWith("/api/client/applications");
  const tracking = clientRoute
    ? {
        lastActiveCookie: "tt-client-last-active",
        startedCookie: "tt-client-session-started",
        sessionCookie: "tt-client-session",
        idleMs: CLIENT_IDLE_TIMEOUT_MS,
        absoluteMs: CLIENT_ABSOLUTE_TIMEOUT_MS,
        maxAge: 60 * 60,
        loginPath: "/client/login?error=session_expired"
      }
    : {
        lastActiveCookie: "tt-last-active",
        startedCookie: "tt-session-started",
        sessionCookie: "tt-admin-session",
        idleMs: ADMIN_IDLE_TIMEOUT_MS,
        absoluteMs: ADMIN_ABSOLUTE_TIMEOUT_MS,
        maxAge: 12 * 60 * 60,
        loginPath: "/admin/login?error=session_expired"
      };
  if (process.env.DATA_BACKEND !== "supabase") {
    const response = NextResponse.next({ request });
    const now = Date.now();

    if (sessionExpired(request, now, tracking)) {
      const loginUrl = expiredLoginUrl(request, tracking.loginPath, clientRoute);
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.cookies.delete(tracking.sessionCookie);
      redirectResponse.cookies.delete(tracking.lastActiveCookie);
      redirectResponse.cookies.delete(tracking.startedCookie);
      if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ success: false, error: { code: "SESSION_EXPIRED", message: "The session expired." } }, { status: 401 });
      return redirectResponse;
    }

    const secure = request.nextUrl.protocol === "https:";
    response.cookies.set(tracking.lastActiveCookie, String(now), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: tracking.maxAge
    });
    if (!request.cookies.has(tracking.startedCookie)) {
      response.cookies.set(tracking.startedCookie, String(now), {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: tracking.maxAge
      });
    }
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: clientRoute ? { name: CLIENT_SUPABASE_COOKIE_NAME } : undefined,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  await supabase.auth.getUser();

  const now = Date.now();
  if (sessionExpired(request, now, tracking)) {
    await supabase.auth.signOut();
    response.cookies.delete(tracking.lastActiveCookie);
    response.cookies.delete(tracking.startedCookie);
    if (!request.nextUrl.pathname.startsWith("/api/")) {
      const loginUrl = expiredLoginUrl(request, tracking.loginPath, clientRoute);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set(tracking.lastActiveCookie, String(now), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: tracking.maxAge
  });
  if (!request.cookies.has(tracking.startedCookie)) {
    response.cookies.set(tracking.startedCookie, String(now), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: tracking.maxAge
    });
  }
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/client/applications/:path*", "/client/apply/:path*", "/api/client/applications/:path*"]
};
