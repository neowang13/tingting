import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  if (process.env.DATA_BACKEND !== "supabase") {
    if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();

    const response = NextResponse.next({ request });
    const now = Date.now();
    const lastActive = Number(request.cookies.get("tt-last-active")?.value ?? now);
    const sessionStarted = Number(request.cookies.get("tt-session-started")?.value ?? now);
    const idleExpired = now - lastActive > 30 * 60_000;
    const absoluteExpired = now - sessionStarted > 12 * 60 * 60_000;

    if (idleExpired || absoluteExpired) {
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
  const lastActive = Number(request.cookies.get("tt-last-active")?.value ?? now);
  const sessionStarted = Number(request.cookies.get("tt-session-started")?.value ?? now);
  const idleExpired = now - lastActive > 30 * 60_000;
  const absoluteExpired = now - sessionStarted > 12 * 60 * 60_000;

  if (idleExpired || absoluteExpired) {
    await supabase.auth.signOut();
    const loginUrl = new URL("/admin/login?error=session_expired", request.url);
    return NextResponse.redirect(loginUrl);
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
