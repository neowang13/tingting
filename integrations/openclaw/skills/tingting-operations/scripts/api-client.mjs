import { randomUUID } from "node:crypto";
import { redact } from "./redact.mjs";

const transientStatuses = new Set([408, 429, 502, 503, 504]);

export function validateBaseUrl(raw) {
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!local && url.protocol !== "https:") throw new Error("TINGTING_API_BASE_URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("TINGTING_API_BASE_URL is invalid.");
  if (!url.pathname.endsWith("/api/automation/v1")) {
    throw new Error("TINGTING_API_BASE_URL must end with /api/automation/v1.");
  }
  return url.toString().replace(/\/$/, "");
}

export class TingTingApiClient {
  constructor({
    baseUrl,
    token,
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  }) {
    this.baseUrl = validateBaseUrl(baseUrl);
    if (!token || !/^tta_[A-Za-z0-9_-]{8,20}_[A-Za-z0-9_-]{40,}$/.test(token)) {
      throw new Error("TINGTING_AUTOMATION_TOKEN is missing or malformed.");
    }
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  async request({
    method,
    path,
    body,
    form,
    mutation = false,
    requestId = randomUUID(),
    idempotencyKey = mutation ? randomUUID() : undefined
  }) {
    if (!path.startsWith("/") || path.startsWith("//") || /https?:/i.test(path)) {
      throw new Error("Only relative Automation API paths are allowed.");
    }
    const url = new URL(`${this.baseUrl}${path}`);
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error("Outbound host is not allowed.");
    const headers = {
      authorization: `Bearer ${this.token}`,
      "x-request-id": requestId
    };
    if (mutation) headers["idempotency-key"] = idempotencyKey;
    if (!form) headers["content-type"] = "application/json";

    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: form ?? (body === undefined ? undefined : JSON.stringify(body))
        });
        const payload = await response.json().catch(() => ({
          success: false,
          error: { code: "INVALID_SERVER_RESPONSE", message: "The API returned invalid JSON." },
          requestId
        }));
        if (response.ok) return redact(payload);
        if (!transientStatuses.has(response.status) || attempt === 2) {
          const error = new Error(payload?.error?.message ?? `Automation API returned ${response.status}.`);
          error.code = payload?.error?.code ?? "AUTOMATION_API_ERROR";
          error.status = response.status;
          error.requestId = payload?.requestId ?? requestId;
          throw error;
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10_000)
          : Math.min(250 * 2 ** attempt, 2_000));
      } catch (error) {
        lastError = error;
        if (error?.status && !transientStatuses.has(error.status)) throw error;
        if (attempt === 2) throw error;
        await this.sleep(Math.min(250 * 2 ** attempt, 2_000));
      }
    }
    throw lastError;
  }
}

export function isTransientStatus(status) {
  return transientStatuses.has(status);
}

