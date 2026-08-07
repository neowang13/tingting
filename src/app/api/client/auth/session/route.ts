import { cookies } from "next/headers";
import { z } from "zod";
import { ApiError, handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin, isDemoMode } from "@/lib/auth";
import { establishClientSession } from "@/lib/client-auth";

const schema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1) });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    if (isDemoMode()) throw new ApiError(404, "NOT_FOUND", "This session method is unavailable.");
    const input = schema.parse(await readJson(request));
    const client = await establishClientSession(input);
    const cookieStore = await cookies();
    const options = { httpOnly: true, sameSite: "lax" as const, secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 60 * 60 };
    cookieStore.set("tt-client-last-active", String(Date.now()), options);
    cookieStore.set("tt-client-session-started", String(Date.now()), options);
    return ok({ established: true, clientId: client.userId }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
