import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { applicationDraftSchema } from "../../src/features/applications/schemas";

test("Supabase persists each tab's files in its displayed application and rejects stale or unauthorized contexts", async ({ browser }) => {
  test.setTimeout(120_000);
  const url = process.env.TEST_SUPABASE_URL!;
  if (process.env.E2E_SUPABASE_TEST_PROJECT_CONFIRMED !== "true" || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("This synthetic fixture requires the dedicated local Supabase project.");
  }
  const service = createClient(url, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const marker = `qa-tabs-${Date.now()}`;
  const password = process.env.TEST_ADMIN_PASSWORD!;
  const users = [];
  for (const name of ["owner", "guest", "outsider"]) {
    const email = `${marker}-${name}@example.test`;
    const result = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { account_type: "client", display_name: `${name} Applicant` } });
    expect(result.error).toBeNull();
    users.push({ id: result.data.user!.id, email });
  }
  expect((await service.from("client_profiles").upsert(users.map(user => ({ user_id: user.id, display_name: "Fictional Applicant", is_active: true })))).error).toBeNull();
  const [owner, guest, outsider] = users;
  const form = await service.from("application_form_versions").select("id").eq("is_active", true).single();
  const terms = await service.from("application_terms_versions").select("id").eq("is_active", true).single();
  expect(form.error).toBeNull(); expect(terms.error).toBeNull();
  const draft = applicationDraftSchema.parse({
    personal: { legalFirstName: "Guest", legalLastName: "Applicant", email: guest.email, phone: "6045550199" },
    tenancy: { desiredMoveInDate: "2026-12-01", adultCount: 2, childCount: 0, leaseTerm: "one_year", needsShowing: "no" },
    housing: { currentAddress: "Fictional Test Address", currentHousingSince: "2024-01", currentMonthlyRent: 2200, landlordName: "Test Landlord", landlordPhone: "6045550101", reasonForLeaving: "Fictional test move" },
    employment: { employmentStatus: "employed", employerOrIncomeSource: "Fictional Employer", occupation: "Tester", employmentSince: "2020-01", grossMonthlyIncome: 7000, contactName: "Test Manager", contactPhone: "6045550102" },
    references: { primary: { name: "Test Reference", relationship: "Colleague", phone: "6045550103" } },
    emergency: { name: "Test Emergency", relationship: "Sibling", phone: "6045550104" },
    documentExplanations: { credit_score_report: "Fictional test explanation" }
  });
  const applications = [];
  for (const name of ["A", "B"]) {
    const applicationId = crypto.randomUUID(), applicantId = crypto.randomUUID();
    expect((await service.from("client_applications").insert({
      id: applicationId, owner_user_id: owner.id, property_title: `${marker}-${name}`, property_address: `Fictional ${name} Street`,
      form_version_id: form.data!.id, terms_version_id: terms.data!.id,
      draft_payload: { ...draft, personal: { ...draft.personal, legalFirstName: "Primary", email: owner.email } }
    })).error).toBeNull();
    expect((await service.from("application_applicants").insert({
      id: applicantId, application_id: applicationId, owner_user_id: guest.id, role: "co_applicant", legal_name: "Guest Applicant",
      email: guest.email, status: "in_progress", draft_payload: draft
    })).error).toBeNull();
    applications.push({ applicationId, applicantId, title: `${marker}-${name}` });
  }
  async function login(page: Page, email: string) {
    page.setDefaultTimeout(15_000);
    await page.goto("/client/login?next=%2Fclient%2Fapplications");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await expect(page).toHaveURL(/\/client\/applications$/);
  }
  async function api(page: Page, path: string, applicantId?: string, method = "GET", payload?: unknown) {
    return page.evaluate(async input => {
      const response = await fetch(input.path, {
        method: input.method,
        headers: { ...(input.applicantId ? { "x-application-applicant-id": input.applicantId } : {}), ...(input.payload ? { "content-type": "application/json" } : {}) },
        body: input.payload ? JSON.stringify(input.payload) : undefined
      });
      return { status: response.status, body: await response.json() };
    }, { path, applicantId, method, payload });
  }
  const context = await browser.newContext();
  const otherContext = await browser.newContext();
  try {
    const tabA = await context.newPage();
    await login(tabA, guest.email);
    // Compile the API modules before the two tabs hold unsaved UI state.
    await api(tabA, "/api/application-guests/session");
    await api(tabA, "/api/application-guests/files");
    await api(tabA, "/api/application-guests/draft", undefined, "PATCH", {});
    await api(tabA, "/api/application-guests/sign", undefined, "POST", {});
    await api(tabA, "/api/application-guests/files/00000000-0000-4000-8000-000000000000", undefined, "DELETE");
    const tabB = await context.newPage();
    tabB.setDefaultTimeout(15_000);
    const [a, b] = applications;
    for (const [page, fixture] of [[tabA, a], [tabB, b]] as const) {
      await page.goto(`/client/invitations?applicant=${fixture.applicantId}`);
      await expect(page.getByRole("heading", { level: 1, name: fixture.title })).toBeVisible();
    }
    const expected = new Map<string, { applicationId: string; applicantId: string; bytes: Buffer }>();
    for (const [page, fixture, names] of [[tabA, a, ["A-1", "A-2"]], [tabB, b, ["B-1"]]] as const) {
      await page.bringToFront();
      await page.getByRole("button", { name: "5 Documents", exact: true }).click();
      for (const name of names) {
        const filename = `${marker}-${name}.pdf`, bytes = Buffer.from(`%PDF-1.4\n% FICTIONAL TEST ONLY ${name}\n%%EOF`);
        const uploaded = page.waitForResponse(response => response.url().endsWith("/api/application-guests/files") && response.request().method() === "POST");
        await page.getByLabel("Choose Credit score report file").setInputFiles({ name: filename, mimeType: "application/pdf", buffer: bytes });
        const response = await uploaded;
        expect(response.status()).toBe(201);
        expect((await response.json()).data.applicantId).toBe(fixture.applicantId);
        expected.set(filename, { ...fixture, bytes });
        await expect(page.getByText(filename, { exact: true })).toBeVisible();
      }
    }
    const stored = await service.from("client_application_files").select("id,application_id,applicant_id,storage_path,original_filename").in("application_id", applications.map(item => item.applicationId));
    expect(stored.error).toBeNull(); expect(stored.data).toHaveLength(3);
    for (const file of stored.data!) {
      const target = expected.get(file.original_filename)!;
      expect(file.application_id).toBe(target.applicationId);
      expect(file.applicant_id).toBe(target.applicantId);
      expect(file.storage_path).toContain(`guests/${target.applicationId}/${target.applicantId}/`);
      const object = await service.storage.from("client-applications").download(file.storage_path);
      expect(object.error).toBeNull();
      expect(Buffer.from(await object.data!.arrayBuffer())).toEqual(target.bytes);
    }
    for (const event of ["focus", "online"]) {
      const synchronized = tabA.waitForResponse(response => response.url().endsWith("/api/application-guests/files") && response.request().method() === "GET");
      await tabA.evaluate(name => window.dispatchEvent(new Event(name)), event);
      const response = await synchronized;
      expect(response.status()).toBe(200);
      expect(response.request().headers()["x-application-applicant-id"]).toBe(a.applicantId);
      await expect(tabA.getByText(`${marker}-B-1.pdf`, { exact: true })).toHaveCount(0);
    }
    // Old clients are rejected before any mutation, including sign and deletion.
    for (const [path, method] of [["draft", "PATCH"], ["sign", "POST"], [`files/${stored.data![0].id}`, "DELETE"]]) {
      expect((await api(tabA, `/api/application-guests/${path}`, undefined, method, method === "DELETE" ? undefined : {})).status).toBe(409);
    }
    // Upgrade the legacy bootstrap cookie without changing the displayed target.
    expect((await api(tabA, "/api/application-guests/session", undefined, "POST", { applicantId: a.applicantId })).status).toBe(200);
    await context.clearCookies({ name: `application_guest_${a.applicantId}` });
    const upgraded = await api(tabA, "/api/application-guests/session");
    expect(upgraded.status).toBe(200); expect(upgraded.body.data.application.id).toBe(a.applicationId);
    expect((await context.cookies()).some(cookie => cookie.name === `application_guest_${a.applicantId}`)).toBe(true);
    // A valid guest cookie still cannot be used by a different verified account.
    const outsiderPage = await otherContext.newPage();
    await login(outsiderPage, outsider.email);
    await otherContext.addCookies((await context.cookies()).filter(cookie => cookie.name.startsWith("application_guest")));
    expect((await api(outsiderPage, "/api/application-guests/files", a.applicantId)).status).toBe(403);
    // Signing A must leave B's application and signature untouched.
    await expect(tabA.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    await tabA.getByRole("button", { name: "5 Documents", exact: true }).click();
    await tabA.getByLabel("I confirm that I voluntarily provide this credit score report for assessment of my rental application.").check();
    await tabA.getByRole("button", { name: /Review & sign/ }).click();
    await tabA.getByLabel(/I authorize the property manager/).check();
    await tabA.getByLabel(/I consent to reference, housing and income verification/).check();
    await tabA.getByLabel("Type your full legal name to sign *").fill("Guest Applicant");
    await tabA.getByRole("button", { name: "Sign my application" }).click();
    await expect(tabA.getByRole("heading", { name: "Your part of the application is complete", exact: true })).toBeVisible();
    const applicants = await service.from("application_applicants").select("id,status").in("id", [a.applicantId, b.applicantId]);
    expect(applicants.error).toBeNull();
    expect(applicants.data).toEqual(expect.arrayContaining([{ id: a.applicantId, status: "signed" }, { id: b.applicantId, status: "in_progress" }]));
    const signatures = await service.from("application_applicant_signatures").select("application_id,applicant_id").in("application_id", applications.map(item => item.applicationId));
    expect(signatures.error).toBeNull(); expect(signatures.data).toEqual([{ application_id: a.applicationId, applicant_id: a.applicantId }]);
    // Database expiry/revocation remain enforced for the selected B cookie.
    for (const patch of [{ expires_at: new Date(Date.now() - 60_000).toISOString() }, { revoked_at: new Date().toISOString() }]) {
      expect((await api(tabB, "/api/application-guests/session", undefined, "POST", { applicantId: b.applicantId })).status).toBe(200);
      expect((await service.from("application_guest_sessions").update(patch).eq("applicant_id", b.applicantId)).error).toBeNull();
      expect((await api(tabB, "/api/application-guests/files", b.applicantId)).status).toBe(401);
    }
    console.log("Verified local Supabase: A=2 files, B=1 file; DB IDs, storage paths and bytes match; A-only signature; legacy, account, expiry and revocation boundaries pass.");
  } finally {
    await otherContext.close(); await context.close();
  }
});
