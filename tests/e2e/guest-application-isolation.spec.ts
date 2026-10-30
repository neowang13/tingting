import { expect, test, type Page } from "@playwright/test";
import { applicationDraftSchema } from "../../src/features/applications/schemas";

const password = "test-admin-password";
const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% FICTIONAL TEST ONLY\n%%EOF") });

async function login(page: Page, email: string) {
  await page.goto("/client/login?next=%2Fclient%2Fapplications");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/client\/applications$/);
}

test("two tabs of the same co-applicant keep uploads, drafts and file reconciliation in their displayed application", async ({ page, browser }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await login(page, "client@example.test");
  const origin = new URL(page.url()).origin;
  const invitations = [];
  for (const propertySlug of ["howe-street-one-bedroom", "melville-street-two-bedroom"]) {
    const started = await page.request.post("/api/client/applications/start", { headers: { origin }, data: { propertySlug } });
    expect(started.status()).toBe(200);
    const applicationId = (await started.json()).data.applicationId;
    const draft = applicationDraftSchema.parse({
      personal: { legalFirstName: "Primary", legalLastName: "Applicant", email: "client@example.test", phone: "6045550100" },
      tenancy: { desiredMoveInDate: "2026-12-01", adultCount: 2, childCount: 0, leaseTerm: "one_year", needsShowing: "no" }
    });
    expect((await page.request.patch(`/api/client/applications/${applicationId}/draft`, { headers: { origin }, data: { draft, activeStep: 1 } })).ok()).toBe(true);
    const invited = await page.request.post(`/api/client/applications/${applicationId}/applicants`, { headers: { origin }, data: { legalName: "Second Applicant", email: "second@example.test" } });
    expect(invited.status()).toBe(201);
    invitations.push({ ...(await invited.json()).data, applicationId });
  }

  // Compile guest routes before opening the tabs: a dev-server first-use HMR
  // reload would discard in-memory UI steps during the reproduction itself.
  await page.request.get("/api/application-guests/session");
  await page.request.get("/api/application-guests/files");
  await page.request.patch("/api/application-guests/draft", { headers: { origin }, data: {} });
  await page.request.post("/api/application-guests/sign", { headers: { origin }, data: {} });
  await page.request.delete("/api/application-guests/files/00000000-0000-4000-8000-000000000000", { headers: { origin } });

  const guestContext = await browser.newContext();
  try {
    const tabA = await guestContext.newPage();
    tabA.setDefaultTimeout(10_000);
    await login(tabA, "second@example.test");
    const tabB = await guestContext.newPage();
    tabB.setDefaultTimeout(10_000);
    for (const [tab, invitation] of [[tabA, invitations[0]], [tabB, invitations[1]]] as const) {
      await tab.goto(`${origin}/client/invitations?invitation=${invitation.invitationId}`);
      await tab.getByRole("button", { name: "Accept invitation", exact: true }).click();
      await expect(tab.getByLabel("Legal first name *", { exact: true })).toBeVisible();
      await tab.getByRole("button", { name: "5 Documents", exact: true }).click();
    }

    // B is now the most recently opened session in this shared cookie jar.
    for (const [tab, invitation, filenames] of [
      [tabA, invitations[0], ["fictional-A-1.pdf", "fictional-A-2.pdf"]],
      [tabB, invitations[1], ["fictional-B.pdf"]]
    ] as const) {
      await tab.bringToFront();
      await expect(tab.getByRole("heading", { level: 1, name: invitation === invitations[0] ? "Bright Downtown One Bedroom" : "West End Two Bedroom" })).toBeVisible();
      await tab.getByRole("button", { name: "5 Documents", exact: true }).click();
      for (const filename of filenames) {
        const uploaded = tab.waitForResponse(response => response.url().endsWith("/api/application-guests/files") && response.request().method() === "POST");
        await tab.getByLabel("Choose Credit score report file").setInputFiles(pdf(filename));
        const response = await uploaded;
        expect(response.status()).toBe(201);
        expect((await response.json()).data.applicantId).toBe(invitation.applicant.id);
        await expect(tab.getByText(filename, { exact: true })).toBeVisible();
      }
    }

    const filesFor = async (applicantId: string) => {
      const response = await tabA.evaluate(async id => {
        const result = await fetch("/api/application-guests/files", { headers: { "x-application-applicant-id": id } });
        return { status: result.status, body: await result.json() };
      }, applicantId);
      expect(response.status).toBe(200);
      return response.body.data.files as { id: string; applicantId: string; originalFilename: string }[];
    };
    const aFiles = await filesFor(invitations[0].applicant.id);
    const bFiles = await filesFor(invitations[1].applicant.id);
    expect(aFiles.map(file => file.originalFilename)).toEqual(["fictional-A-1.pdf", "fictional-A-2.pdf"]);
    expect(bFiles.map(file => file.originalFilename)).toEqual(["fictional-B.pdf"]);

    // Focus reconciliation must never replace A's list with B's files.
    for (const event of ["focus", "online"]) {
      const synchronized = tabA.waitForResponse(response => response.url().endsWith("/api/application-guests/files") && response.request().method() === "GET");
      await tabA.evaluate(name => window.dispatchEvent(new Event(name)), event);
      const response = await synchronized;
      expect(response.request().headers()["x-application-applicant-id"]).toBe(invitations[0].applicant.id);
      expect(response.status()).toBe(200);
      await expect(tabA.getByText("fictional-A-1.pdf", { exact: true })).toBeVisible();
      await expect(tabA.getByText("fictional-B.pdf", { exact: true })).toHaveCount(0);
    }

    // Deletion and lost-response reconciliation use the same bound context.
    await tabA.route("**/api/application-guests/files/*", async route => {
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    }, { times: 1 });
    tabA.once("dialog", dialog => dialog.accept());
    await tabA.getByRole("button", { name: "Remove fictional-A-1.pdf", exact: true }).click();
    await expect(tabA.getByText("fictional-A-1.pdf", { exact: true })).toHaveCount(0);
    expect((await filesFor(invitations[1].applicant.id)).map(file => file.originalFilename)).toEqual(["fictional-B.pdf"]);

    // Reload A after opening B must restore A and keep a draft save in A.
    await tabA.reload();
    await expect(tabA.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();
    await tabA.getByLabel("Phone number *", { exact: true }).fill("6045550199");
    await tabA.getByRole("button", { name: "Save and continue", exact: true }).click();
    await expect(tabA.getByText("Your application draft was saved securely.", { exact: true })).toBeVisible();
    for (const [invitation, expectedPhone] of [[invitations[0], "6045550199"], [invitations[1], ""]] as const) {
      const response = await tabA.evaluate(async id => {
        const result = await fetch("/api/application-guests/session", { headers: { "x-application-applicant-id": id } });
        return { status: result.status, body: await result.json() };
      }, invitation.applicant.id);
      expect(response.status).toBe(200);
      const data = response.body.data;
      expect(data.application.id).toBe(invitation.applicationId);
      expect(data.applicant.draft.personal.phone).toBe(expectedPhone);
    }

    // Stale clients without a displayed applicant context must fail closed.
    const stale = await tabA.evaluate(async () => {
      const data = new FormData();
      data.set("documentType", "credit_score_report");
      data.set("file", new File(["%PDF-1.4\n% FICTIONAL TEST ONLY\n%%EOF"], "stale.pdf", { type: "application/pdf" }));
      return (await fetch("/api/application-guests/files", { method: "POST", body: data })).status;
    });
    expect(stale).toBe(409);
  } finally {
    await guestContext.close();
    for (const invitation of invitations) {
      const revoked = await page.request.delete(`/api/client/applications/${invitation.applicationId}/applicants/${invitation.applicant.id}`, { headers: { origin } });
      expect(revoked.ok()).toBe(true);
    }
  }
});
