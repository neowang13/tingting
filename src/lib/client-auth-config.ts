export const CLIENT_SUPABASE_COOKIE_NAME = "tt-client-supabase-auth";

export function clientCallbackBaseUrl(
  requestUrl: URL,
  environment: NodeJS.ProcessEnv = process.env
): URL {
  if (environment.NODE_ENV === "production" && environment.APP_BASE_URL) {
    return new URL(new URL(environment.APP_BASE_URL).origin);
  }
  return new URL(requestUrl.origin);
}
