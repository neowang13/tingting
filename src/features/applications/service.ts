import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import type { AdminIdentity } from "@/lib/auth";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/site-contact";
import {
  APPLICATION_FORM_VERSION,
  APPLICATION_MAX_FILE_BYTES,
  APPLICATION_RETENTION_MONTHS,
  APPLICATION_TERMS_VERSION,
  APPLICATION_UPLOAD_BUCKET,
  applicationFormText,
  applicationTermsText,
  type ApplicationFileRecord,
  type ApplicationStatus,
  type ClientApplicationRecord,
  type ClientIdentity
} from "@/features/applications/contracts";
import {
  applicationDraftSchema,
  validateCompleteApplicationDraft,
  type ApplicationDraft
} from "@/features/applications/schemas";
import { renderApplicationSubmittedNotification } from "@/features/applications/notification";
import {
  createNotificationProviders,
  resolveEmailProviderMode
} from "@/features/notifications/providers";
import type { EmailProvider } from "@/features/notifications/providers/types";

const DEMO_APPLICATION_ID = "30000000-0000-4000-8000-000000000009";
const APPLICATION_SELECT = `
  id,owner_user_id,property_title,property_address,status,assigned_at,submitted_at,
  consented_at,retain_until,draft_payload,draft_updated_at,
  rental_listings(slug),
  application_form_versions!inner(version,sha256,legal_review_status,filename,content_type,content_text,storage_path),
  application_terms_versions!inner(version,sha256,legal_review_status,displayed_text),
  client_application_files(id,original_filename,mime_type,byte_size,scan_status,uploaded_at)
`;

interface DemoApplication extends ClientApplicationRecord {
  consentText: string | null;
  audit: Array<{ action: string; createdAt: string }>;
}

declare global {
  var __tingtingClientApplications: Map<string, DemoApplication> | undefined;
  var __tingtingClientApplicationFileBytes: Map<string, Uint8Array> | undefined;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function demoStore() {
  globalThis.__tingtingClientApplications ??= new Map();
  if (!globalThis.__tingtingClientApplications.has(DEMO_APPLICATION_ID)) {
    const now = new Date().toISOString();
    globalThis.__tingtingClientApplications.set(DEMO_APPLICATION_ID, {
      id: DEMO_APPLICATION_ID,
      ownerUserId: "00000000-0000-4000-8000-000000000009",
      propertySlug: "howe-street-one-bedroom",
      propertyTitle: "Bright Downtown One Bedroom",
      propertyAddress: "1285 Howe Street, Vancouver",
      status: "draft",
      formVersion: APPLICATION_FORM_VERSION,
      formSha256: sha256(applicationFormText),
      termsVersion: APPLICATION_TERMS_VERSION,
      termsSha256: sha256(applicationTermsText),
      legalReviewStatus: "pending",
      assignedAt: now,
      submittedAt: null,
      consentedAt: null,
      retainUntil: null,
      draft: applicationDraftSchema.parse({}),
      draftUpdatedAt: null,
      files: [],
      consentText: null,
      audit: [{ action: "application.assigned", createdAt: now }]
    });
  }
  return globalThis.__tingtingClientApplications;
}

function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application service is not configured.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function applicationBucket() {
  return process.env.APPLICATION_UPLOAD_BUCKET || APPLICATION_UPLOAD_BUCKET;
}

function relation(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function mapApplication(row: Record<string, unknown>): ClientApplicationRecord {
  const form = relation(row.application_form_versions) as Record<string, unknown>;
  const terms = relation(row.application_terms_versions) as Record<string, unknown>;
  const rental = relation(row.rental_listings) as Record<string, unknown> | undefined;
  const files = (row.client_application_files ?? []) as Array<Record<string, unknown>>;
  const draft = applicationDraftSchema.safeParse(row.draft_payload ?? {});
  if (!draft.success) {
    throw new ApiError(503, "APPLICATION_DRAFT_INVALID", "The saved application draft could not be loaded.");
  }
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    propertySlug: rental?.slug ? String(rental.slug) : null,
    propertyTitle: String(row.property_title),
    propertyAddress: String(row.property_address),
    status: row.status as ApplicationStatus,
    formVersion: String(form.version),
    formSha256: String(form.sha256),
    termsVersion: String(terms.version),
    termsSha256: String(terms.sha256),
    legalReviewStatus: form.legal_review_status === "approved" && terms.legal_review_status === "approved" ? "approved" : "pending",
    assignedAt: String(row.assigned_at),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    consentedAt: row.consented_at ? String(row.consented_at) : null,
    retainUntil: row.retain_until ? String(row.retain_until) : null,
    draft: draft.data,
    draftUpdatedAt: row.draft_updated_at ? String(row.draft_updated_at) : null,
    files: files.map((file) => ({
      id: String(file.id),
      originalFilename: String(file.original_filename),
      mimeType: file.mime_type as ApplicationFileRecord["mimeType"],
      byteSize: Number(file.byte_size),
      scanStatus: file.scan_status as ApplicationFileRecord["scanStatus"],
      uploadedAt: String(file.uploaded_at)
    })).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
  };
}

async function loadOwnedApplication(identity: ClientIdentity, id: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    const application = demoStore().get(id);
    if (!application || application.ownerUserId !== identity.userId) {
      throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
    }
    return structuredClone(application);
  }
  const result = await supabaseService().from("client_applications")
    .select(APPLICATION_SELECT)
    .eq("id", id)
    .eq("owner_user_id", identity.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application could not be loaded.");
  if (!result.data) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  return mapApplication(result.data as unknown as Record<string, unknown>);
}

export async function listClientApplications(identity: ClientIdentity) {
  if (process.env.DATA_BACKEND !== "supabase") {
    return [...demoStore().values()]
      .filter((application) => application.ownerUserId === identity.userId)
      .map((application) => structuredClone(application));
  }
  const result = await supabaseService().from("client_applications")
    .select(APPLICATION_SELECT)
    .eq("owner_user_id", identity.userId)
    .is("deleted_at", null)
    .order("assigned_at", { ascending: false });
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Applications could not be loaded.");
  return (result.data ?? []).map((row) => mapApplication(row as unknown as Record<string, unknown>));
}

export async function getClientApplication(identity: ClientIdentity, id: string) {
  return loadOwnedApplication(identity, id);
}

export async function getApplicationTerms(identity: ClientIdentity, id: string) {
  await loadOwnedApplication(identity, id);
  if (process.env.DATA_BACKEND !== "supabase") return applicationTermsText;
  const result = await supabaseService().from("client_applications")
    .select("application_terms_versions!inner(displayed_text)")
    .eq("id", id)
    .eq("owner_user_id", identity.userId)
    .single();
  if (result.error || !result.data) throw new ApiError(404, "APPLICATION_TERMS_NOT_FOUND", "Application terms not found.");
  const terms = relation(result.data.application_terms_versions) as Record<string, unknown>;
  return String(terms.displayed_text);
}

export async function saveApplicationDraft(
  identity: ClientIdentity,
  id: string,
  input: { draft: ApplicationDraft; activeStep: number }
) {
  const application = await loadOwnedApplication(identity, id);
  if (application.status !== "draft") {
    throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "This application can no longer be edited.");
  }
  const draft = applicationDraftSchema.parse(input.draft);
  const updatedAt = new Date().toISOString();

  if (process.env.DATA_BACKEND !== "supabase") {
    const stored = demoStore().get(id)!;
    stored.draft = structuredClone(draft);
    stored.draftUpdatedAt = updatedAt;
    stored.audit.push({ action: "application.draft_saved", createdAt: updatedAt });
    return { draft: structuredClone(draft), draftUpdatedAt: updatedAt };
  }

  const service = supabaseService();
  const updated = await service.from("client_applications").update({
    draft_payload: draft,
    draft_updated_at: updatedAt,
    updated_at: updatedAt
  }).eq("id", id).eq("owner_user_id", identity.userId).eq("status", "draft").select("id").maybeSingle();
  if (updated.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application draft could not be saved.");
  if (!updated.data) throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "This application can no longer be edited.");
  await service.from("client_application_audit_events").insert({
    application_id: id,
    actor_user_id: identity.userId,
    actor_type: "client",
    action: "application.draft_saved",
    request_context: { activeStep: input.activeStep }
  });
  return { draft, draftUpdatedAt: updatedAt };
}

export async function getApplicationForm(identity: ClientIdentity, id: string) {
  await loadOwnedApplication(identity, id);
  if (process.env.DATA_BACKEND !== "supabase") {
    return {
      filename: `ting-ting-rental-application-${APPLICATION_FORM_VERSION}.txt`,
      contentType: "text/plain; charset=utf-8",
      bytes: Buffer.from(applicationFormText, "utf8")
    };
  }
  const result = await supabaseService().from("client_applications")
    .select("application_form_versions!inner(filename,content_type,content_text,storage_path)")
    .eq("id", id)
    .eq("owner_user_id", identity.userId)
    .single();
  if (result.error || !result.data) throw new ApiError(404, "APPLICATION_FORM_NOT_FOUND", "Application form not found.");
  const form = relation(result.data.application_form_versions) as Record<string, unknown>;
  if (form.content_text) {
    return { filename: String(form.filename), contentType: `${form.content_type}; charset=utf-8`, bytes: Buffer.from(String(form.content_text), "utf8") };
  }
  const download = await supabaseService().storage.from(applicationBucket()).download(String(form.storage_path));
  if (download.error || !download.data) throw new ApiError(503, "APPLICATION_FORM_UNAVAILABLE", "The application form is temporarily unavailable.");
  return { filename: String(form.filename), contentType: String(form.content_type), bytes: Buffer.from(await download.data.arrayBuffer()) };
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180) || "application-file";
}

function inspectUpload(file: File, bytes: Uint8Array) {
  if (bytes.length < 4 || bytes.length > APPLICATION_MAX_FILE_BYTES) {
    throw new ApiError(400, "INVALID_APPLICATION_FILE_SIZE", "Each file must be between 1 byte and 10 MB.");
  }
  const name = safeFilename(file.name);
  const lower = name.toLowerCase();
  let mimeType: ApplicationFileRecord["mimeType"];
  let extension: string;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    mimeType = "application/pdf";
    extension = "pdf";
    const searchable = Buffer.from(bytes).toString("latin1");
    if (/\/(?:JavaScript|JS|OpenAction|Launch|EmbeddedFile)\b/i.test(searchable)) {
      throw new ApiError(400, "UNSAFE_APPLICATION_FILE", "PDFs with scripts, launch actions, or embedded files are not accepted.");
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = "image/jpeg";
    extension = "jpg";
  } else if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mimeType = "image/png";
    extension = "png";
  } else {
    throw new ApiError(400, "UNSUPPORTED_APPLICATION_FILE", "Upload a PDF, JPEG, or PNG file.");
  }
  const expectedExtensions = mimeType === "application/pdf" ? [".pdf"] : mimeType === "image/png" ? [".png"] : [".jpg", ".jpeg"];
  if (!expectedExtensions.some((suffix) => lower.endsWith(suffix))) {
    throw new ApiError(400, "APPLICATION_FILE_TYPE_MISMATCH", "The filename extension does not match the file content.");
  }
  if (file.type && file.type !== "application/octet-stream" && file.type !== mimeType) {
    throw new ApiError(400, "APPLICATION_FILE_TYPE_MISMATCH", "The declared file type does not match the file content.");
  }
  return { name, mimeType, extension };
}

export async function uploadApplicationFile(identity: ClientIdentity, id: string, file: File) {
  const application = await loadOwnedApplication(identity, id);
  if (application.status !== "draft") throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "Files cannot be changed after submission.");
  if (application.files.length >= 8) throw new ApiError(400, "TOO_MANY_APPLICATION_FILES", "An application can include at most 8 files.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectUpload(file, bytes);
  const uploadedAt = new Date().toISOString();
  const record: ApplicationFileRecord = {
    id: crypto.randomUUID(),
    originalFilename: inspected.name,
    mimeType: inspected.mimeType,
    byteSize: bytes.length,
    scanStatus: "manual_review_required",
    uploadedAt
  };

  if (process.env.DATA_BACKEND !== "supabase") {
    const stored = demoStore().get(id)!;
    stored.files.push(record);
    globalThis.__tingtingClientApplicationFileBytes ??= new Map();
    globalThis.__tingtingClientApplicationFileBytes.set(record.id, bytes);
    stored.audit.push({ action: "application.file_uploaded", createdAt: uploadedAt });
    return structuredClone(record);
  }

  const service = supabaseService();
  const storagePath = `${identity.userId}/${id}/${crypto.randomUUID()}.${inspected.extension}`;
  const uploaded = await service.storage.from(applicationBucket()).upload(storagePath, bytes, {
    contentType: inspected.mimeType,
    upsert: false
  });
  if (uploaded.error) throw new ApiError(503, "APPLICATION_UPLOAD_UNAVAILABLE", "The file could not be stored securely.");
  const inserted = await service.from("client_application_files").insert({
    id: record.id,
    application_id: id,
    storage_path: storagePath,
    original_filename: record.originalFilename,
    mime_type: record.mimeType,
    byte_size: record.byteSize,
    sha256: sha256(bytes),
    scan_status: record.scanStatus,
    uploaded_at: uploadedAt
  });
  if (inserted.error) {
    await service.storage.from(applicationBucket()).remove([storagePath]);
    throw new ApiError(503, "APPLICATION_UPLOAD_UNAVAILABLE", "The file could not be recorded securely.");
  }
  await service.from("client_application_audit_events").insert({
    application_id: id,
    actor_user_id: identity.userId,
    actor_type: "client",
    action: "application.file_uploaded",
    request_context: { fileId: record.id, scanStatus: record.scanStatus }
  });
  return record;
}

export async function submitClientApplication(
  identity: ClientIdentity,
  id: string,
  input: { sharingAuthorization: boolean; screeningConsent: boolean; termsVersion: string; termsSha256: string; formVersion: string; formSha256: string },
  requestContext: { requestId: string; userAgentHash: string },
  options: { notifier?: EmailProvider; recipient?: string | null; appBaseUrl?: string } = {}
) {
  const application = await loadOwnedApplication(identity, id);
  if (application.status !== "draft") throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "This application has already been submitted.");
  if (!input.sharingAuthorization || !input.screeningConsent) {
    throw new ApiError(400, "APPLICATION_CONSENT_REQUIRED", "Both affirmative application authorizations are required.");
  }
  const draftIssues = validateCompleteApplicationDraft(application.draft);
  if (draftIssues.length > 0) {
    throw new ApiError(400, "APPLICATION_DRAFT_INCOMPLETE", `Complete ${draftIssues[0].section.replaceAll("_", " ")} before submitting.`);
  }
  if (application.files.length === 0) throw new ApiError(400, "APPLICATION_FILE_REQUIRED", "Upload at least one supporting document before submitting.");
  if (application.files.some((file) => file.scanStatus === "rejected")) {
    throw new ApiError(400, "APPLICATION_FILE_REJECTED", "Remove or replace the rejected file before submitting.");
  }
  if (input.termsVersion !== application.termsVersion || input.termsSha256 !== application.termsSha256 ||
      input.formVersion !== application.formVersion || input.formSha256 !== application.formSha256) {
    throw new ApiError(409, "APPLICATION_VERSION_CHANGED", "The form or consent changed. Review the current version before submitting.");
  }
  const now = new Date();
  const retainUntil = new Date(now);
  retainUntil.setUTCMonth(retainUntil.getUTCMonth() + APPLICATION_RETENTION_MONTHS);
  const timestamp = now.toISOString();

  let submitted: ClientApplicationRecord;
  if (process.env.DATA_BACKEND !== "supabase") {
    const stored = demoStore().get(id)!;
    stored.status = "submitted";
    stored.submittedAt = timestamp;
    stored.consentedAt = timestamp;
    stored.retainUntil = retainUntil.toISOString();
    stored.consentText = applicationTermsText;
    stored.audit.push({ action: "application.submitted", createdAt: timestamp });
    submitted = structuredClone(stored);
  } else {
    const service = supabaseService();
    const termsResult = await service.from("application_terms_versions")
      .select("displayed_text")
      .eq("version", application.termsVersion)
      .single();
    if (termsResult.error || !termsResult.data) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Consent evidence could not be loaded.");
    const updated = await service.from("client_applications").update({
      status: "submitted",
      submitted_at: timestamp,
      consented_at: timestamp,
      consent_text: termsResult.data.displayed_text,
      consent_terms_version: application.termsVersion,
      consent_terms_sha256: application.termsSha256,
      consent_form_version: application.formVersion,
      consent_form_sha256: application.formSha256,
      consent_request_context: requestContext,
      retain_until: retainUntil.toISOString(),
      updated_at: timestamp
    }).eq("id", id).eq("owner_user_id", identity.userId).eq("status", "draft").select("id").maybeSingle();
    if (updated.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application could not be submitted.");
    if (!updated.data) throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "This application has already been submitted.");
    await service.from("client_application_audit_events").insert({
      application_id: id,
      actor_user_id: identity.userId,
      actor_type: "client",
      action: "application.submitted",
      request_context: requestContext
    });
    submitted = await loadOwnedApplication(identity, id);
  }

  const recipient = options.recipient === undefined
    ? process.env.CONTACT_TO_EMAIL ?? process.env.ALERT_TO_EMAIL ?? process.env.LOCAL_ADMIN_EMAIL
    : options.recipient;
  if (recipient) {
    try {
      const emailMode = resolveEmailProviderMode();
      if (options.notifier || emailMode !== "disabled") {
        const notifier = options.notifier ?? createNotificationProviders({ email: emailMode, sms: "disabled" }).email;
        const notification = renderApplicationSubmittedNotification({
          application: submitted,
          appBaseUrl: options.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000"
        });
        const delivery = await notifier.send({
          to: recipient,
          subject: notification.subject,
          text: notification.text,
          html: notification.html,
          idempotencyKey: `application-submitted-${submitted.id}`
        });
        if (process.env.DATA_BACKEND !== "supabase") {
          demoStore().get(id)?.audit.push({ action: "application.admin_notification_queued", createdAt: new Date().toISOString() });
        } else {
          await supabaseService().from("client_application_audit_events").insert({
            application_id: id,
            actor_type: "system",
            action: "application.admin_notification_queued",
            request_context: { providerMessageId: delivery.providerMessageId, status: delivery.status }
          });
        }
      }
    } catch {
      if (process.env.DATA_BACKEND !== "supabase") {
        demoStore().get(id)?.audit.push({ action: "application.admin_notification_failed", createdAt: new Date().toISOString() });
      } else {
        await supabaseService().from("client_application_audit_events").insert({
          application_id: id,
          actor_type: "system",
          action: "application.admin_notification_failed",
          request_context: { safeErrorCode: "APPLICATION_ADMIN_EMAIL_DELIVERY_FAILED" }
        });
      }
    }
  }

  return submitted;
}

export async function applicationReceipt(identity: ClientIdentity, id: string) {
  const application = await loadOwnedApplication(identity, id);
  if (!application.submittedAt || !application.consentedAt) {
    throw new ApiError(409, "APPLICATION_NOT_SUBMITTED", "A receipt is available after submission.");
  }
  const text = `TING TING XU — APPLICATION SUBMISSION RECEIPT\n\nReference: ${application.id}\nProperty: ${application.propertyTitle}\nAddress: ${application.propertyAddress}\nStatus: ${application.status}\nSubmitted: ${application.submittedAt}\n\nOnline application version: ${application.formVersion}\nApplication SHA-256: ${application.formSha256}\nConsent version: ${application.termsVersion}\nConsent SHA-256: ${application.termsSha256}\nConsent recorded: ${application.consentedAt}\n\nSupporting files:\n${application.files.map((file) => `- ${file.originalFilename} (${file.byteSize} bytes; ${file.scanStatus})`).join("\n")}\n\nCorrection, withdrawal, access, or deletion review: ${PUBLIC_CONTACT_EMAIL}\nRetention review date: ${application.retainUntil ?? "To be determined"}\n`;
  return Buffer.from(text, "utf8");
}

export async function listApplicationsForStaff(admin: AdminIdentity) {
  void admin;
  if (process.env.DATA_BACKEND !== "supabase") return [...demoStore().values()].map((item) => structuredClone(item));
  const result = await supabaseService().from("client_applications")
    .select(APPLICATION_SELECT)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false, nullsFirst: false });
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Applications could not be loaded.");
  return (result.data ?? []).map((row) => mapApplication(row as unknown as Record<string, unknown>));
}

export async function getApplicationFileForStaff(admin: AdminIdentity, fileId: string) {
  void admin;
  if (process.env.DATA_BACKEND !== "supabase") {
    const application = [...demoStore().values()].find((item) => item.files.some((file) => file.id === fileId));
    const file = application?.files.find((item) => item.id === fileId);
    const bytes = globalThis.__tingtingClientApplicationFileBytes?.get(fileId);
    if (!application || !file || !bytes) throw new ApiError(404, "APPLICATION_FILE_NOT_FOUND", "Application file not found.");
    if (file.scanStatus === "rejected") throw new ApiError(409, "APPLICATION_FILE_REJECTED", "Rejected files cannot be downloaded.");
    return { file, bytes: Buffer.from(bytes) };
  }
  const service = supabaseService();
  const result = await service.from("client_application_files")
    .select("id,original_filename,mime_type,byte_size,scan_status,uploaded_at,storage_path,application_id")
    .eq("id", fileId)
    .is("deleted_at", null)
    .maybeSingle();
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application file could not be loaded.");
  if (!result.data) throw new ApiError(404, "APPLICATION_FILE_NOT_FOUND", "Application file not found.");
  if (result.data.scan_status === "rejected") throw new ApiError(409, "APPLICATION_FILE_REJECTED", "Rejected files cannot be downloaded.");
  const download = await service.storage.from(applicationBucket()).download(result.data.storage_path);
  if (download.error || !download.data) throw new ApiError(503, "APPLICATION_FILE_UNAVAILABLE", "The private application file is temporarily unavailable.");
  return {
    file: {
      id: result.data.id,
      originalFilename: result.data.original_filename,
      mimeType: result.data.mime_type as ApplicationFileRecord["mimeType"],
      byteSize: result.data.byte_size,
      scanStatus: result.data.scan_status as ApplicationFileRecord["scanStatus"],
      uploadedAt: result.data.uploaded_at
    },
    bytes: Buffer.from(await download.data.arrayBuffer())
  };
}

export async function reviewApplicationFile(
  admin: AdminIdentity,
  fileId: string,
  decision: "cleared" | "rejected"
) {
  const now = new Date().toISOString();
  if (process.env.DATA_BACKEND !== "supabase") {
    const application = [...demoStore().values()].find((item) => item.files.some((file) => file.id === fileId));
    const file = application?.files.find((item) => item.id === fileId);
    if (!application || !file) throw new ApiError(404, "APPLICATION_FILE_NOT_FOUND", "Application file not found.");
    if (file.scanStatus !== "manual_review_required" && file.scanStatus !== "screening_pending") {
      throw new ApiError(409, "APPLICATION_FILE_ALREADY_REVIEWED", "This file already has a screening decision.");
    }
    file.scanStatus = decision;
    application.audit.push({ action: `application.file_${decision}`, createdAt: now });
    return structuredClone(file);
  }
  const service = supabaseService();
  const updated = await service.from("client_application_files")
    .update({ scan_status: decision, reviewed_at: now })
    .eq("id", fileId)
    .in("scan_status", ["manual_review_required", "screening_pending"])
    .select("id,application_id,original_filename,mime_type,byte_size,scan_status,uploaded_at")
    .maybeSingle();
  if (updated.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The screening decision could not be saved.");
  if (!updated.data) throw new ApiError(409, "APPLICATION_FILE_ALREADY_REVIEWED", "This file is missing or already reviewed.");
  await service.from("client_application_audit_events").insert({
    application_id: updated.data.application_id,
    actor_user_id: admin.userId,
    actor_type: "staff",
    action: `application.file_${decision}`,
    request_context: { fileId }
  });
  return {
    id: updated.data.id,
    originalFilename: updated.data.original_filename,
    mimeType: updated.data.mime_type as ApplicationFileRecord["mimeType"],
    byteSize: updated.data.byte_size,
    scanStatus: updated.data.scan_status as ApplicationFileRecord["scanStatus"],
    uploadedAt: updated.data.uploaded_at
  };
}

const staffTransitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: [], submitted: ["received", "withdrawn"], received: ["needs_information", "under_review", "withdrawn"],
  needs_information: ["received", "withdrawn"], under_review: ["needs_information", "approved", "declined", "withdrawn"],
  approved: [], declined: [], withdrawn: []
};

export async function updateApplicationStatus(admin: AdminIdentity, id: string, next: ApplicationStatus) {
  let current: ClientApplicationRecord | undefined;
  if (process.env.DATA_BACKEND !== "supabase") current = demoStore().get(id);
  else {
    const result = await supabaseService().from("client_applications").select(APPLICATION_SELECT).eq("id", id).maybeSingle();
    if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application could not be loaded.");
    if (result.data) current = mapApplication(result.data as unknown as Record<string, unknown>);
  }
  if (!current) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  if (!staffTransitions[current.status].includes(next)) throw new ApiError(409, "INVALID_APPLICATION_STATUS", `Cannot move ${current.status} to ${next}.`);
  if (["under_review", "approved", "declined"].includes(next) && current.files.some((file) => file.scanStatus !== "cleared")) {
    throw new ApiError(409, "APPLICATION_FILES_NOT_CLEARED", "All application files must pass the approved screening process before review.");
  }
  const now = new Date().toISOString();
  if (process.env.DATA_BACKEND !== "supabase") {
    const stored = demoStore().get(id)!;
    stored.status = next;
    stored.audit.push({ action: `application.status.${next}`, createdAt: now });
    return structuredClone(stored);
  }
  const service = supabaseService();
  const updated = await service.from("client_applications").update({ status: next, updated_at: now })
    .eq("id", id).eq("status", current.status).select("id").maybeSingle();
  if (updated.error || !updated.data) throw new ApiError(409, "APPLICATION_STATUS_CHANGED", "The application status changed. Reload and try again.");
  await service.from("client_application_audit_events").insert({ application_id: id, actor_user_id: admin.userId, actor_type: "staff", action: `application.status.${next}` });
  return { ...current, status: next };
}

export function resetDemoApplicationsForTests() {
  globalThis.__tingtingClientApplications = undefined;
  globalThis.__tingtingClientApplicationFileBytes = undefined;
}
