import { createHash } from "node:crypto";

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(
    Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonicalJson(value)
  ).digest("hex")}`;
}

