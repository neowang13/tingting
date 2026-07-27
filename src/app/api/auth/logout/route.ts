import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { LOCAL_ADMIN_SESSION_COOKIE } from "@/lib/local-admin-auth";
import { writeSecurityAudit } from "@/lib/security-audit";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    try {
      const admin = await requireAdminRequest(request);
      await writeSecurityAudit({
        actorUserId: admin.userId,
        action: "auth.logout",
        targetType: "auth_session",
        targetId: admin.userId
      });
    } catch {
      // Logout remains available when a session has already expired.
    }
    const client = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
      }
    });
    await client.auth.signOut();
  }
  cookieStore.delete(LOCAL_ADMIN_SESSION_COOKIE);
  cookieStore.delete("tt-last-active");
  cookieStore.delete("tt-session-started");
  return NextResponse.json({ success: true });
}
