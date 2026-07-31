const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<![\w-])(?:\+[1-9]\d{7,14}|\(?[2-9]\d{2}\)?[ .-]\d{3}[ .-]\d{4})(?![\w-])/g;
const token = /\btta_[A-Za-z0-9_-]{8,20}_[A-Za-z0-9_-]{40,}\b/g;
const bearer = /\bBearer\s+[^\s"']+/gi;
const signedUrl = /https?:\/\/[^\s"']+(?:token|signature|sig|expires)=[^\s"']+/gi;

export function redactText(value) {
  return value
    .replace(bearer, "Bearer [REDACTED]")
    .replace(token, "[AUTOMATION_TOKEN_REDACTED]")
    .replace(email, "[EMAIL_REDACTED]")
    .replace(phone, "[PHONE_REDACTED]")
    .replace(signedUrl, "[SIGNED_URL_REDACTED]");
}

export function redact(value, key = "") {
  if (/(token|secret|authorization|internalNotes|normalizedPayload|body|destination)/i.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redact(child, childKey)
    ]));
  }
  return value;
}
