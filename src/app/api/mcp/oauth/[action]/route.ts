import { oauthGET, oauthPOST } from "@/features/mcp/oauth-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) { return oauthGET(request, (await context.params).action); }
export async function POST(request: Request, context: Context) { return oauthPOST(request, (await context.params).action); }
