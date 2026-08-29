import { ApiError, handleApiError, ok } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { hashGuestToken, readGuestCookie } from "@/lib/application-guest-auth";
import { isApplicationDocumentType } from "@/features/applications/contracts";
import { uploadGuestApplicantFile } from "@/features/applications/applicant-signing";
import { applicationRequestContext } from "@/features/applications/request-context";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const session = readGuestCookie(request);
    await assertActionRateLimit(hashGuestToken(session), "application-guest-upload", 12, 15 * 60);
    const data = await request.formData();
    const file = data.get("file");
    const documentType = data.get("documentType");
    if (!(file instanceof File)) throw new ApiError(400, "APPLICATION_FILE_REQUIRED", "Choose a file to upload.");
    if (!isApplicationDocumentType(documentType)) throw new ApiError(400, "APPLICATION_DOCUMENT_TYPE_REQUIRED", "Choose the document category before uploading.");
    return ok(await uploadGuestApplicantFile(session, file, documentType, applicationRequestContext(request, requestId)), requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
