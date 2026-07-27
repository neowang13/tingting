import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const integration = url && anonKey ? describe : describe.skip;

integration("Supabase anonymous RLS boundaries", () => {
  const client = createClient(
    url ?? "http://127.0.0.1:54321",
    anonKey ?? "integration-test-placeholder",
    { auth: { persistSession: false } }
  );

  for (const table of [
    "site_sections",
    "site_section_revisions",
    "media_assets",
    "rental_properties",
    "rental_amenities",
    "rental_listing_amenities",
    "rental_utilities",
    "rental_listing_utilities",
    "rental_listing_fees",
    "tenants",
    "reminder_schedules",
    "notification_events",
    "audit_events",
    "automation_service_accounts",
    "automation_service_account_tokens",
    "automation_idempotency_keys",
    "automation_confirmation_intents",
    "automation_jobs",
    "tenant_imports",
    "tenant_import_rows",
    "tenant_contact_permission_events"
  ]) {
    it(`blocks anonymous reads from ${table}`, async () => {
      const { error } = await client.from(table).select("*").limit(1);
      expect(error).not.toBeNull();
    });
  }

  it("allows the explicit published projections", async () => {
    const site = await client.from("public_site_sections").select("key,schema_version,published_content,published_at").limit(1);
    const rentals = await client.from("public_rental_listings").select("id,slug,title").limit(1);
    const rentalsV2 = await client
      .from("public_rental_listings_v2")
      .select("id,slug,title,property,amenity_codes,included_utility_codes,fees")
      .limit(1);
    expect(site.error).toBeNull();
    expect(rentals.error).toBeNull();
    expect(rentalsV2.error).toBeNull();
  });
});
