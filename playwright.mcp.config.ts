import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base, testDir: "./tests/e2e-mcp", testMatch: "admin-mcp.spec.ts", timeout: 60000,
  use: { ...base.use, baseURL: "http://127.0.0.1:3231" },
  webServer: {
    ...(base.webServer as object),
    command: (base.webServer as { command: string }).command.replaceAll("3200", "3231").replace(".next-e2e", ".next-mcp-e2e")
      .replace("DATA_BACKEND=memory", "DATA_BACKEND=memory MCP_ENABLED=true NEXT_PUBLIC_ADMIN_MFA_REQUIRED=false")
      .replace("SMS_PROVIDER_MODE=mock", "SMS_PROVIDER_MODE=disabled"),
    url: "http://127.0.0.1:3231/api/health", reuseExistingServer: false, timeout: 60000
  }
});
