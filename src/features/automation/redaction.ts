const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?<![\w])(?:\+[1-9][\d().\s-]{7,20}\d|(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]\d{3}[\s.-]\d{4})(?![\w])/g;
const bearerPattern = /\bBearer\s+[^\s"']+/gi;
const automationTokenPattern = /\btta_[A-Za-z0-9_-]{6,}_[A-Za-z0-9_-]{20,}\b/g;
const signedUrlPattern = /https?:\/\/[^\s"']+(?:token|signature|sig|expires)=[^\s"']+/gi;

export function redactText(value: string) {
  return value
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(automationTokenPattern, "[AUTOMATION_TOKEN_REDACTED]")
    .replace(emailPattern, "[EMAIL_REDACTED]")
    .replace(phonePattern, "[PHONE_REDACTED]")
    .replace(signedUrlPattern, "[SIGNED_URL_REDACTED]");
}

export function redactValue(value: unknown, key = ""): unknown {
  if (/(token|secret|password|authorization|destination|internalNotes|normalizedPayload|payload|body)/i.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redactValue(child, childKey)
      ])
    );
  }
  return value;
}

export function safeAutomationLog(fields: Record<string, unknown>) {
  console.info(JSON.stringify(redactValue(fields)));
}

export function escapeCsvFormula(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
