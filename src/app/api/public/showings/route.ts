import { handleApiError, ok, readJson } from "@/lib/api";
import { submitShowingRequest } from "@/features/showings/service";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const result = await submitShowingRequest(await readJson(request), request);
    return ok(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
