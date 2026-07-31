import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { getAutomationRepository } from "@/data/automation-repository";
import type { AutomationScope } from "@/features/automation/contracts";
import { resetEnvironmentCache } from "@/lib/env";

const accountName = "OpenClaw Tenant Operations";
const projectEnvPath = resolve(process.cwd(), ".env.local");
const openClawEnvPath = join(homedir(), ".openclaw", ".env");
const openClawSecretPath = join(
  homedir(),
  ".openclaw",
  "secrets",
  "tingting-automation-token"
);
const rotateExisting = process.argv.includes("--rotate");
const scopes: AutomationScope[] = [
  "tenants:read",
  "tenants:write",
  "tenants:import",
  "permissions:grant",
  "jobs:read",
  "schedules:read",
  "payments:read",
  "payments:write"
];

function valueFor(text: string, key: string) {
  const line = text
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim() || undefined;
}

function withValues(text: string, values: Record<string, string>) {
  const pending = new Map(Object.entries(values));
  const lines = text.split(/\r?\n/).map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  if (lines.at(-1) === "") lines.pop();
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

function withoutValue(text: string, key: string) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(`${key}=`));
  while (lines.at(-1) === "") lines.pop();
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

async function readText(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function writePrivateFile(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

function requireUuid(value: string | undefined, name: string) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be configured as a UUID.`);
  }
  return value;
}

async function main() {
  const projectEnv = await readText(projectEnvPath);
  const pepper =
    valueFor(projectEnv, "AUTOMATION_TOKEN_PEPPER") ??
    randomBytes(32).toString("hex");
  const automationValues = {
    AUTOMATION_API_ENABLED: "true",
    AUTOMATION_MUTATIONS_ENABLED: "true",
    AUTOMATION_CONFIRMATIONS_ENABLED: "true",
    AUTOMATION_TENANT_IMPORT_ENABLED: "true",
    AUTOMATION_TOKEN_PEPPER: pepper
  };
  await writePrivateFile(projectEnvPath, withValues(projectEnv, automationValues));
  Object.assign(process.env, automationValues);
  resetEnvironmentCache();

  const delegatedAdminUserId = requireUuid(
    process.env.ADMIN_USER_ID,
    "ADMIN_USER_ID"
  );
  const repository = getAutomationRepository();
  const existing = (await repository.listServiceAccounts()).find(
    (account) => account.name === accountName
  );
  const expiresAt =
    existing?.expiresAt ??
    new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const openClawEnv = await readText(openClawEnvPath);
  const legacyToken = valueFor(openClawEnv, "TINGTING_AUTOMATION_TOKEN");
  const storedToken =
    (await readText(openClawSecretPath)).trim() || legacyToken;

  let account = existing;
  let token: string | undefined;
  let action: "created" | "updated" | "rotated";

  if (!account) {
    const created = await repository.createServiceAccount(
      {
        name: accountName,
        delegatedAdminUserId,
        scopes,
        expiresAt
      },
      delegatedAdminUserId
    );
    account = created.account;
    token = created.token;
    action = "created";
  } else {
    account = await repository.updateServiceAccount(
      account.id,
      {
        delegatedAdminUserId,
        scopes,
        isActive: true
      },
      delegatedAdminUserId
    );
    const hasActiveToken = account.tokens.some(
      (candidate) =>
        candidate.isActive &&
        !candidate.revokedAt &&
        (!candidate.expiresAt ||
          new Date(candidate.expiresAt).getTime() > Date.now())
    );
    if (rotateExisting || !storedToken || !hasActiveToken) {
      const rotated = await repository.rotateToken(
        account.id,
        {
          expiresAt: account.expiresAt,
          revokePreviousAfterHours: 0
        },
        delegatedAdminUserId
      );
      account = rotated.account;
      token = rotated.token;
      action = "rotated";
    } else {
      action = "updated";
    }
  }

  if (token) {
    await writePrivateFile(
      openClawSecretPath,
      `${token}\n`
    );
  } else if (storedToken) {
    await writePrivateFile(openClawSecretPath, `${storedToken}\n`);
  }
  if (legacyToken) {
    await writePrivateFile(
      openClawEnvPath,
      withoutValue(openClawEnv, "TINGTING_AUTOMATION_TOKEN")
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      success: true,
      action,
      accountId: account.id,
      accountName: account.name,
      scopes: account.scopes,
      expiresAt: account.expiresAt,
      projectEnvironmentUpdated: true,
      openClawSecretConfigured: Boolean(token || storedToken)
    })}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Configuration failed."
    })}\n`
  );
  process.exitCode = 1;
});
