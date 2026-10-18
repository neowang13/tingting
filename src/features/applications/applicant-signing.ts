import { invitationEmail, registerMemoryInvitationEmail, sendCoApplicantInvitationNow } from "@/features/applications/invitation-email";
import { assertCreditReportVoluntary } from "@/features/applications/credit-report-consent";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import { hasUnsafePdfFeatures } from "@/lib/pdf-safety";
import { createGuestBearerToken, hashGuestToken, invitationBearerToken } from "@/lib/application-guest-auth";
import {
  APPLICATION_DOCUMENT_LABELS,
  APPLICATION_MAX_FILE_BYTES,
  CO_APPLICANT_REQUIRED_DOCUMENT_TYPES,
  APPLICATION_UPLOAD_BUCKET,
  applicationDocumentRequirementSatisfied,
  coApplicantSlots,
  applicationRosterComplete,
  type ApplicationApplicantRecord,
  type ApplicationDocumentType,
  type ApplicationFileRecord,
  type ClientIdentity,
} from "@/features/applications/contracts";
import {
  applicantSignatureSchema,
  applicationDraftSchema,
  coApplicantInvitationSchema,
  validateCompleteApplicationDraft,
  type ApplicantSignatureInput,
  type ApplicationDraft,
  type CoApplicantInvitationInput,
} from "@/features/applications/schemas";

import type { EmailProvider } from "@/features/notifications/providers/types";
import type { ApplicantSignatureEvidence } from "@/features/applications/notification";

export interface ApplicationRequestContext {
  requestId: string;
  userAgentHash: string;
  ipHash?: string;
  submissionNotification?: { recipient: string | null; appBaseUrl: string };
}

interface MemoryApplicant extends ApplicationApplicantRecord {
  applicationId: string;
  ownerUserId: string | null;
  draft: ApplicationDraft;
  files: ApplicationFileRecord[];
  formVersion: string;
  formSha256: string;
  termsVersion: string;
  termsSha256: string;
  termsText: string;
  propertyTitle: string;
  propertyAddress: string;
  revokedAt?: string | null;
}

interface MemoryInvitation {
  id?: string;
  applicantId: string;
  tokenHash: string;
  status: "active" | "used" | "revoked";
  expiresAt: string;
}

interface MemorySession {
  applicantId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface MemorySignature {
  applicantId: string;
  signedAt: string;
  evidenceHash: string;
  evidence?: ApplicantSignatureEvidence;
}

declare global {
  var __tingtingApplicationApplicants: Map<string, MemoryApplicant> | undefined;
  var __tingtingApplicationInvitations: Map<string, MemoryInvitation> | undefined;
  var __tingtingApplicationGuestSessions: Map<string, MemorySession> | undefined;
  var __tingtingApplicationSignatures: Map<string, MemorySignature> | undefined;
  var __tingtingApplicationCreditRequests: Map<string, { applicantId: string; status: "pending"; idempotencyKey: string }> | undefined;
  var __tingtingGuestApplicationFileBytes: Map<string, Uint8Array> | undefined;
}

function memoryStores() {
  globalThis.__tingtingApplicationApplicants ??= new Map();
  globalThis.__tingtingApplicationInvitations ??= new Map();
  globalThis.__tingtingApplicationGuestSessions ??= new Map();
  globalThis.__tingtingApplicationSignatures ??= new Map();
  globalThis.__tingtingApplicationCreditRequests ??= new Map();
  globalThis.__tingtingGuestApplicationFileBytes ??= new Map();
  return {
    applicants: globalThis.__tingtingApplicationApplicants,
    invitations: globalThis.__tingtingApplicationInvitations,
    sessions: globalThis.__tingtingApplicationGuestSessions,
    signatures: globalThis.__tingtingApplicationSignatures,
    creditRequests: globalThis.__tingtingApplicationCreditRequests,
    fileBytes: globalThis.__tingtingGuestApplicationFileBytes,
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-CA");
}

function draftLegalName(draft: ApplicationDraft) {
  return `${draft.personal.legalFirstName} ${draft.personal.legalLastName}`.trim().replace(/\s+/g, " ");
}

function splitLegalName(value: string) {
  const parts = value.trim().replace(/\s+/g, " ").split(" ");
  return parts.length === 1
    ? { legalFirstName: parts[0], legalLastName: "" }
    : { legalFirstName: parts.slice(0, -1).join(" "), legalLastName: parts.at(-1)! };
}

function signatureFileSnapshot(files: ApplicationFileRecord[]) {
  return files.map((file) => ({
    id: file.id,
    documentType: file.documentType,
    byteSize: file.byteSize,
    scanStatus: file.scanStatus,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function publicApplicant(applicant: MemoryApplicant): ApplicationApplicantRecord {
  const expired = applicant.role === "co_applicant"
    && applicant.status === "invited"
    && applicant.invitationExpiresAt
    && new Date(applicant.invitationExpiresAt).getTime() <= Date.now();
  return {
    id: applicant.id,
    userId: applicant.ownerUserId,
    invitationDeliveryStatus: applicant.invitationDeliveryStatus,
    creditReportVoluntaryAt: applicant.creditReportVoluntaryAt,
    creditReportConsentVersion: applicant.creditReportConsentVersion,
    role: applicant.role,
    legalName: applicant.legalName,
    email: applicant.email,
    status: expired ? "expired" : applicant.status,
    invitationExpiresAt: applicant.invitationExpiresAt,
    draftUpdatedAt: applicant.draftUpdatedAt,
    signedAt: applicant.signedAt,
  };
}

export function registerMemoryPrimaryApplicant(input: {
  applicationId: string;
  ownerUserId: string;
  legalName: string;
  email: string;
  draft: ApplicationDraft;
  formVersion: string;
  formSha256: string;
  termsVersion: string;
  termsSha256: string;
  termsText: string;
  propertyTitle: string;
  propertyAddress: string;
}) {
  if (process.env.DATA_BACKEND === "supabase") return;
  const stores = memoryStores();
  const existing = [...stores.applicants.values()].find((item) => item.applicationId === input.applicationId && item.role === "primary");
  if (existing) {
    existing.draft = structuredClone(input.draft);
    existing.legalName = input.legalName || existing.legalName;
    existing.email = input.email || existing.email;
    return;
  }
  const id = crypto.randomUUID();
  stores.applicants.set(id, {
    id,
    applicationId: input.applicationId,
    ownerUserId: input.ownerUserId,
    role: "primary",
    legalName: input.legalName,
    email: input.email,
    status: "in_progress",
    invitationExpiresAt: null,
    draftUpdatedAt: null,
    signedAt: null,
    draft: structuredClone(input.draft),
    files: [],
    formVersion: input.formVersion,
    formSha256: input.formSha256,
    termsVersion: input.termsVersion,
    termsSha256: input.termsSha256,
    termsText: input.termsText,
    propertyTitle: input.propertyTitle,
    propertyAddress: input.propertyAddress,
  });
}

export function resetMemoryApplicantSigningForTests() {
  globalThis.__tingtingApplicationApplicants = new Map();
  globalThis.__tingtingApplicationInvitations = new Map();
  globalThis.__tingtingApplicationGuestSessions = new Map();
  globalThis.__tingtingApplicationSignatures = new Map();
  globalThis.__tingtingApplicationCreditRequests = new Map();
  globalThis.__tingtingGuestApplicationFileBytes = new Map();
}

export function getMemoryApplicationApplicants(applicationId: string) {
  return [...memoryStores().applicants.values()]
    .filter((item) => item.applicationId === applicationId)
    .map(publicApplicant);
}

export function getMemoryApplicationNotificationApplicants(applicationId: string) {
  return [...memoryStores().applicants.values()]
    .filter((item) => item.applicationId === applicationId && item.status !== "revoked")
    .map((item) => ({
      ...publicApplicant(item),
      draft: structuredClone(item.draft),
      files: structuredClone(item.files),
      signature: structuredClone(memoryStores().signatures.get(item.id)?.evidence ?? null)
    }));
}

export function syncMemoryPrimaryApplicantFiles(applicationId: string, files: ApplicationFileRecord[]) {
  const primary = [...memoryStores().applicants.values()].find((item) => item.applicationId === applicationId && item.role === "primary");
  if (primary) primary.files = structuredClone(files);
}

export function getMemoryCreditCheckRequestsForTests(applicationId: string) {
  const applicantIds = new Set([...memoryStores().applicants.values()].filter((item) => item.applicationId === applicationId).map((item) => item.id));
  return [...memoryStores().creditRequests.values()].filter((item) => applicantIds.has(item.applicantId)).map((item) => ({ ...item }));
}

export function getMemoryAllApplicantFilesForStaff(applicationId: string) {
  return [...memoryStores().applicants.values()].filter((item) => item.applicationId === applicationId).flatMap((item) => structuredClone(item.files));
}

export function getMemoryGuestFileForStaff(fileId: string) {
  for (const applicant of memoryStores().applicants.values()) {
    const file = applicant.files.find((item) => item.id === fileId);
    const bytes = memoryStores().fileBytes.get(fileId);
    if (file && bytes) return { file: structuredClone(file), bytes: Buffer.from(bytes) };
  }
  return null;
}

export function reviewMemoryApplicantFileForStaff(fileId: string, decision: "cleared" | "rejected") {
  for (const applicant of memoryStores().applicants.values()) {
    const file = applicant.files.find((item) => item.id === fileId);
    if (file) {
      if (file.scanStatus !== "manual_review_required" && file.scanStatus !== "screening_pending") throw new ApiError(409, "APPLICATION_FILE_ALREADY_REVIEWED", "This file already has a screening decision.");
      file.scanStatus = decision;
      return structuredClone(file);
    }
  }
  return null;
}

async function assertMemoryOwner(identity: ClientIdentity, applicationId: string) {
  const primary = [...memoryStores().applicants.values()].find((item) => item.applicationId === applicationId && item.role === "primary");
  if (!primary || primary.ownerUserId !== identity.userId) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  return primary;
}

async function assertSupabaseOwner(identity: ClientIdentity, applicationId: string) {
  const result = await serviceClient().from("client_applications").select("id,status,deleted_at,draft_payload").eq("id", applicationId)
    .eq("owner_user_id", identity.userId).is("deleted_at", null).maybeSingle();
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application could not be loaded.");
  if (!result.data) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  return result.data;
}

function assertInvitationCapacity(adultCount: number | null, activeCount: number) {
  const slots = coApplicantSlots(adultCount);
  if (slots === 0) throw new ApiError(409, "APPLICATION_ADULT_COUNT_REQUIRED", "Save at least two adults in Household & tenancy before inviting another applicant.");
  if (activeCount >= slots) throw new ApiError(409, "APPLICATION_APPLICANT_CAPACITY", "All additional adult places already have an applicant. Review the adult count or revoke an unused invitation.");
}

function assertCompleteMemoryRoster(applicationId: string) {
  const all = [...memoryStores().applicants.values()].filter(applicant => applicant.applicationId === applicationId);
  const primary = all.find(applicant => applicant.role === "primary")!;
  if (!applicationRosterComplete(primary.draft.tenancy.adultCount, all)) throw new ApiError(409, "APPLICATION_APPLICANT_COUNT_MISMATCH", "Invite every additional adult before anyone signs. The adult count must match the applicant list.");
}

function mapApplicantRow(row: Record<string, unknown>): ApplicationApplicantRecord {
  const invitationExpiresAt = row.invitation_expires_at ? String(row.invitation_expires_at) : null;
  const status = row.status === "invited" && invitationExpiresAt && new Date(invitationExpiresAt).getTime() <= Date.now()
    ? "expired"
    : row.status;
  return {
    id: String(row.id),
    userId: row.owner_user_id ? String(row.owner_user_id) : null,
    invitationDeliveryStatus: row.invitation_delivery_status as ApplicationApplicantRecord["invitationDeliveryStatus"],
    creditReportVoluntaryAt: row.credit_report_voluntary_at ? String(row.credit_report_voluntary_at) : null,
    creditReportConsentVersion: row.credit_report_consent_version ? String(row.credit_report_consent_version) : null,
    role: row.role as ApplicationApplicantRecord["role"],
    legalName: String(row.legal_name),
    email: String(row.email),
    status: status as ApplicationApplicantRecord["status"],
    invitationExpiresAt,
    draftUpdatedAt: row.draft_updated_at ? String(row.draft_updated_at) : null,
    signedAt: row.signed_at ? String(row.signed_at) : null,
  };
}

export async function getApplicationApplicants(identity: ClientIdentity, applicationId: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    await assertMemoryOwner(identity, applicationId);
    return [...memoryStores().applicants.values()].filter((item) => item.applicationId === applicationId).map(publicApplicant);
  }
  await assertSupabaseOwner(identity, applicationId);
  const result = await serviceClient().from("application_applicants")
    .select("id,role,owner_user_id,legal_name,email,status,invitation_expires_at,draft_updated_at,signed_at,invitation_delivery_status,credit_report_voluntary_at,credit_report_consent_version")
    .eq("application_id", applicationId).order("created_at");
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Applicants could not be loaded.");
  return (result.data ?? []).map((row) => mapApplicantRow(row));
}

function invitationExpiry() {
  return new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
}

function invitationUrl(token: string) {
  return new URL(`/client/invitations#token=${encodeURIComponent(token)}`, process.env.APP_BASE_URL ?? "http://localhost:3000").toString();
}

async function memoryInvitationDelivery(applicant: MemoryApplicant, invitationId: string, token: string, expiresAt: string, notifier?: EmailProvider) {
  const tokenHash = hashGuestToken(token);
  const invitation: MemoryInvitation = { id: invitationId, applicantId: applicant.id, tokenHash, status: "active", expiresAt };
  memoryStores().invitations.set(tokenHash, invitation);
  applicant.invitationDeliveryStatus = "scheduled";
  registerMemoryInvitationEmail(invitationId, {
    message: invitationEmail({ email: applicant.email, legalName: applicant.legalName, propertyTitle: applicant.propertyTitle, token, invitationId }),
    active: () => invitation.status === "active" && Date.parse(expiresAt) > Date.now() && !["signed", "revoked"].includes(applicant.status),
    onStatus: status => { applicant.invitationDeliveryStatus = status; }
  });
  await sendCoApplicantInvitationNow({ invitationId, applicantId: applicant.id, applicationId: applicant.applicationId, email: applicant.email, notifier });
}

export async function createCoApplicantInvitation(identity: ClientIdentity, applicationId: string, rawInput: CoApplicantInvitationInput,
  context: ApplicationRequestContext, options: { notifier?: EmailProvider } = {}) {
  const input = coApplicantInvitationSchema.parse(rawInput);
  if (input.email.toLowerCase() === identity.email.toLowerCase()) throw new ApiError(409, "APPLICATION_APPLICANT_EXISTS", "Use the other applicant's own email address.");
  const invitationId = crypto.randomUUID();
  const token = invitationBearerToken(invitationId);
  const expiresAt = invitationExpiry();
  if (process.env.DATA_BACKEND !== "supabase") {
    const primary = await assertMemoryOwner(identity, applicationId);
    await assertApplicationSignaturesUnlocked(applicationId);
    const active = [...memoryStores().applicants.values()].filter(a => a.applicationId === applicationId && a.status !== "revoked");
    assertInvitationCapacity(primary.draft.tenancy.adultCount, active.filter(a => a.role === "co_applicant").length);
    if (active.some(a => a.email.toLowerCase() === input.email.toLowerCase())) throw new ApiError(409, "APPLICATION_APPLICANT_EXISTS", "An active applicant already uses this email address.");
    const applicant: MemoryApplicant = { ...structuredClone(primary), id: crypto.randomUUID(), role: "co_applicant", ownerUserId: null,
      legalName: input.legalName, email: input.email.toLowerCase(), status: "invited", invitationExpiresAt: expiresAt, draftUpdatedAt: null, signedAt: null,
      creditReportVoluntaryAt: null, creditReportConsentVersion: null,
      draft: applicationDraftSchema.parse({ personal: { ...splitLegalName(input.legalName), email: input.email } }), files: [] };
    memoryStores().applicants.set(applicant.id, applicant);
    await memoryInvitationDelivery(applicant, invitationId, token, expiresAt, options.notifier);
    return { applicant: publicApplicant(applicant), invitationId, invitationToken: token, invitationUrl: invitationUrl(token) };
  }
  const owned = await assertSupabaseOwner(identity, applicationId);
  const existing = await getApplicationApplicants(identity, applicationId);
  assertInvitationCapacity(applicationDraftSchema.parse(owned.draft_payload).tenancy.adultCount, existing.filter(a => a.role === "co_applicant" && a.status !== "revoked").length);
  const service = serviceClient();
  const id = crypto.randomUUID();
  const created = await service.rpc("create_linked_applicant_invitation", {
    p_application_id: applicationId, p_owner_user_id: identity.userId, p_applicant_id: id, p_invitation_id: invitationId,
    p_legal_name: input.legalName, p_email: input.email.toLowerCase(), p_token_sha256: hashGuestToken(token), p_expires_at: expiresAt,
    p_draft: applicationDraftSchema.parse({ personal: { ...splitLegalName(input.legalName), email: input.email } }), p_request_context: context
  });
  if (created.error?.code === "23505") throw new ApiError(409, "APPLICATION_APPLICANT_EXISTS", "An active applicant already uses this email address.");
  if (created.error?.message.includes("application_signatures_locked")) throw new ApiError(409, "APPLICATION_SIGNATURES_LOCKED", "Applicants cannot be changed after signing has started.");
  if (created.error?.message.includes("co_applicant_capacity_reached") || created.error?.message.includes("tenancy_adult_count_required")) throw new ApiError(409, "APPLICATION_APPLICANT_CAPACITY", "Save the adult count and review the existing applicants before inviting another adult.");
  if (created.error) throw new ApiError(503, "APPLICATION_INVITATION_CREATE_FAILED", "The co-applicant invitation could not be created. Try again.");
  const status = await sendCoApplicantInvitationNow({ invitationId, applicationId, applicantId: id, email: input.email.toLowerCase(), notifier: options.notifier });
  return { applicant: { ...(await getApplicationApplicants(identity, applicationId)).find(a => a.id === id)!, invitationDeliveryStatus: status }, invitationId, invitationToken: token, invitationUrl: invitationUrl(token) };
}

export async function resendCoApplicantInvitation(identity: ClientIdentity, applicationId: string, applicantId: string, context: ApplicationRequestContext, options: { notifier?: EmailProvider } = {}) {
  const invitationId = crypto.randomUUID();
  const token = invitationBearerToken(invitationId);
  const expiresAt = invitationExpiry();
  if (process.env.DATA_BACKEND !== "supabase") {
    const owned = await assertMemoryOwner(identity, applicationId);
    if (coApplicantSlots(owned.draft.tenancy.adultCount) === 0) throw new ApiError(409, "APPLICATION_ADULT_COUNT_REQUIRED", "Set the household adult count to at least two before sending invitations.");
    const stores = memoryStores();
    const applicant = stores.applicants.get(applicantId);
    if (!applicant || applicant.applicationId !== applicationId || applicant.role !== "co_applicant") throw new ApiError(404, "APPLICATION_APPLICANT_NOT_FOUND", "Co-applicant not found.");
    if (applicant.status === "revoked" || applicant.status === "signed") throw new ApiError(409, "APPLICATION_APPLICANT_LOCKED", "This applicant cannot be reinvited.");
    for (const invite of stores.invitations.values()) if (invite.applicantId === applicantId && invite.status === "active") invite.status = "revoked";
    for (const session of stores.sessions.values()) if (session.applicantId === applicantId) session.revokedAt = new Date().toISOString();
    applicant.invitationExpiresAt = expiresAt;
    await memoryInvitationDelivery(applicant, invitationId, token, expiresAt, options.notifier);
    return { applicant: publicApplicant(applicant), invitationId, invitationToken: token, invitationUrl: invitationUrl(token) };
  }
  const owned = await assertSupabaseOwner(identity, applicationId);
  if (coApplicantSlots(applicationDraftSchema.parse(owned.draft_payload).tenancy.adultCount) === 0) throw new ApiError(409, "APPLICATION_ADULT_COUNT_REQUIRED", "Set the household adult count to at least two before sending invitations.");
  const result = await serviceClient().rpc("resend_linked_applicant_invitation", { p_application_id: applicationId, p_owner_user_id: identity.userId,
    p_applicant_id: applicantId, p_invitation_id: invitationId, p_token_sha256: hashGuestToken(token), p_expires_at: expiresAt, p_request_context: context });
  if (result.error) throw new ApiError(409, "APPLICATION_INVITATION_RESEND_FAILED", "The invitation cannot be resent. Refresh the applicant status and try again.");
  const applicant = (await getApplicationApplicants(identity, applicationId)).find(a => a.id === applicantId)!;
  const status = await sendCoApplicantInvitationNow({ invitationId, applicationId, applicantId, email: applicant.email, notifier: options.notifier });
  return { applicant: { ...applicant, invitationDeliveryStatus: status }, invitationId, invitationToken: token, invitationUrl: invitationUrl(token) };
}

export async function revokeCoApplicant(identity: ClientIdentity, applicationId: string, applicantId: string, context: ApplicationRequestContext) {
  if (process.env.DATA_BACKEND !== "supabase") {
    await assertMemoryOwner(identity, applicationId);
    const stores = memoryStores();
    if ([...stores.applicants.values()].some((item) => item.applicationId === applicationId && stores.signatures.has(item.id))) {
      throw new ApiError(409, "APPLICATION_SIGNATURES_LOCKED", "Applicants cannot be changed after signing has started.");
    }
    const applicant = stores.applicants.get(applicantId);
    if (!applicant || applicant.applicationId !== applicationId || applicant.role !== "co_applicant") throw new ApiError(404, "APPLICATION_APPLICANT_NOT_FOUND", "Co-applicant not found.");
    if (applicant.status === "signed") throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "A signed applicant cannot be revoked.");
    applicant.status = "revoked"; applicant.revokedAt = new Date().toISOString();
    for (const invitation of stores.invitations.values()) if (invitation.applicantId === applicantId && invitation.status === "active") invitation.status = "revoked";
    for (const session of stores.sessions.values()) if (session.applicantId === applicantId) session.revokedAt = new Date().toISOString();
    return publicApplicant(applicant);
  }
  await assertSupabaseOwner(identity, applicationId);
  const service = serviceClient();
  const signatureCount = await service.from("application_applicant_signatures").select("id", { count: "exact", head: true }).eq("application_id", applicationId);
  if (signatureCount.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Signature status could not be checked.");
  if ((signatureCount.count ?? 0) > 0) throw new ApiError(409, "APPLICATION_SIGNATURES_LOCKED", "Applicants cannot be changed after signing has started.");
  const now = new Date().toISOString();
  const updated = await service.from("application_applicants").update({ status: "revoked", revoked_at: now, updated_at: now })
    .eq("id", applicantId).eq("application_id", applicationId).eq("role", "co_applicant").neq("status", "signed")
    .select("id,role,owner_user_id,legal_name,email,status,invitation_expires_at,draft_updated_at,signed_at,invitation_delivery_status,credit_report_voluntary_at,credit_report_consent_version").maybeSingle();
  if (updated.error || !updated.data) throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "The co-applicant is missing or already signed.");
  await Promise.all([
    service.from("application_applicant_invitations").update({ status: "revoked", revoked_at: now }).eq("applicant_id", applicantId).eq("status", "active"),
    service.from("application_guest_sessions").update({ revoked_at: now }).eq("applicant_id", applicantId).is("revoked_at", null),
    service.from("client_application_audit_events").insert({ application_id: applicationId, actor_user_id: identity.userId, actor_type: "client", action: "application.co_applicant_revoked", request_context: { ...context, applicantId } }),
  ]);
  return mapApplicantRow(updated.data);
}

export async function exchangeCoApplicantInvitation(invitationToken: string, context: ApplicationRequestContext, identity: ClientIdentity) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(invitationToken)) throw new ApiError(404, "APPLICATION_INVITATION_INVALID", "This invitation is invalid.");
  return exchangeInvitationHash(hashGuestToken(invitationToken), context, identity);
}

async function exchangeInvitationHash(tokenHash: string, context: ApplicationRequestContext, identity: ClientIdentity) {
  const sessionToken = createGuestBearerToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  if (process.env.DATA_BACKEND !== "supabase") {
    const stores = memoryStores();
    const invitation = stores.invitations.get(tokenHash);
    if (!invitation) throw new ApiError(404, "APPLICATION_INVITATION_INVALID", "This invitation is invalid.");
    const applicant = stores.applicants.get(invitation.applicantId)!;
    if (invitation.status === "revoked" || applicant.status === "revoked") throw new ApiError(410, "APPLICATION_INVITATION_REVOKED", "This invitation has been revoked.");
    if (invitation.status === "used") throw new ApiError(409, "APPLICATION_INVITATION_USED", "This invitation has already been used.");
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) throw new ApiError(410, "APPLICATION_INVITATION_EXPIRED", "This invitation has expired.");
    if (applicant.email.toLowerCase() !== identity.email.toLowerCase() || (applicant.ownerUserId && applicant.ownerUserId !== identity.userId)) throw new ApiError(403, "APPLICATION_INVITATION_ACCOUNT_MISMATCH", "Sign in using the email address this invitation was sent to.");
    applicant.ownerUserId = identity.userId;
    invitation.status = "used";
    if (applicant.status === "invited") applicant.status = "in_progress";
    stores.sessions.set(hashGuestToken(sessionToken), { applicantId: applicant.id, tokenHash: hashGuestToken(sessionToken), expiresAt, revokedAt: null });
    return { sessionToken, expiresAt, applicant: publicApplicant(applicant) };
  }
  const result = await serviceClient().rpc("claim_linked_applicant_invitation", {
    p_user_id: identity.userId,
    p_invitation_sha256: tokenHash, p_session_sha256: hashGuestToken(sessionToken), p_session_expires_at: expiresAt, p_request_context: context,
  });
  if (result.error) {
    if (result.error.message.includes("account_mismatch")) throw new ApiError(403, "APPLICATION_INVITATION_ACCOUNT_MISMATCH", "Sign in using the verified email address this invitation was sent to.");
    if (result.error.message.includes("invitation_used")) throw new ApiError(409, "APPLICATION_INVITATION_USED", "This invitation has already been used.");
    if (result.error.message.includes("invitation_revoked")) throw new ApiError(410, "APPLICATION_INVITATION_REVOKED", "This invitation has been revoked.");
    if (result.error.message.includes("invitation_expired")) throw new ApiError(410, "APPLICATION_INVITATION_EXPIRED", "This invitation has expired.");
    if (result.error.message.includes("invitation_not_found")) throw new ApiError(404, "APPLICATION_INVITATION_INVALID", "This invitation is invalid.");
    throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The invitation could not be opened.");
  }
  return { sessionToken, expiresAt, applicant: { id: String(result.data) } };
}

export async function acceptCoApplicantInvitationById(invitationId: string, context: ApplicationRequestContext, identity: ClientIdentity) {
  if (process.env.DATA_BACKEND !== "supabase") {
    const invitation = [...memoryStores().invitations.values()].find(i => i.id === invitationId);
    if (!invitation) throw new ApiError(404, "APPLICATION_INVITATION_INVALID", "Invitation not found.");
    return exchangeInvitationHash(invitation.tokenHash, context, identity);
  }
  const result = await serviceClient().from("application_applicant_invitations").select("token_sha256").eq("id", invitationId).maybeSingle();
  if (result.error || !result.data) throw new ApiError(404, "APPLICATION_INVITATION_INVALID", "Invitation not found.");
  return exchangeInvitationHash(result.data.token_sha256, context, identity);
}

export async function assertGuestAccount(sessionToken: string, identity: ClientIdentity) {
  if (process.env.DATA_BACKEND !== "supabase") {
    const applicant = await memoryGuest(sessionToken);
    if (applicant.ownerUserId !== identity.userId) throw new ApiError(403, "APPLICATION_INVITATION_ACCOUNT_MISMATCH", "This application belongs to another account.");
    return;
  }
  const session = await supabaseGuest(sessionToken);
  const result = await serviceClient().from("application_applicants").select("id").eq("id", session.applicantId).eq("owner_user_id", identity.userId).eq("role", "co_applicant").maybeSingle();
  if (result.error || !result.data) throw new ApiError(403, "APPLICATION_INVITATION_ACCOUNT_MISMATCH", "This application belongs to another account.");
}

export async function resumeCoApplicantApplication(identity: ClientIdentity, applicantId: string) {
  const sessionToken = createGuestBearerToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60_000).toISOString();
  if (process.env.DATA_BACKEND !== "supabase") {
    const applicant = memoryStores().applicants.get(applicantId);
    if (!applicant || applicant.role !== "co_applicant" || applicant.ownerUserId !== identity.userId || applicant.status === "revoked") throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
    memoryStores().sessions.set(hashGuestToken(sessionToken), { applicantId, tokenHash: hashGuestToken(sessionToken), expiresAt, revokedAt: null });
  } else {
    const result = await serviceClient().rpc("resume_linked_applicant_session", { p_user_id: identity.userId, p_applicant_id: applicantId, p_session_sha256: hashGuestToken(sessionToken), p_expires_at: expiresAt });
    if (result.error) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  }
  return { sessionToken, expiresAt };
}

export async function listLinkedApplicantMemberships(identity: ClientIdentity) {
  if (process.env.DATA_BACKEND !== "supabase") return [...memoryStores().applicants.values()].filter(a => a.role === "co_applicant" && a.ownerUserId === identity.userId && a.status !== "revoked").map(a => ({ applicationId: a.applicationId, applicantId: a.id }));
  const result = await serviceClient().from("application_applicants").select("id,application_id").eq("owner_user_id", identity.userId).eq("role", "co_applicant").neq("status", "revoked");
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Linked applications could not be loaded.");
  return (result.data ?? []).map(a => ({ applicationId: String(a.application_id), applicantId: String(a.id) }));
}

async function memoryGuest(sessionToken: string) {
  const session = memoryStores().sessions.get(hashGuestToken(sessionToken));
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired.");
  const applicant = memoryStores().applicants.get(session.applicantId);
  if (!applicant || applicant.status === "revoked") throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired.");
  return applicant;
}

async function supabaseGuest(sessionToken: string) {
  const result = await serviceClient().from("application_guest_sessions")
    .select("id,applicant_id,expires_at,revoked_at,application_applicants!inner(id,status,application_id)")
    .eq("token_sha256", hashGuestToken(sessionToken)).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (result.error || !result.data) throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired.");
  const applicant = Array.isArray(result.data.application_applicants) ? result.data.application_applicants[0] : result.data.application_applicants;
  if (!applicant || applicant.status === "revoked") throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired.");
  await serviceClient().from("application_guest_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", result.data.id);
  return { applicantId: result.data.applicant_id, applicationId: applicant.application_id };
}

export async function getGuestApplication(sessionToken: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    const applicant = await memoryGuest(sessionToken);
    return {
      application: { id: applicant.applicationId, propertyTitle: applicant.propertyTitle, propertyAddress: applicant.propertyAddress, formVersion: applicant.formVersion, formSha256: applicant.formSha256, termsVersion: applicant.termsVersion, termsSha256: applicant.termsSha256, termsText: applicant.termsText },
      applicant: { ...publicApplicant(applicant), draft: { ...structuredClone(applicant.draft), tenancy: structuredClone([...memoryStores().applicants.values()].find(a => a.applicationId === applicant.applicationId && a.role === "primary")!.draft.tenancy) }, files: structuredClone(applicant.files) },
    };
  }
  const guest = await supabaseGuest(sessionToken);
  const result = await serviceClient().from("application_applicants").select(`
    id,role,owner_user_id,legal_name,email,status,invitation_expires_at,draft_updated_at,signed_at,draft_payload,invitation_delivery_status,credit_report_voluntary_at,credit_report_consent_version,
    client_applications!inner(id,property_title,property_address,draft_payload,deleted_at,
      application_form_versions!inner(version,sha256),
      application_terms_versions!inner(version,sha256,displayed_text)),
    client_application_files(id,applicant_id,document_type,original_filename,mime_type,byte_size,scan_status,uploaded_at)
  `).eq("id", guest.applicantId).eq("application_id", guest.applicationId).single();
  if (result.error || !result.data) throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired.");
  const application = Array.isArray(result.data.client_applications) ? result.data.client_applications[0] : result.data.client_applications;
  if (application.deleted_at) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  const form = Array.isArray(application.application_form_versions) ? application.application_form_versions[0] : application.application_form_versions;
  const terms = Array.isArray(application.application_terms_versions) ? application.application_terms_versions[0] : application.application_terms_versions;
  return {
    application: { id: application.id, propertyTitle: application.property_title, propertyAddress: application.property_address, formVersion: form.version, formSha256: form.sha256, termsVersion: terms.version, termsSha256: terms.sha256, termsText: terms.displayed_text },
    applicant: { ...mapApplicantRow(result.data), draft: { ...applicationDraftSchema.parse(result.data.draft_payload), tenancy: applicationDraftSchema.parse(application.draft_payload).tenancy }, files: (result.data.client_application_files ?? []).map((file: Record<string, unknown>) => ({ id: String(file.id), applicantId: String(file.applicant_id), documentType: file.document_type, originalFilename: String(file.original_filename), mimeType: file.mime_type, byteSize: Number(file.byte_size), scanStatus: file.scan_status, uploadedAt: String(file.uploaded_at) })) },
  };
}

export async function saveGuestApplicantDraft(sessionToken: string, input: { draft: ApplicationDraft; activeStep: number }, context: ApplicationRequestContext) {
  const parsedDraft = applicationDraftSchema.parse(input.draft);
  const { adultCount, childCount } = parsedDraft.tenancy;
  const draft: ApplicationDraft = adultCount !== null && childCount !== null
    ? { ...parsedDraft, tenancy: { ...parsedDraft.tenancy, occupantCount: adultCount + childCount } }
    : parsedDraft;
  const view = await getGuestApplication(sessionToken);
  draft.tenancy = view.applicant.draft.tenancy;
  // The verified account identifies the invitee; the invitation may contain a
  // nickname or an incomplete name. Their own completed personal details prevail.
  const legalName = draft.personal.legalFirstName && draft.personal.legalLastName
    ? draftLegalName(draft) : view.applicant.legalName;
  const now = new Date().toISOString();
  if (process.env.DATA_BACKEND !== "supabase") {
    const applicant = await memoryGuest(sessionToken);
    if (applicant.status === "signed") throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "A signed application cannot be edited.");
    applicant.legalName = legalName;
    applicant.draft = structuredClone(draft); applicant.draftUpdatedAt = now;
    return { draft: structuredClone(draft), draftUpdatedAt: now };
  }
  const guest = await supabaseGuest(sessionToken);
  const updated = await serviceClient().from("application_applicants").update({ legal_name: legalName, draft_payload: draft, draft_updated_at: now, updated_at: now })
    .eq("id", guest.applicantId).eq("application_id", guest.applicationId).neq("status", "signed").neq("status", "revoked").select("id").maybeSingle();
  if (updated.error || !updated.data) throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "A signed application cannot be edited.");
  await serviceClient().from("client_application_audit_events").insert({ application_id: guest.applicationId, actor_user_id: null, actor_type: "guest", action: "application.guest_draft_saved", request_context: { ...context, activeStep: input.activeStep, applicantId: guest.applicantId } });
  return { draft, draftUpdatedAt: now };
}

function validateApplicantReady(draft: ApplicationDraft, files: ApplicationFileRecord[]) {
  assertCreditReportVoluntary(draft, files);
  const issues = validateCompleteApplicationDraft(draft);
  if (issues.length) throw new ApiError(400, "APPLICATION_DRAFT_INCOMPLETE", `Complete ${issues[0].section.replaceAll("_", " ")} before signing.`);
  const missing = CO_APPLICANT_REQUIRED_DOCUMENT_TYPES.find((type) => !applicationDocumentRequirementSatisfied(type, files, draft.documentExplanations));
  if (missing) throw new ApiError(400, "APPLICATION_DOCUMENTS_REQUIRED", `Upload the required ${APPLICATION_DOCUMENT_LABELS[missing].toLowerCase()} or provide an explanation before signing.`);
  if (files.some((file) => file.scanStatus === "rejected")) throw new ApiError(400, "APPLICATION_FILE_REJECTED", "Remove or replace the rejected file before signing.");
}

export async function signGuestApplicant(sessionToken: string, rawInput: ApplicantSignatureInput, context: ApplicationRequestContext) {
  const input = applicantSignatureSchema.parse(rawInput);
  const view = await getGuestApplication(sessionToken);
  if (view.applicant.status === "signed") throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "This applicant has already signed.");
  if (normalizedName(input.signatureLegalName) !== normalizedName(draftLegalName(view.applicant.draft))) throw new ApiError(400, "APPLICATION_SIGNATURE_NAME_MISMATCH", "The typed signature must match the legal name in your saved personal details.");
  if (input.termsVersion !== view.application.termsVersion || input.termsSha256 !== view.application.termsSha256 || input.formVersion !== view.application.formVersion || input.formSha256 !== view.application.formSha256) throw new ApiError(409, "APPLICATION_VERSION_CHANGED", "The form or consent changed. Review the current version before signing.");
  const guestFiles = view.applicant.files as ApplicationFileRecord[];
  validateApplicantReady(view.applicant.draft, guestFiles);
  const now = new Date().toISOString();
  const fileSnapshot = signatureFileSnapshot(guestFiles);
  const evidenceHash = digest(JSON.stringify({ applicationId: view.application.id, applicantId: view.applicant.id, draft: view.applicant.draft, files: fileSnapshot, ...input }));
  if (process.env.DATA_BACKEND !== "supabase") {
    const applicant = await memoryGuest(sessionToken);
    assertCompleteMemoryRoster(applicant.applicationId);
    memoryStores().signatures.set(applicant.id, { applicantId: applicant.id, signedAt: now, evidenceHash,
      evidence: { legalName: input.signatureLegalName, signedAt: now, termsVersion: input.termsVersion, termsText: view.application.termsText, sharingAuthorized: input.sharingAuthorization, screeningConsented: input.screeningConsent } });
    applicant.status = "signed"; applicant.signedAt = now;
    if (guestFiles.some(file => file.documentType === "credit_score_report") && applicant.draft.creditReportVoluntary) { applicant.creditReportVoluntaryAt = now; applicant.creditReportConsentVersion = "2026-10-15.1"; }
    const { completePendingJointSubmission } = await import("@/features/applications/service");
    await completePendingJointSubmission(applicant.applicationId);
    return publicApplicant(applicant);
  }
  const signed = await serviceClient().rpc("sign_guest_application_applicant", {
    p_session_sha256: hashGuestToken(sessionToken),
    p_signature_legal_name: input.signatureLegalName,
    p_terms_version: input.termsVersion,
    p_terms_sha256: input.termsSha256,
    p_form_version: input.formVersion,
    p_form_sha256: input.formSha256,
    p_displayed_terms_text: view.application.termsText,
    p_expected_draft_payload: view.applicant.draft,
    p_expected_files: fileSnapshot,
    p_request_context: context,
    p_signed_at: now,
  });
  if (signed.error?.message.includes("applicant_signed")) throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "This applicant has already signed.");
  if (signed.error?.message.includes("applicant_revoked") || signed.error?.message.includes("guest_session_invalid")) throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired.");
  if (signed.error?.message.includes("applicant_identity_mismatch")) throw new ApiError(400, "APPLICATION_SIGNATURE_NAME_MISMATCH", "The typed signature must match the legal name in your saved personal details. Save your details and review them before signing again.");
  if (signed.error?.message.includes("application_materials_not_approved")) throw new ApiError(409, "APPLICATION_MATERIALS_NOT_APPROVED", "The application form or terms are awaiting approval. Contact the property manager before signing.");
  if (signed.error?.message.includes("application_version_changed")) throw new ApiError(409, "APPLICATION_VERSION_CHANGED", "The form or consent changed. Review the current version before signing.");
  if (signed.error?.message.includes("application_snapshot_changed")) throw new ApiError(409, "APPLICATION_SNAPSHOT_CHANGED", "The application changed while it was being signed. Review it and sign again.");
  if (signed.error?.message.includes("co_applicant_roster_incomplete")) throw new ApiError(409, "APPLICATION_APPLICANT_COUNT_MISMATCH", "Ask the primary applicant to invite every additional adult before anyone signs.");
  if (signed.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The signature could not be recorded.");
  return { ...view.applicant, status: "signed" as const, signedAt: now };
}

function inspectGuestUpload(file: File, bytes: Uint8Array) {
  if (bytes.length < 4 || bytes.length > APPLICATION_MAX_FILE_BYTES) throw new ApiError(400, "INVALID_APPLICATION_FILE_SIZE", "Each file must be between 1 byte and 10 MB.");
  const name = file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180) || "application-file";
  let mimeType: ApplicationFileRecord["mimeType"]; let extension: string;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) { mimeType = "application/pdf"; extension = "pdf"; if (hasUnsafePdfFeatures(bytes)) throw new ApiError(400, "UNSAFE_APPLICATION_FILE", "Unsafe PDFs are not accepted."); }
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { mimeType = "image/jpeg"; extension = "jpg"; }
  else if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { mimeType = "image/png"; extension = "png"; }
  else throw new ApiError(400, "UNSUPPORTED_APPLICATION_FILE", "Upload a PDF, JPEG, or PNG file.");
  const expected = mimeType === "application/pdf" ? [".pdf"] : mimeType === "image/png" ? [".png"] : [".jpg", ".jpeg"];
  if (!expected.some((suffix) => name.toLowerCase().endsWith(suffix)) || (file.type && file.type !== "application/octet-stream" && file.type !== mimeType)) throw new ApiError(400, "APPLICATION_FILE_TYPE_MISMATCH", "The filename or declared type does not match the file content.");
  return { name, mimeType, extension };
}

export async function uploadGuestApplicantFile(sessionToken: string, file: File, documentType: ApplicationDocumentType, context: ApplicationRequestContext) {
  const applicant = process.env.DATA_BACKEND !== "supabase" ? await memoryGuest(sessionToken) : null;
  const guest = process.env.DATA_BACKEND === "supabase" ? await supabaseGuest(sessionToken) : null;
  if (applicant?.status === "signed") throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "Files cannot be changed after signing.");
  const current = await getGuestApplication(sessionToken);
  if (current.applicant.status === "signed") throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "Files cannot be changed after signing.");
  if (current.applicant.files.length >= 8) throw new ApiError(400, "TOO_MANY_APPLICATION_FILES", "An applicant can include at most 8 files.");
  const bytes = new Uint8Array(await file.arrayBuffer()); const inspected = inspectGuestUpload(file, bytes); const uploadedAt = new Date().toISOString();
  const record: ApplicationFileRecord = { id: crypto.randomUUID(), applicantId: current.applicant.id, documentType, originalFilename: inspected.name, mimeType: inspected.mimeType, byteSize: bytes.length, scanStatus: "manual_review_required", uploadedAt };
  if (applicant) { if (documentType === "credit_score_report") applicant.draft.creditReportVoluntary = false; applicant.files.push(record); memoryStores().fileBytes.set(record.id, bytes); return structuredClone(record); }
  const service = serviceClient(); const storagePath = `guests/${current.application.id}/${current.applicant.id}/${crypto.randomUUID()}.${inspected.extension}`;
  const uploaded = await service.storage.from(process.env.APPLICATION_UPLOAD_BUCKET || APPLICATION_UPLOAD_BUCKET).upload(storagePath, bytes, { contentType: inspected.mimeType, upsert: false });
  if (uploaded.error) throw new ApiError(503, "APPLICATION_UPLOAD_UNAVAILABLE", "The file could not be stored securely.");
  const inserted = await service.from("client_application_files").insert({ id: record.id, application_id: guest!.applicationId, applicant_id: guest!.applicantId, document_type: documentType, storage_path: storagePath, original_filename: record.originalFilename, mime_type: record.mimeType, byte_size: record.byteSize, sha256: digest(bytes), scan_status: record.scanStatus, uploaded_at: uploadedAt });
  if (inserted.error) { await service.storage.from(process.env.APPLICATION_UPLOAD_BUCKET || APPLICATION_UPLOAD_BUCKET).remove([storagePath]); throw new ApiError(503, "APPLICATION_UPLOAD_UNAVAILABLE", "The file could not be recorded securely."); }
  await service.from("client_application_audit_events").insert({ application_id: guest!.applicationId, actor_user_id: null, actor_type: "guest", action: "application.guest_file_uploaded", request_context: { ...context, applicantId: guest!.applicantId, fileId: record.id } });
  return record;
}

// Delete metadata first: the database trigger serializes this with signing and
// rejects changes to signed evidence before any storage object is touched.
export async function deleteStoredApplicantFile(applicationId: string, applicantId: string, fileId: string, userId: string, context: ApplicationRequestContext) {
  const service = serviceClient();
  const removed = await service.from("client_application_files").delete()
    .eq("id", fileId).eq("application_id", applicationId).eq("applicant_id", applicantId)
    .select("storage_path").maybeSingle();
  if (removed.error?.code === "TT409") throw new ApiError(409, "APPLICATION_SIGNATURES_LOCKED", "Files cannot be changed while signing or after your signature is recorded. Refresh the application.");
  if (removed.error) throw new ApiError(503, "APPLICATION_FILE_DELETE_UNAVAILABLE", "The file could not be removed. Please try again.");
  if (!removed.data) throw new ApiError(404, "APPLICATION_FILE_NOT_FOUND", "File not found in your application.");
  const storagePath = String(removed.data.storage_path);
  // A storage outage must not put the removed file back into the application.
  // Retain the private cleanup locator in the audit trail for retry/reconciliation.
  let cleanupPending = false;
  try {
    const cleanup = await service.storage.from(process.env.APPLICATION_UPLOAD_BUCKET || APPLICATION_UPLOAD_BUCKET).remove([storagePath]);
    cleanupPending = Boolean(cleanup.error);
  } catch { cleanupPending = true; }
  const audit = await service.from("client_application_audit_events").insert({
    application_id: applicationId, actor_user_id: userId, actor_type: "client", action: "application.file_removed",
    request_context: { ...context, applicantId, fileId, ...(cleanupPending ? { storageCleanupPending: true, storagePath } : {}) }
  });
  if (cleanupPending || audit.error) console.error(JSON.stringify({ level: "error", message: "Application file removal needs reconciliation", requestId: context.requestId, fileId, cleanupPending, auditFailed: Boolean(audit.error) }));
}

export async function removeGuestApplicantFile(sessionToken: string, fileId: string, identity: ClientIdentity, context: ApplicationRequestContext) {
  await assertGuestAccount(sessionToken, identity);
  const view = await getGuestApplication(sessionToken);
  if (view.applicant.status === "signed") throw new ApiError(409, "APPLICATION_APPLICANT_SIGNED", "Files cannot be changed after signing.");
  if (!view.applicant.files.some(file => file.id === fileId)) throw new ApiError(404, "APPLICATION_FILE_NOT_FOUND", "File not found in your application.");
  if (process.env.DATA_BACKEND !== "supabase") {
    const applicant = await memoryGuest(sessionToken);
    applicant.files = applicant.files.filter(file => file.id !== fileId);
    memoryStores().fileBytes.delete(fileId);
  } else {
    await deleteStoredApplicantFile(view.application.id, view.applicant.id, fileId, identity.userId, context);
  }
  return { removed: true };
}

export async function assertApplicationSignaturesUnlocked(applicationId: string, applicantId?: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    if ([...memoryStores().applicants.values()].some((a) => a.applicationId === applicationId && (!applicantId || a.id === applicantId) && memoryStores().signatures.has(a.id))) throw new ApiError(409, "APPLICATION_SIGNATURES_LOCKED", "The shared application cannot be edited after signing has started.");
    return;
  }
  let query = serviceClient().from("application_applicant_signatures").select("id", { count: "exact", head: true }).eq("application_id", applicationId);
  if (applicantId) query = query.eq("applicant_id", applicantId);
  const result = await query;
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Signature status could not be checked.");
  if ((result.count ?? 0) > 0) throw new ApiError(409, "APPLICATION_SIGNATURES_LOCKED", "The shared application cannot be edited after signing has started.");
}

export async function assertAllActiveCoApplicantsSigned(applicationId: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    if ([...memoryStores().applicants.values()].some((a) => a.applicationId === applicationId && a.role === "co_applicant" && a.status !== "revoked" && a.status !== "signed")) throw new ApiError(409, "APPLICATION_CO_APPLICANTS_UNSIGNED", "Every active co-applicant must sign before final submission.");
    return;
  }
  const result = await serviceClient().from("application_applicants").select("id", { count: "exact", head: true }).eq("application_id", applicationId).eq("role", "co_applicant").neq("status", "revoked").neq("status", "signed");
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "Applicant status could not be checked.");
  if ((result.count ?? 0) > 0) throw new ApiError(409, "APPLICATION_CO_APPLICANTS_UNSIGNED", "Every active co-applicant must sign before final submission.");
}

export async function recordPrimarySignatureAndCreditRequests(input: { applicationId: string; identity: ClientIdentity; legalName: string; signature: ApplicantSignatureInput; termsText: string; draft: ApplicationDraft; files: ApplicationFileRecord[]; context: ApplicationRequestContext; signedAt: string; retainUntil: string }) {
  const expectedName = `${input.draft.personal.legalFirstName} ${input.draft.personal.legalLastName}`.trim();
  if (normalizedName(input.legalName) !== normalizedName(expectedName)) throw new ApiError(400, "APPLICATION_SIGNATURE_NAME_MISMATCH", "The typed signature must match the primary applicant's legal name.");
  const fileSnapshot = signatureFileSnapshot(input.files);
  const evidenceHash = digest(JSON.stringify({ applicationId: input.applicationId, draft: input.draft, files: fileSnapshot, signature: input.signature }));
  if (process.env.DATA_BACKEND !== "supabase") {
    const primary = await assertMemoryOwner(input.identity, input.applicationId);
    assertCompleteMemoryRoster(input.applicationId);
    primary.legalName = expectedName; primary.status = "signed"; primary.signedAt = input.signedAt;
    if (input.files.some(file => file.documentType === "credit_score_report") && input.draft.creditReportVoluntary) { primary.creditReportVoluntaryAt = input.signedAt; primary.creditReportConsentVersion = "2026-10-15.1"; }
    memoryStores().signatures.set(primary.id, { applicantId: primary.id, signedAt: input.signedAt, evidenceHash,
      evidence: { legalName: input.legalName, signedAt: input.signedAt, termsVersion: input.signature.termsVersion, termsText: input.termsText, sharingAuthorized: input.signature.sharingAuthorization, screeningConsented: input.signature.screeningConsent } });

    return;
  }
  const result = await serviceClient().rpc("finalize_multi_applicant_application", {
    p_application_id: input.applicationId,
    p_owner_user_id: input.identity.userId,
    p_signature_legal_name: input.legalName,
    p_terms_version: input.signature.termsVersion,
    p_terms_sha256: input.signature.termsSha256,
    p_form_version: input.signature.formVersion,
    p_form_sha256: input.signature.formSha256,
    p_displayed_terms_text: input.termsText,
    p_expected_draft_payload: input.draft,
    p_expected_files: fileSnapshot,
    p_request_context: input.context,
    p_submitted_at: input.signedAt,
    p_retain_until: input.retainUntil,
  });
  if (result.error?.message.includes("co_applicants_unsigned")) throw new ApiError(409, "APPLICATION_CO_APPLICANTS_UNSIGNED", "Every active co-applicant must sign before final submission.");
  if (result.error?.message.includes("co_applicant_roster_incomplete")) throw new ApiError(409, "APPLICATION_APPLICANT_COUNT_MISMATCH", "Invite every additional adult before confirming your submission.");
  if (result.error?.message.includes("application_not_draft")) throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "This application has already been submitted.");
  if (result.error?.message.includes("applicant_identity_mismatch")) throw new ApiError(400, "APPLICATION_SIGNATURE_NAME_MISMATCH", "The typed signature must match the primary applicant's legal name.");
  if (result.error?.message.includes("application_materials_not_approved")) throw new ApiError(409, "APPLICATION_MATERIALS_NOT_APPROVED", "The application form or terms are awaiting approval. Contact the property manager before signing.");
  if (result.error?.message.includes("application_version_changed")) throw new ApiError(409, "APPLICATION_VERSION_CHANGED", "The form or consent changed. Review the current version before submitting.");
  if (result.error?.message.includes("application_snapshot_changed")) throw new ApiError(409, "APPLICATION_SNAPSHOT_CHANGED", "The application changed while it was being submitted. Review it and submit again.");
  if (result.error) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "The application signature could not be recorded.");
}
