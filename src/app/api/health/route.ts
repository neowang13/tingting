import { NextResponse } from "next/server";
import { getRepository } from "@/data/repository";
import { handleApiError, ok } from "@/lib/api";
import { readServerEnvironment } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const environment = readServerEnvironment(process.env, { fresh: true });
    if (environment.DATA_BACKEND === "supabase") {
      await getRepository().dashboard();
    }
    return ok({
      status: "ok",
      runtime: "nextjs",
      backend: environment.DATA_BACKEND === "memory" ? "memory-demo" : "supabase",
      persistenceReady: environment.DATA_BACKEND === "supabase",
      emailProviderMode: environment.emailProviderMode,
      smsProviderMode: environment.smsProviderMode,
      remindersForcePaused: environment.remindersForcePaused,
      checks: {
        configuration: "ok",
        database: environment.DATA_BACKEND === "supabase" ? "ok" : "not-required",
        cronAuthentication: environment.REMINDER_CRON_SECRET ? "configured" : "not-required",
        publicBaseUrl: new URL(environment.APP_BASE_URL).protocol === "https:" ? "https" : "local-http",
        emailProvider: environment.emailProviderMode,
        smsProvider: environment.smsProviderMode
      },
      timezone: environment.DEFAULT_TIMEZONE,
      timestamp: new Date().toISOString()
    }, requestId);
  } catch (error) {
    const response = handleApiError(error, requestId);
    if (response.status >= 500) return response;
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNHEALTHY", message: "The application is not ready." },
        requestId
      },
      { status: 503 }
    );
  }
}
