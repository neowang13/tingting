import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth";
import { LOCAL_CLIENT_SESSION_COOKIE } from "@/lib/local-client-auth";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";
import { expireClientRecoveryMarker } from "@/lib/client-recovery";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey) {
    const client = createServerClient(url, anonKey, {
      cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME },
      cookies: { getAll: () => cookieStore.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
    });
    await client.auth.signOut();
  }
  cookieStore.delete(LOCAL_CLIENT_SESSION_COOKIE);
  cookieStore.delete("tt-client-last-active");
  cookieStore.delete("tt-client-session-started");
  expireClientRecoveryMarker(cookieStore, new URL(request.url).protocol === "https:");
  return NextResponse.json({ success: true });
}
