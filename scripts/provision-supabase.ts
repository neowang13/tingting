import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { demoSections } from "../src/data/demo";
import { validateSection } from "../src/features/content/schemas";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminUserId = process.env.ADMIN_USER_ID;
const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || "Ting Ting Xu";
const draftBucket = process.env.SUPABASE_STORAGE_DRAFT_BUCKET || "site-media-drafts";
const publicBucket = process.env.SUPABASE_STORAGE_PUBLIC_BUCKET || "site-media";
const applicationBucket = process.env.APPLICATION_UPLOAD_BUCKET || "client-applications";
const clientUserId = process.env.CLIENT_USER_ID;
const clientDisplayName = process.env.CLIENT_DISPLAY_NAME || "Rental Applicant";
const clientRentalSlug = process.env.CLIENT_APPLICATION_RENTAL_SLUG;

if (!url || !serviceRoleKey || !adminUserId) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ADMIN_USER_ID are required."
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function fail(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function ensureBucket(
  id: string,
  isPublic: boolean,
  options: { fileSizeLimit?: number; allowedMimeTypes?: string[] } = {}
) {
  const { data, error } = await supabase.storage.getBucket(id);
  if (data) return;
  if (error && !error.message.toLowerCase().includes("not found")) {
    fail(error, `Read bucket ${id}`);
  }
  const created = await supabase.storage.createBucket(id, {
    public: isPublic,
    fileSizeLimit: options.fileSizeLimit ?? 8 * 1024 * 1024,
    allowedMimeTypes: options.allowedMimeTypes ?? ["image/jpeg", "image/png", "image/webp", "image/avif"]
  });
  fail(created.error, `Create bucket ${id}`);
}

export async function provisionSupabase() {
  const profile = await supabase.from("admin_profiles").upsert(
    { user_id: adminUserId, display_name: adminDisplayName, is_active: true },
    { onConflict: "user_id" }
  );
  fail(profile.error, "Provision administrator profile");

  const existingResult = await supabase.from("site_sections").select("key");
  fail(existingResult.error, "Read fixed site sections");
  const existingKeys = new Set((existingResult.data ?? []).map((row) => row.key));

  for (const [sortOrder, section] of demoSections.entries()) {
    if (existingKeys.has(section.key)) continue;
    const content = validateSection(section.key, section.publishedContent);
    const inserted = await supabase
      .from("site_sections")
      .insert({
        key: section.key,
        display_name: section.displayName,
        sort_order: sortOrder + 1,
        schema_version: section.schemaVersion,
        draft_content: content,
        published_content: content,
        updated_by: adminUserId,
        published_at: new Date().toISOString()
      })
      .select("key")
      .single();
    fail(inserted.error, `Create section ${section.key}`);

    const revision = await supabase
      .from("site_section_revisions")
      .insert({
        section_key: section.key,
        schema_version: section.schemaVersion,
        content,
        created_by: adminUserId
      })
      .select("id")
      .single();
    fail(revision.error, `Create initial revision for ${section.key}`);

    const linked = await supabase
      .from("site_sections")
      .update({ published_revision_id: revision.data!.id })
      .eq("key", section.key);
    fail(linked.error, `Link initial revision for ${section.key}`);
  }

  const templates = [
    {
      name: "Monthly rent reminder",
      channel: "email",
      subjectTemplate: "Rent reminder for {{property}}",
      bodyTemplate: "Hi {{tenant_name}}, this is a reminder that rent is due on {{due_date}}.",
      isActive: false
    },
    {
      name: "Monthly rent reminder",
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi {{tenant_name}}, a reminder that rent for {{property}} is due on {{due_date}}.",
      isActive: false
    }
  ] as const;

  for (const template of templates) {
    const existing = await supabase
      .from("notification_templates")
      .select("id")
      .eq("name", template.name)
      .eq("channel", template.channel)
      .maybeSingle();
    fail(existing.error, `Read ${template.channel} template`);
    if (existing.data) continue;
    const created = await supabase.rpc("save_notification_template", {
      p_id: null,
      p_payload: template,
      p_expected_updated_at: null,
      p_actor_id: adminUserId
    });
    fail(created.error, `Create disabled ${template.channel} template`);
  }

  const pause = await supabase.from("system_settings").upsert({
    key: "reminders",
    value: { paused: true, pausedAt: new Date().toISOString(), pausedBy: adminUserId },
    updated_by: adminUserId,
    updated_at: new Date().toISOString()
  });
  fail(pause.error, "Force reminders into paused state");

  await ensureBucket(draftBucket, false);
  await ensureBucket(publicBucket, true);
  await ensureBucket(applicationBucket, false, {
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"]
  });

  if (clientUserId) {
    const clientProfile = await supabase.from("client_profiles").upsert(
      { user_id: clientUserId, display_name: clientDisplayName, is_active: true },
      { onConflict: "user_id" }
    );
    fail(clientProfile.error, "Provision client profile");

    if (clientRentalSlug) {
      const [rental, form, terms] = await Promise.all([
        supabase.from("rental_listings").select("id,title,address_line,city").eq("slug", clientRentalSlug).maybeSingle(),
        supabase.from("application_form_versions").select("id,legal_review_status").eq("form_key", "residential-rental-application").eq("is_active", true).maybeSingle(),
        supabase.from("application_terms_versions").select("id,legal_review_status").eq("is_active", true).maybeSingle()
      ]);
      fail(rental.error, "Read client application rental");
      fail(form.error, "Read active application form");
      fail(terms.error, "Read active application terms");
      if (!rental.data || !form.data || !terms.data) throw new Error("Client application assignment source is missing.");
      if (form.data.legal_review_status !== "approved" || terms.data.legal_review_status !== "approved") {
        throw new Error("Client application form and terms require legal/privacy approval before assignment.");
      }
      const existing = await supabase.from("client_applications").select("id")
        .eq("owner_user_id", clientUserId).eq("rental_listing_id", rental.data.id).is("deleted_at", null).maybeSingle();
      fail(existing.error, "Read existing client application assignment");
      if (!existing.data) {
        const assignment = await supabase.from("client_applications").insert({
          owner_user_id: clientUserId,
          rental_listing_id: rental.data.id,
          property_title: rental.data.title,
          property_address: `${rental.data.address_line}, ${rental.data.city}`,
          form_version_id: form.data.id,
          terms_version_id: terms.data.id
        });
        fail(assignment.error, "Create client application assignment");
      }
    }
  }

  console.log("Supabase provisioning complete. Reminders and templates remain disabled; application assignment requires approved legal/privacy versions.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void provisionSupabase().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
