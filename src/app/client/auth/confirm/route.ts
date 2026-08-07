import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";

function clientLoginRedirect(requestUrl: URL, verification: "success" | "error") {
  const destination = new URL("/client/login", requestUrl.origin);
  destination.searchParams.set("verification", verification);
  return Response.redirect(destination, 303);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code || !supabaseUrl || !anonKey) {
    return clientLoginRedirect(requestUrl, "error");
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
      if (error) return clientLoginRedirect(requestUrl, "error");

      const { error: signOutError } = await client.auth.signOut({ scope: "local" });
      return clientLoginRedirect(requestUrl, signOutError ? "error" : "success");
    } finally {
      sessionCookieNames.forEach((name) => cookieStore.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: requestUrl.protocol === "https:"
      }));
    }
  } catch {
    return clientLoginRedirect(requestUrl, "error");
  }
}
