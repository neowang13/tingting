"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MediaLibrary } from "@/components/admin/media-library";
import { sectionAdminCopy } from "@/features/content/admin-copy";
import {
  serviceIconKeys,
  type RentalManagementType,
  type ServiceMediaReference,
  type ServicePageCard,
  type ServicePageContent
} from "@/features/content/service-pages";
import { validateSection } from "@/features/content/schemas";
import type {
  MediaAsset,
  SectionRevision,
  ServicePageSectionKey,
  SiteSection
} from "@/lib/contracts";

type EditorTab = "hero" | "management" | "services" | "highlight" | "story" | "gallery" | "cta";
type Path = Array<string | number>;
type JsonObject = Record<string, unknown>;

const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "hero", label: "Hero" },
  { id: "management", label: "Management types" },
  { id: "services", label: "Core services" },
  { id: "highlight", label: "Highlight" },
  { id: "story", label: "Why choose us" },
  { id: "gallery", label: "Gallery" },
  { id: "cta", label: "Final call to action" }
];

function ManagementTypeEditor({
  managementType,
  index,
  onChange
}: {
  managementType: RentalManagementType;
  index: number;
  onChange: (path: Path, value: unknown) => void;
}) {
  const path: Path = ["managementTypes", index];
  return (
    <fieldset className="service-card-editor rental-management-editor">
      <legend>{managementType.title}</legend>
      <Field label="Title" value={managementType.title} maxLength={80} onChange={(value) => onChange([...path, "title"], value)} />
      <Field label="Summary" value={managementType.summary} maxLength={500} multiline onChange={(value) => onChange([...path, "summary"], value)} />
      {managementType.tasks.map((task, taskIndex) => (
        <Field
          label={`Management task ${taskIndex + 1}`}
          value={task}
          maxLength={500}
          multiline
          onChange={(value) => onChange([...path, "tasks", taskIndex], value)}
          key={taskIndex}
        />
      ))}
      <Field label="Intake facts" value={managementType.intake} maxLength={500} multiline onChange={(value) => onChange([...path, "intake"], value)} />
      <Field label="Framework and exclusions" value={managementType.framework} maxLength={500} multiline onChange={(value) => onChange([...path, "framework"], value)} />
      <Field label="Escalation path" value={managementType.escalation} maxLength={500} multiline onChange={(value) => onChange([...path, "escalation"], value)} />
    </fieldset>
  );
}

function updateAtPath(value: unknown, path: Path, nextValue: unknown): unknown {
  if (path.length === 0) return nextValue;
  const [head, ...tail] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(head)] = updateAtPath(copy[Number(head)], tail, nextValue);
    return copy;
  }
  const object = { ...(value as JsonObject) };
  object[String(head)] = updateAtPath(object[String(head)], tail, nextValue);
  return object;
}

function Field({
  label,
  value,
  onChange,
  help,
  multiline = false,
  maxLength
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={value.length > 150 ? 4 : 3}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {help && <small>{help}</small>}
    </label>
  );
}

function MediaReferenceEditor({
  label,
  reference,
  path,
  media,
  onChange
}: {
  label: string;
  reference: ServiceMediaReference;
  path: Path;
  media: MediaAsset[];
  onChange: (path: Path, value: unknown) => void;
}) {
  const selected = media.find((asset) => asset.id === reference.mediaAssetId);
  const previewUrl = selected?.previewUrl ?? selected?.publicUrl;
  return (
    <div className="service-media-field">
      <span className="service-editor-label">{label}</span>
      <div className="service-media-row">
        <div
          className="service-media-preview"
          style={previewUrl ? { backgroundImage: `url("${previewUrl}")` } : undefined}
          aria-hidden
        />
        <div className="service-media-controls">
          <label className="field">
            <span>Image file</span>
            <select
              value={reference.mediaAssetId}
              onChange={(event) => onChange([...path, "mediaAssetId"], event.target.value)}
            >
              {!selected && (
                <option value={reference.mediaAssetId}>Current published image</option>
              )}
              {media.map((asset) => (
                <option value={asset.id} key={asset.id}>
                  {asset.originalFilename} · {asset.state}
                </option>
              ))}
            </select>
          </label>
          <small>
            {selected
              ? `${selected.originalFilename} · ${selected.width}×${selected.height} · ${selected.state}`
              : "Current seeded website image"}
          </small>
        </div>
      </div>
      <Field
        label="Image description"
        value={reference.alt}
        maxLength={160}
        help="Up to 160 characters — read by screen readers"
        onChange={(value) => onChange([...path, "alt"], value)}
      />
    </div>
  );
}

function CardEditor({
  card,
  index,
  count,
  kind,
  path,
  media,
  onChange
}: {
  card: ServicePageCard;
  index: number;
  count: number;
  kind: "Core service" | "Benefit" | "Gallery item";
  path: Path;
  media: MediaAsset[];
  onChange: (path: Path, value: unknown) => void;
}) {
  return (
    <fieldset className="service-card-editor">
      <legend>{kind} {index + 1}{kind === "Core service" ? ` of ${count}` : ""}</legend>
      <Field
        label="Title"
        value={card.title}
        maxLength={80}
        onChange={(value) => onChange([...path, "title"], value)}
      />
      <Field
        label="Supporting text"
        value={card.body}
        maxLength={240}
        multiline
        onChange={(value) => onChange([...path, "body"], value)}
      />
      <label className="field">
        <span>Icon</span>
        <select
          value={card.icon}
          onChange={(event) => onChange([...path, "icon"], event.target.value)}
        >
          {serviceIconKeys.map((icon) => (
            <option value={icon} key={icon}>{icon}</option>
          ))}
        </select>
      </label>
      {card.image && (
        <MediaReferenceEditor
          label="Card image"
          reference={card.image}
          path={[...path, "image"]}
          media={media}
          onChange={onChange}
        />
      )}
    </fieldset>
  );
}

export function ServicePageEditor({
  initialSection,
  initialRevisions,
  initialMedia
}: {
  initialSection: SiteSection & { key: ServicePageSectionKey };
  initialRevisions: SectionRevision[];
  initialMedia: MediaAsset[];
}) {
  const [section, setSection] = useState(initialSection);
  const [draft, setDraft] = useState(
    validateSection(initialSection.key, initialSection.draftContent) as ServicePageContent
  );
  const [revisions, setRevisions] = useState(initialRevisions);
  const [selectedRevision, setSelectedRevision] = useState(initialRevisions[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<EditorTab>("hero");
  const [message, setMessage] = useState("No unsaved changes");
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState(initialMedia);
  const visibleEditorTabs = editorTabs.filter(
    (tab) => tab.id !== "management" || section.key === "service_rental_management"
  );
  const validation = useMemo(() => {
    try {
      validateSection(section.key, draft);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Review the fields that need attention.";
    }
  }, [draft, section.key]);
  const publicLocation = sectionAdminCopy[section.key].publicLocation;
  const normalizedPublished = useMemo(
    () => validateSection(section.key, section.publishedContent) as ServicePageContent,
    [section.key, section.publishedContent]
  );
  const draftIsNewer = JSON.stringify(draft) !== JSON.stringify(normalizedPublished);

  function change(path: Path, value: unknown) {
    setDraft((current) => updateAtPath(current, path, value) as ServicePageContent);
    setMessage("Unsaved changes");
  }

  async function refreshRevisions() {
    const response = await fetch(`/api/admin/sections/${section.key}/revisions`);
    const result = await response.json();
    if (result.success) {
      setRevisions(result.data);
      setSelectedRevision(result.data[0]?.id ?? "");
    }
  }

  async function saveDraft(): Promise<SiteSection | null> {
    setBusy(true);
    setMessage("Saving draft…");
    try {
      const response = await fetch(`/api/admin/sections/${section.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draft, expectedVersion: section.updatedAt })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message ?? "Draft could not be saved.");
      }
      setSection(result.data);
      setDraft(validateSection(section.key, result.data.draftContent) as ServicePageContent);
      setMessage("Draft saved privately");
      return result.data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Draft could not be saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndPreview() {
    const preview = window.open("", "_blank");
    const saved = await saveDraft();
    if (saved && preview) {
      preview.location.href = `/admin/preview/${section.key}`;
    } else {
      preview?.close();
    }
  }

  async function publish() {
    setBusy(true);
    setMessage("Saving and publishing…");
    try {
      const saveResponse = await fetch(`/api/admin/sections/${section.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draft, expectedVersion: section.updatedAt })
      });
      const saveResult = await saveResponse.json();
      if (!saveResponse.ok || !saveResult.success) {
        throw new Error(saveResult.error?.message ?? "Draft could not be saved.");
      }
      const publishResponse = await fetch(`/api/admin/sections/${section.key}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: saveResult.data.updatedAt })
      });
      const publishResult = await publishResponse.json();
      if (!publishResponse.ok || !publishResult.success) {
        throw new Error(publishResult.error?.message ?? "Content could not be published.");
      }
      setSection(publishResult.data);
      setDraft(validateSection(section.key, publishResult.data.draftContent) as ServicePageContent);
      await refreshRevisions();
      setMessage("Published. The public website now shows these changes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Content could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreRevision() {
    if (!selectedRevision) return;
    setBusy(true);
    setMessage("Restoring and publishing the selected version…");
    try {
      const response = await fetch(`/api/admin/sections/${section.key}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revisionId: selectedRevision,
          expectedVersion: section.updatedAt
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message ?? "Version could not be restored.");
      }
      setSection(result.data);
      setDraft(validateSection(section.key, result.data.draftContent) as ServicePageContent);
      await refreshRevisions();
      setMessage("The selected version is restored and live on the website.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Version could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="service-content-editor">
      <div className="service-editor-breadcrumb">
        <Link href="/admin/content">Website content</Link> / Service pages / {sectionAdminCopy[section.key].title}
      </div>
      <div className="service-editor-heading">
        <div>
          <h2>{sectionAdminCopy[section.key].title}</h2>
          <p>
            {publicLocation} ·{" "}
            {draftIsNewer
              ? "Your saved draft is newer than the live website."
              : section.publishedAt
                ? "This saved version is live on the website."
                : "This page has not been published yet."}
          </p>
        </div>
        <Link className="text-link" href={publicLocation} target="_blank">Open live page ↗</Link>
      </div>

      <div className="service-editor-grid">
        <nav className="service-editor-nav" aria-label="Service page sections">
          {visibleEditorTabs.map((tab) => (
            <button
              className={activeTab === tab.id ? "active" : ""}
              type="button"
              aria-current={activeTab === tab.id ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              key={tab.id}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className="service-editor-panel">
          {activeTab === "hero" && (
            <>
              <h2>Hero</h2>
              <div className="service-editor-form">
                <Field label="Small heading" value={draft.eyebrow} maxLength={80} help="Up to 80 characters" onChange={(value) => change(["eyebrow"], value)} />
                <Field label="Main heading" value={draft.title} maxLength={120} help="Up to 120 characters" multiline onChange={(value) => change(["title"], value)} />
                <Field label="Supporting text" value={draft.description} maxLength={500} help="Up to 500 characters" multiline onChange={(value) => change(["description"], value)} />
                <div className="service-editor-note">The Contact us and Call buttons are shared across all service pages and cannot be changed here.</div>
                <MediaReferenceEditor label="Hero image" reference={draft.heroImage} path={["heroImage"]} media={media} onChange={change} />
                <label className="field service-focal-field">
                  <span>Image focal point</span>
                  <select value={draft.heroPosition} onChange={(event) => change(["heroPosition"], event.target.value)}>
                    {!["center center", "center top", "center bottom", "left center", "right center"].includes(draft.heroPosition) && (
                      <option value={draft.heroPosition}>{draft.heroPosition}</option>
                    )}
                    <option value="center center">Centre</option>
                    <option value="center top">Top</option>
                    <option value="center bottom">Bottom</option>
                    <option value="left center">Left</option>
                    <option value="right center">Right</option>
                  </select>
                </label>
              </div>
            </>
          )}

          {activeTab === "management" && draft.managementTypes && (
            <>
              <h2>Residential and commercial management</h2>
              <p className="service-editor-panel-intro">
                Keep the tasks, intake facts, governing framework, exclusions, and escalation path specific to each property context.
              </p>
              <div className="service-editor-form service-editor-section-fields">
                <Field label="Small heading" value={draft.managementTypesEyebrow ?? ""} maxLength={80} onChange={(value) => change(["managementTypesEyebrow"], value)} />
                <Field label="Section heading" value={draft.managementTypesTitle ?? ""} maxLength={120} onChange={(value) => change(["managementTypesTitle"], value)} />
              </div>
              <div className="service-card-editor-grid rental-management-editor-grid">
                {draft.managementTypes.map((managementType, index) => (
                  <ManagementTypeEditor
                    managementType={managementType}
                    index={index}
                    onChange={change}
                    key={`${index}-${managementType.title}`}
                  />
                ))}
              </div>
            </>
          )}

          {activeTab === "services" && (
            <>
              <h2>Core services</h2>
              <div className="service-editor-form service-editor-section-fields">
                <Field label="Small heading" value={draft.servicesEyebrow} maxLength={80} onChange={(value) => change(["servicesEyebrow"], value)} />
                <Field label="Section heading" value={draft.servicesTitle} maxLength={120} onChange={(value) => change(["servicesTitle"], value)} />
              </div>
              <div className="service-editor-count">{draft.services.length} of {draft.services.length} services</div>
              <div className="service-card-editor-grid">
                {draft.services.map((card, index) => (
                  <CardEditor
                    card={card}
                    index={index}
                    count={draft.services.length}
                    kind="Core service"
                    path={["services", index]}
                    media={media}
                    onChange={change}
                    key={`${index}-${card.title}`}
                  />
                ))}
              </div>
            </>
          )}

          {activeTab === "highlight" && (
            <>
              <h2>Highlight</h2>
              <div className="service-editor-form">
                <Field label="Highlight title" value={draft.highlightTitle} maxLength={80} onChange={(value) => change(["highlightTitle"], value)} />
                <Field label="Highlight text" value={draft.highlightBody} maxLength={240} multiline onChange={(value) => change(["highlightBody"], value)} />
                <div className="service-editor-note">The Request service button opens the shared contact form.</div>
              </div>
            </>
          )}

          {activeTab === "story" && (
            <>
              <h2>Why choose us</h2>
              <div className="service-editor-form service-editor-section-fields">
                <Field label="Small heading" value={draft.storyEyebrow} maxLength={80} onChange={(value) => change(["storyEyebrow"], value)} />
                <Field label="Main heading" value={draft.storyTitle} maxLength={120} onChange={(value) => change(["storyTitle"], value)} />
                <Field label="Supporting text" value={draft.storyBody} maxLength={500} multiline onChange={(value) => change(["storyBody"], value)} />
                <MediaReferenceEditor label="Why choose us image" reference={draft.storyImage} path={["storyImage"]} media={media} onChange={change} />
              </div>
              <div className="service-editor-count">Benefits — {draft.benefits.length} of {draft.benefits.length}</div>
              <div className="service-card-editor-grid">
                {draft.benefits.map((card, index) => (
                  <CardEditor
                    card={card}
                    index={index}
                    count={draft.benefits.length}
                    kind="Benefit"
                    path={["benefits", index]}
                    media={media}
                    onChange={change}
                    key={`${index}-${card.title}`}
                  />
                ))}
              </div>
            </>
          )}

          {activeTab === "gallery" && (
            <>
              <h2>Gallery</h2>
              <p className="service-editor-panel-intro">
                {draft.gallery.length} items on this page (locked by the {sectionAdminCopy[section.key].title} page template)
              </p>
              <div className="service-editor-form service-editor-section-fields">
                <Field label="Small heading" value={draft.galleryEyebrow} maxLength={80} onChange={(value) => change(["galleryEyebrow"], value)} />
                <Field label="Section heading" value={draft.galleryTitle} maxLength={120} onChange={(value) => change(["galleryTitle"], value)} />
              </div>
              <div className="service-gallery-editor-grid">
                {draft.gallery.map((card, index) => (
                  <CardEditor
                    card={card}
                    index={index}
                    count={draft.gallery.length}
                    kind="Gallery item"
                    path={["gallery", index]}
                    media={media}
                    onChange={change}
                    key={`${index}-${card.title}`}
                  />
                ))}
              </div>
            </>
          )}

          {activeTab === "cta" && (
            <>
              <h2>Final call to action</h2>
              <div className="service-editor-form">
                <Field label="CTA heading" value={draft.ctaTitle} maxLength={120} onChange={(value) => change(["ctaTitle"], value)} />
                <Field label="CTA supporting text" value={draft.ctaBody} maxLength={240} multiline onChange={(value) => change(["ctaBody"], value)} />
                <div className="service-editor-note">This section always shows Contact us and the shared public phone number.</div>
              </div>
            </>
          )}
        </section>

        <aside className="service-editor-aside">
          <section>
            <h2>Page status</h2>
            {validation ? (
              <>
                <strong className="service-page-status error">This page cannot be published yet.</strong>
                <p>Review the field that needs attention in the editor.</p>
              </>
            ) : draftIsNewer ? (
              <>
                <strong className="service-page-status waiting">Saved draft</strong>
                <p>This draft is newer than the live website.</p>
              </>
            ) : (
              <>
                <strong className="service-page-status live">
                  {section.publishedAt ? "Live on website" : "Ready to publish"}
                </strong>
                <p>{section.publishedAt ? "There are no unpublished changes." : "All required fields are complete."}</p>
              </>
            )}
          </section>
          <section>
            <h2>Version history</h2>
            {revisions.length ? (
              <>
                <div className="service-version-list">
                  {revisions.slice(0, 2).map((revision, index) => (
                    <div key={revision.id}>
                      <strong>Version {revisions.length - index}</strong>
                      {index === 0 && section.publishedAt ? " · Currently live" : ""}
                      <small>Published {new Date(revision.createdAt).toLocaleString()}</small>
                    </div>
                  ))}
                </div>
                <label className="field">
                  <span>Choose a previous version</span>
                  <select value={selectedRevision} onChange={(event) => setSelectedRevision(event.target.value)}>
                    {revisions.map((revision, index) => (
                      <option value={revision.id} key={revision.id}>
                        Version {revisions.length - index} · {new Date(revision.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="service-restore-button"
                  disabled={busy || !selectedRevision}
                  type="button"
                  onClick={() => {
                    if (window.confirm("Restore this version and publish it? The current content remains in history.")) {
                      void restoreRevision();
                    }
                  }}
                >
                  Restore selected version
                </button>
              </>
            ) : (
              <p>No published versions yet.</p>
            )}
          </section>
        </aside>
      </div>

      <div className="service-editor-action-bar">
        <span className={message.includes("Published.") ? "live" : ""} aria-live="polite">{message}</span>
        <div>
          <button className="button secondary" disabled={busy || Boolean(validation)} type="button" onClick={() => void saveDraft()}>
            Save draft
          </button>
          <button className="button secondary" disabled={busy || Boolean(validation)} type="button" onClick={() => void saveAndPreview()}>
            Save and preview
          </button>
          <button
            className="button"
            disabled={busy || Boolean(validation)}
            type="button"
            onClick={() => {
              if (window.confirm("Save and publish the current content to the public website?")) {
                void publish();
              }
            }}
          >
            Publish to website
          </button>
        </div>
      </div>

      <MediaLibrary
        assets={media}
        onAssetsChanged={setMedia}
        summaryLabel={`Upload or manage page images · ${media.length} available assets`}
      />
    </div>
  );
}
