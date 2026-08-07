import { z } from "zod";

const DEFAULT_CLIENT_NEXT_PATH = "/";
const CLIENT_REDIRECT_BASE = "https://client-redirect.invalid";
export const CLIENT_PASSWORD_MIN_LENGTH = 11;

export const clientSignupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(254),
  password: z.string().min(CLIENT_PASSWORD_MIN_LENGTH).max(256)
}).strict();

export type ClientSignupInput = z.infer<typeof clientSignupSchema>;

export function parseClientSignup(input: unknown): ClientSignupInput {
  return clientSignupSchema.parse(input);
}

export function clientEmailConfirmationRedirect(origin: string): string {
  return new URL("/client/auth/confirm", origin).toString();
}

export function sanitizeClientNextPath(candidate: string | null | undefined): string {
  if (
    !candidate ||
    candidate.length > 2_048 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return DEFAULT_CLIENT_NEXT_PATH;
  }

  try {
    const parsed = new URL(candidate, CLIENT_REDIRECT_BASE);
    if (
      parsed.origin !== CLIENT_REDIRECT_BASE ||
      (parsed.pathname !== "/client" && !parsed.pathname.startsWith("/client/"))
    ) {
      return DEFAULT_CLIENT_NEXT_PATH;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_CLIENT_NEXT_PATH;
  }
}
