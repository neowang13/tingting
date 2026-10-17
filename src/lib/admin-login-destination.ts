export function adminLoginDestination(value?: string) {
  if (!value || value.length > 8192 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/admin";
  try {
    const url = new URL(value, "https://admin.invalid");
    if (url.origin === "https://admin.invalid" && url.pathname === "/api/mcp/oauth/authorize" && !url.hash) return `${url.pathname}${url.search}`;
  } catch { /* Invalid return paths use the regular dashboard. */ }
  return "/admin";
}
