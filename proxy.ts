import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const IDLE_TIMEOUT_MS = 30 * 60_000;
const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60_000;

function readTrackingTime(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sessionExpired(request: NextRequest, now: number) {
  const lastActive = readTrackingTime(request.cookies.get("tt-last-active")?.value, now);
  const sessionStarted = readTrackingTime(request.cookies.get("tt-session-started")?.value, now);
  return (
    now - lastActive > IDLE_TIMEOUT_MS ||
    now - sessionStarted > ABSOLUTE_TIMEOUT_MS ||
    lastActive > now + 60_000 ||
    sessionStarted > now + 60_000
  );
}

export async function proxy(request: NextRequest) {
  if (process.env.DATA_BACKEND !== "supabase") {
    if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();

    const response = NextResponse.next({ request });
    const now = Date.now();

    if (sessionExpired(request, now)) {
      const loginUrl = new URL("/admin/login?error=session_expired", request.url);
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.cookies.delete("tt-admin-session");
      redirectResponse.cookies.delete("tt-last-active");
      redirectResponse.cookies.delete("tt-session-started");
      return redirectResponse;
    }

    const secure = request.nextUrl.protocol === "https:";
    response.cookies.set("tt-last-active", String(now), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 12 * 60 * 60
    });
    if (!request.cookies.has("tt-session-started")) {
      response.cookies.set("tt-session-started", String(now), {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 12 * 60 * 60
      });
    }
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
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
  if (sessionExpired(request, now)) {
    await supabase.auth.signOut();
    response.cookies.delete("tt-last-active");
    response.cookies.delete("tt-session-started");
    if (!request.nextUrl.pathname.startsWith("/api/admin/")) {
      const loginUrl = new URL("/admin/login?error=session_expired", request.url);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set("tt-last-active", String(now), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 12 * 60 * 60
  });
  if (!request.cookies.has("tt-session-started")) {
    response.cookies.set("tt-session-started", String(now), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 12 * 60 * 60
    });
  }
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"]
};
