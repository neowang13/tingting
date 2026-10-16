import { ApiError, handleApiError, ok, readJson } from "@/lib/api";
import { submitShowingRequest } from "@/features/showings/service";
import { listPublicViewingAvailability } from "@/features/showings/availability";

import { getRepository } from "@/data/repository";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const slug = new URL(request.url).searchParams.get("propertySlug");
    if (!slug) throw new ApiError(400, "SHOWING_PROPERTY_REQUIRED", "Choose a property to view its calendar.");
    const property = await getRepository().getPublicRentalBySlug(slug);
    if (!property || property.status !== "published" || !property.publishedAt) {
      throw new ApiError(404, "SHOWING_PROPERTY_NOT_FOUND", "This property is no longer available for viewing requests.");
    }
    const response = ok(await listPublicViewingAvailability(property.id), requestId);
    response.headers.set("cache-control", "no-store");
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
