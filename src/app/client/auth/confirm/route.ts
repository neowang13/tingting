import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  CLIENT_SUPABASE_COOKIE_NAME,
  clientCallbackBaseUrl
} from "@/lib/client-auth-config";
import { sanitizeClientNextPath } from "@/lib/client-signup";

function clientLoginRedirect(requestUrl: URL, verification: "success" | "error", nextPath?: string) {
  const destination = new URL("/client/login", requestUrl.origin);
  destination.searchParams.set("verification", verification);
  const safeNextPath = sanitizeClientNextPath(nextPath);
  if (safeNextPath !== "/") {
    destination.searchParams.set("next", safeNextPath);
  }
  return Response.redirect(destination, 303);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callbackBaseUrl = clientCallbackBaseUrl(requestUrl);
  const code = requestUrl.searchParams.get("code");
  const nextPath = requestUrl.searchParams.get("next") ?? undefined;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code || !supabaseUrl || !anonKey) {
    return clientLoginRedirect(callbackBaseUrl, "error", nextPath);
  }

  try {
    const cookieStore = await cookies();
    const sessionCookieNames = new Set(
      cookieStore.getAll()
        .map(({ name }) => name)
        .filter((name) =>
          name === CLIENT_SUPABASE_COOKIE_NAME
          || name.startsWith(`${CLIENT_SUPABASE_COOKIE_NAME}.`)
        )
    );
    sessionCookieNames.add(CLIENT_SUPABASE_COOKIE_NAME);
    const client = createServerClient(supabaseUrl, anonKey, {
      cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value, options }) => {
            if (
              name === CLIENT_SUPABASE_COOKIE_NAME
              || name.startsWith(`${CLIENT_SUPABASE_COOKIE_NAME}.`)
            ) {
              sessionCookieNames.add(name);
            }
            cookieStore.set(name, value, options);
          });
        }
      }
    });
    try {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        // Supabase only appends a code after it accepts the confirmation link.
        // A different browser will not have the original PKCE verifier, so the
        // session exchange can fail even though the email is already confirmed.
        return clientLoginRedirect(callbackBaseUrl, "success", nextPath);
      }

      const { error: signOutError } = await client.auth.signOut({ scope: "local" });
      return clientLoginRedirect(callbackBaseUrl, signOutError ? "error" : "success", nextPath);
    } finally {
      sessionCookieNames.forEach((name) => cookieStore.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: callbackBaseUrl.protocol === "https:"
      }));
    }
  } catch {
    return clientLoginRedirect(callbackBaseUrl, "error", nextPath);
  }
}
