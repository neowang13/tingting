import { handleApiError, ok, readJson } from "@/lib/api";
import { submitContactEnquiry } from "@/features/contact/service";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const result = await submitContactEnquiry(await readJson(request), request);
    return ok(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
