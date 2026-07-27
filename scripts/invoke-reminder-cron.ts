import { pathToFileURL } from "node:url";

export async function invokeReminderCron(
  environment: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch
) {
  const baseUrl = environment.APP_BASE_URL;
  const secret = environment.REMINDER_CRON_SECRET;
  if (!baseUrl || !secret || secret.length < 24) {
    throw new Error("Cron configuration is incomplete.");
  }

  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("APP_BASE_URL must be a public HTTPS URL.");
  }

  const response = await request(new URL("/api/internal/reminders/run", base), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(55_000)
  });
  if (!response.ok) {
    throw new Error(`Reminder Cron request failed with HTTP ${response.status}.`);
  }
  const body = await response.json() as { requestId?: unknown };
  return {
    status: response.status,
    requestId: typeof body.requestId === "string" ? body.requestId : null
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void invokeReminderCron()
    .then((result) => {
      console.log(JSON.stringify({
        level: "info",
        message: "Reminder Cron completed.",
        ...result
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        level: "error",
        message: error instanceof Error ? error.message : "Reminder Cron failed."
      }));
      process.exitCode = 1;
    });
}
