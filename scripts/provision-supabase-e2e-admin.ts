import { createHmac } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Supabase returned an invalid TOTP secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, now = Date.now()) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function provision() {
  if (process.env.E2E_SUPABASE_TEST_PROJECT_CONFIRMED !== "true") {
    throw new Error("Refusing to provision an unconfirmed Supabase test project.");
  }

  const url = required("TEST_SUPABASE_URL");
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("This helper only provisions local Supabase. Provision hosted test users manually.");
  }

  const anonKey = required("TEST_SUPABASE_ANON_KEY");
  const serviceRoleKey = required("TEST_SUPABASE_SERVICE_ROLE_KEY");
  const email = required("TEST_ADMIN_EMAIL");
  const password = required("TEST_ADMIN_PASSWORD");
  const stateFile = required("E2E_STATE_FILE");

  const service = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const existing = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existing.error) throw existing.error;
  let user = existing.data.users.find((candidate) => candidate.email === email);
  if (!user) {
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("The local E2E administrator could not be created.");
    }
    user = created.data.user;
  }

  const profile = await service.from("admin_profiles").upsert({
    user_id: user.id,
    display_name: "Local E2E Admin",
    is_active: true
  });
  if (profile.error) throw profile.error;

  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    ADMIN_USER_ID: user.id,
    ADMIN_DISPLAY_NAME: "Local E2E Admin"
  });
  const { provisionSupabase } = await import("./provision-supabase");
  await provisionSupabase();

  const browser = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const signedIn = await browser.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const factors = await browser.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  if (factors.data.totp.some((factor) => factor.status === "verified")) {
    throw new Error(
      "The local E2E user already has a verified TOTP factor. Reset local Supabase before reprovisioning."
    );
  }

  const enrolled = await browser.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Local E2E"
  });
  if (enrolled.error || !enrolled.data.totp) {
    throw enrolled.error ?? new Error("TOTP enrollment failed.");
  }
  const verified = await browser.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: totp(enrolled.data.totp.secret)
  });
  if (verified.error) throw verified.error;

  await writeFile(
    stateFile,
    JSON.stringify({ userId: user.id, totpSecret: enrolled.data.totp.secret }),
    { encoding: "utf8", mode: 0o600 }
  );
  await chmod(stateFile, 0o600);
  console.log("Local Supabase E2E administrator and verified TOTP factor are ready.");
}

void provision().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
