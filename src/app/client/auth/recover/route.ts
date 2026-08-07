import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";
import {
  CLIENT_RECOVERY_COOKIE_NAME,
  clientRecoveryCookieOptions,
  createClientRecoveryMarker,
  expireClientRecoverySession,
  isEligibleRecoveryClient
} from "@/lib/client-recovery";

function recoveryRedirect(requestUrl: URL, success: boolean) {
  const destination = new URL(
    success ? "/client/reset-password" : "/client/login",
    requestUrl.origin
  );
  if (!success) destination.searchParams.set("recovery", "error");
  return Response.redirect(destination, 303);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const secure = requestUrl.protocol === "https:";
  const cookieStore = await cookies();
  const code = requestUrl.searchParams.get("code");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!code || !supabaseUrl || !anonKey || !serviceKey) {
    expireClientRecoverySession(cookieStore, secure);
    return recoveryRedirect(requestUrl, false);
  }

  let client: ReturnType<typeof createServerClient> | null = null;
  try {
    client = createServerClient(supabaseUrl, anonKey, {
      cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        }
      }
    });
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data.user?.id || !data.user.email_confirmed_at) throw userError ?? new Error("Missing user");
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    if (!await isEligibleRecoveryClient(service, data.user.id)) throw new Error("Ineligible recovery identity");

    cookieStore.set(
      CLIENT_RECOVERY_COOKIE_NAME,
      createClientRecoveryMarker(data.user.id),
      clientRecoveryCookieOptions(secure)
    );
    return recoveryRedirect(requestUrl, true);
  } catch {
    try {
      await client?.auth.signOut({ scope: "local" });
    } catch {
      // Explicit cookie expiry below remains the fail-closed boundary.
    }
    expireClientRecoverySession(cookieStore, secure);
    return recoveryRedirect(requestUrl, false);
  }
}
