import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  run,
  tenantUploadPayload
} from "../skills/tingting-operations/scripts/tingtingctl.mjs";

const temporaryDirectories = [];
const operationId = "00000000-0000-4000-8000-000000000099";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function tenantFile(input) {
  const directory = await mkdtemp(join(tmpdir(), "tingting-tenant-upload-"));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, "tenant.json"), JSON.stringify(input));
  return directory;
}

test("single-tenant upload derives safe defaults and creates after duplicate preflight", async () => {
  const directory = await tenantFile({
    externalReference: "lease-2026-0042",
    fullName: " Jane Chen ",
    propertyLabel: " 123 Main Street ",
    unitLabel: " 1208 ",
    leaseType: "month_to_month",
    leaseStartDate: "2026-08-01",
    email: " JANE@EXAMPLE.COM "
  });
  const requests = [];
  const client = {
    async request(request) {
      requests.push(request);
      if (request.method === "GET") {
        return {
          success: true,
          data: { items: [] },
          requestId: "00000000-0000-4000-8000-000000000001"
        };
      }
      return {
        success: true,
        data: {
          id: "00000000-0000-4000-8000-000000000042",
          emailMasked: "j***@example.com"
        },
        requestId: "00000000-0000-4000-8000-000000000002"
      };
    }
  };

  const result = await run(
    ["tenants", "upload", "--operation-id", operationId, "--input", "tenant.json"],
    { TINGTING_INPUT_DIRECTORY: directory },
    { client }
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "GET");
  assert.match(requests[0].path, /^\/tenants\?/);
  assert.match(requests[0].path, /q=lease-2026-0042/);
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].path, "/tenants");
  assert.equal(requests[1].idempotencyKey, operationId);
  assert.deepEqual(requests[1].body.preferredChannels, ["email"]);
  assert.equal(requests[1].body.email, "jane@example.com");
  assert.equal(requests[1].body.emailContactStatus, "unconfirmed");
  assert.equal(requests[1].body.smsContactStatus, "unconfirmed");
  assert.equal(requests[1].body.timezone, "America/Vancouver");
  assert.equal(requests[1].body.isActive, true);
  assert.equal(requests[1].body.leaseType, "month_to_month");
  assert.equal(requests[1].body.leaseStartDate, "2026-08-01");
  assert.equal(requests[1].body.leaseEndDate, null);
  assert.equal(result.data.action, "created");
  assert.equal(result.data.created, true);
});

test("owner-confirmed PDF onboarding uses the atomic permission and reminder route", async () => {
  const directory = await tenantFile({
    fullName: "Mei Lin",
    propertyLabel: "456 Oak Street",
    unitLabel: "305",
    leaseType: "fixed_term",
    leaseStartDate: "2026-08-01",
    leaseEndDate: "2027-07-31",
    email: "MEI@EXAMPLE.COM",
    ownerConfirmation: {
      confirmedAt: "2026-07-30T20:00:00Z",
      documentDigest: `sha256:${"a".repeat(64)}`
    }
  });
  const requests = [];
  const client = {
    async request(request) {
      requests.push(request);
      if (request.method === "GET") {
        return { success: true, data: { items: [] } };
      }
      return {
        success: true,
        data: {
          tenant: {
            id: "00000000-0000-4000-8000-000000000043",
            emailMasked: "m•••@example.com",
            emailContactStatus: "allowed"
          },
          emailPermission: { status: "allowed" },
          reminder: { configured: true, isEnabled: true }
        }
      };
    }
  };

  const result = await run(
    ["tenants", "onboard", "--operation-id", operationId, "--input", "tenant.json"],
    { TINGTING_INPUT_DIRECTORY: directory },
    { client }
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].path, "/tenant-onboardings");
  assert.equal(requests[1].idempotencyKey, operationId);
  assert.equal(requests[1].body.tenant.email, "mei@example.com");
  assert.equal(requests[1].body.tenant.emailContactStatus, "unconfirmed");
  assert.equal(requests[1].body.tenant.smsContactStatus, "unconfirmed");
  assert.equal(requests[1].body.tenant.leaseType, "fixed_term");
  assert.equal(requests[1].body.tenant.leaseStartDate, "2026-08-01");
  assert.equal(requests[1].body.tenant.leaseEndDate, "2027-07-31");
  assert.deepEqual(requests[1].body.ownerConfirmation, {
    confirmedAt: "2026-07-30T20:00:00Z",
    documentDigest: `sha256:${"a".repeat(64)}`
  });
  assert.equal(result.data.action, "onboarded");
  assert.equal(result.data.tenant.emailContactStatus, "allowed");
  assert.equal(result.data.reminder.isEnabled, true);
});

test("matching source reference returns the existing tenant without another write", async () => {
  const directory = await tenantFile({
    sourceSystem: "property-manager",
    externalReference: "tenant-42",
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street",
    leaseType: "month_to_month",
    leaseStartDate: "2026-08-01"
  });
  const requests = [];
  const existing = {
    id: "00000000-0000-4000-8000-000000000042",
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street",
    unitLabel: null,
    sourceSystem: "property-manager",
    externalReference: "tenant-42"
  };
  const client = {
    async request(request) {
      requests.push(request);
      return {
        success: true,
        data: { items: [existing] },
        requestId: "00000000-0000-4000-8000-000000000001"
      };
    }
  };

  const result = await run(
    ["tenants", "upload", "--operation-id", operationId, "--input", "tenant.json"],
    { TINGTING_INPUT_DIRECTORY: directory },
    { client }
  );

  assert.equal(requests.length, 1);
  assert.equal(result.data.action, "existing");
  assert.equal(result.data.created, false);
  assert.equal(result.data.tenant.id, existing.id);
});

test("duplicate preflight follows tenant search cursors before creating", async () => {
  const directory = await tenantFile({
    sourceSystem: "property-manager",
    externalReference: "tenant-42",
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street",
    leaseType: "month_to_month",
    leaseStartDate: "2026-08-01"
  });
  const requests = [];
  const existing = {
    id: "00000000-0000-4000-8000-000000000042",
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street",
    unitLabel: null,
    sourceSystem: "property-manager",
    externalReference: "tenant-42"
  };
  const client = {
    async request(request) {
      requests.push(request);
      return requests.length === 1
        ? { success: true, data: { items: [], nextCursor: "next-page" } }
        : { success: true, data: { items: [existing], nextCursor: null } };
    }
  };

  const result = await run(
    ["tenants", "upload", "--operation-id", operationId, "--input", "tenant.json"],
    { TINGTING_INPUT_DIRECTORY: directory },
    { client }
  );

  assert.equal(requests.length, 2);
  assert.match(requests[1].path, /cursor=next-page/);
  assert.equal(result.data.action, "existing");
});

test("matching name, property, and unit requires review when no external reference exists", async () => {
  const directory = await tenantFile({
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street",
    unitLabel: "1208",
    leaseType: "month_to_month",
    leaseStartDate: "2026-08-01"
  });
  const existingId = "00000000-0000-4000-8000-000000000042";
  const client = {
    async request() {
      return {
        success: true,
        data: {
          items: [{
            id: existingId,
            fullName: " jane chen ",
            propertyLabel: "123 MAIN STREET",
            unitLabel: "1208",
            sourceSystem: null,
            externalReference: null
          }]
        }
      };
    }
  };

  await assert.rejects(
    run(
      ["tenants", "upload", "--operation-id", operationId, "--input", "tenant.json"],
      { TINGTING_INPUT_DIRECTORY: directory },
      { client }
    ),
    (error) => error.code === "TENANT_REVIEW_REQUIRED" && error.tenantId === existingId
  );
});

test("upload payload never infers permission and rejects a channel without its destination", () => {
  const payload = tenantUploadPayload({
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street",
    leaseType: "month_to_month",
    leaseStartDate: "2026-08-01",
    phoneE164: "+16045550123"
  });
  assert.deepEqual(payload.preferredChannels, ["sms"]);
  assert.equal(payload.emailContactStatus, "unconfirmed");
  assert.equal(payload.smsContactStatus, "unconfirmed");

  assert.throws(
    () => tenantUploadPayload({
      fullName: "Jane Chen",
      propertyLabel: "123 Main Street",
      leaseType: "month_to_month",
      leaseStartDate: "2026-08-01",
      preferredChannels: ["email"]
    }),
    (error) => error.code === "LOCAL_VALIDATION_ERROR"
  );
});

test("tenant upload schema rejects permission fields and malformed contact data", async () => {
  const directory = await tenantFile({
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street",
    leaseType: "month_to_month",
    leaseStartDate: "2026-08-01",
    email: "not-an-email",
    emailContactStatus: "allowed"
  });
  const client = { request: async () => assert.fail("invalid input must not reach the API") };

  await assert.rejects(
    run(
      ["tenants", "upload", "--operation-id", operationId, "--input", "tenant.json"],
      { TINGTING_INPUT_DIRECTORY: directory },
      { client }
    ),
    (error) =>
      error.code === "LOCAL_VALIDATION_ERROR" &&
      /emailContactStatus is not allowed/.test(error.message) &&
      /email address/.test(error.message)
  );
});

test("input access fails closed when the dedicated directory is not configured", async () => {
  const client = { request: async () => assert.fail("missing input root must not reach the API") };
  await assert.rejects(
    run(
      ["tenants", "upload", "--operation-id", operationId, "--input", "tenant.json"],
      {},
      { client }
    ),
    (error) => error.code === "INPUT_DIRECTORY_REQUIRED"
  );
});

test("input access rejects a symlink that escapes the dedicated directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tingting-tenant-root-"));
  const outside = await mkdtemp(join(tmpdir(), "tingting-tenant-outside-"));
  temporaryDirectories.push(directory, outside);
  await writeFile(join(outside, "tenant.json"), JSON.stringify({
    fullName: "Jane Chen",
    propertyLabel: "123 Main Street"
  }));
  await symlink(join(outside, "tenant.json"), join(directory, "tenant.json"));
  const client = { request: async () => assert.fail("symlink escape must not reach the API") };

  await assert.rejects(
    run(
      ["tenants", "upload", "--operation-id", operationId, "--input", "tenant.json"],
      { TINGTING_INPUT_DIRECTORY: directory },
      { client }
    ),
    /outside TINGTING_INPUT_DIRECTORY/
  );
});

test("low-level tenant and retired schedule mutation commands are not exposed", async () => {
  await assert.rejects(
    run(["tenants", "create", "--operation-id", operationId, "--input", "tenant.json"]),
    /Unknown command/
  );
  await assert.rejects(
    run(["schedules", "save-disabled", "--tenant-id", operationId, "--operation-id", operationId, "--input", "schedule.json"]),
    /Unknown command/
  );
});
