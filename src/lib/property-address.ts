export function normalizePropertyAddressLine(addressLine: string) {
  return addressLine.trim().replace(/,\s*$/, "");
}

export function formatPropertyAddress(addressLine: string, city: string) {
  return [normalizePropertyAddressLine(addressLine), city.trim()].filter(Boolean).join(", ");
}
