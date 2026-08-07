"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";

let cachedClient: SupabaseClient | null = null;
let cachedConfiguration = "";

export function getClientAuthBrowserClient(url: string, anonKey: string) {
  const configuration = `${url}\n${anonKey}`;
  if (cachedClient && cachedConfiguration === configuration) return cachedClient;

  cachedConfiguration = configuration;
  cachedClient = createBrowserClient(url, anonKey, {
    auth: { detectSessionInUrl: false },
    cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME },
    isSingleton: false
  });
  return cachedClient;
}
