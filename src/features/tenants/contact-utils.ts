export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function normalizePhoneE164(value: string, defaultCountryCode = "1") {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return trimmed;
}

export function maskEmail(value: string | null) {
  if (!value) return null;
  const [name, domain] = value.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 1)}***@${domain}`;
}

export function maskPhone(value: string | null) {
  if (!value) return null;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}
