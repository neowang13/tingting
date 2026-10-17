import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcp } from "@/features/mcp/auth";
import { createAdminMcpServer } from "@/features/mcp/server";
import { ApiError } from "@/lib/api";
import { mcpOrigin } from "@/features/mcp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    const principal = await authenticateMcp(request);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 12 * 1024 * 1024
    });
    const server = createAdminMcpServer(principal);
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      response.headers.set("cache-control", "no-store");
      response.headers.set("x-content-type-options", "nosniff");
      return response;
    } finally {
      // JSON-only responses are materialized before handleRequest resolves.
      await server.close();
    }
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    const code = error instanceof ApiError ? error.code : "MCP_UNAVAILABLE";
    const metadata = status === 401 ? `${mcpOrigin()}/.well-known/oauth-protected-resource/api/mcp` : "";
    return Response.json({ error: code }, { status, headers: {
      "cache-control": "no-store", ...(status === 401 ? { "www-authenticate": `Bearer resource_metadata="${metadata}"` } : {})
    } });
  }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
