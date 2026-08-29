import { handleApiError, ok, readJson } from "@/lib/api";
import { submitShowingRequest } from "@/features/showings/service";
import { listPublicViewingAvailability } from "@/features/showings/availability";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const response = ok(await listPublicViewingAvailability(), requestId);
    response.headers.set("cache-control", "public, max-age=15, stale-while-revalidate=30");
    return response;
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const result = await submitShowingRequest(await readJson(request), request);
    return ok(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
