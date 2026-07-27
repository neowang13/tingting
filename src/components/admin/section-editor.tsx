"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { validateSection } from "@/features/content/schemas";
import type { MediaAsset, SectionRevision, SiteSection } from "@/lib/contracts";
import { MediaLibrary } from "@/components/admin/media-library";
import { contentFieldLabel, sectionAdminCopy } from "@/features/content/admin-copy";

type JsonObject = Record<string, unknown>;
type Path = Array<string | number>;

const multilineNames = new Set([
  "body",
  "summary",
  "description",
  "processBody",
  "successMessage",
  "errorMessage"
]);

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

function removeAtPath(value: unknown, path: Path): unknown {
  const parentPath = path.slice(0, -1);
  const index = Number(path.at(-1));
  const parent = getAtPath(value, parentPath);
  if (!Array.isArray(parent)) return value;
  return updateAtPath(value, parentPath, parent.filter((_, itemIndex) => itemIndex !== index));
}

function getAtPath(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((current, part) => {
    if (Array.isArray(current)) return current[Number(part)];
    if (current && typeof current === "object") return (current as JsonObject)[String(part)];
    return undefined;
  }, value);
}

export function SectionEditor({
  initialSection,
  initialRevisions,
  initialMedia
}: {
  initialSection: SiteSection;
  initialRevisions: SectionRevision[];
  initialMedia: MediaAsset[];
}) {
  const [section, setSection] = useState(initialSection);
  const [draft, setDraft] = useState<unknown>(initialSection.draftContent);
  const [revisions, setRevisions] = useState(initialRevisions);
  const [selectedRevision, setSelectedRevision] = useState(initialRevisions[0]?.id ?? "");
  const [message, setMessage] = useState("No unsaved changes. Saving will not change the live website.");
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState(initialMedia);
  const validation = useMemo(() => {
    try {
      validateSection(section.key, draft);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Review the highlighted content fields.";
    }
  }, [draft, section.key]);

  function change(path: Path, value: unknown) {
    setDraft((current: unknown) => updateAtPath(current, path, value));
    setMessage("You have unsaved changes. Visitors cannot see them.");
  }

  async function refreshRevisions() {
    const revisionResponse = await fetch(`/api/admin/sections/${section.key}/revisions`);
    const revisionResult = await revisionResponse.json();
    if (revisionResult.success) {
      setRevisions(revisionResult.data);
      setSelectedRevision(revisionResult.data[0]?.id ?? "");
    }
  }

  async function request(path: string, method: "PATCH" | "POST", body: unknown) {
    setBusy(true);
    setMessage("Saving your website changes…");
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Request failed.");
      setSection(result.data);
      setDraft(result.data.draftContent);
      await refreshRevisions();
      setMessage(
        path.endsWith("/publish")
          ? "Published. Visitors can now see this version."
          : path.endsWith("/rollback")
            ? "The selected version is restored and live on the website."
            : "Saved privately. The live website has not changed."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publishCurrentDraft() {
    setBusy(true);
    setMessage("Saving and publishing to the website…");
    try {
      const saveResponse = await fetch(`/api/admin/sections/${section.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: draft,
          expectedVersion: section.updatedAt
        })
      });
      const saveResult = await saveResponse.json();
      if (!saveResponse.ok || !saveResult.success) {
        throw new Error(saveResult.error?.message ?? "Draft could not be saved.");
      }
      setSection(saveResult.data);
      setDraft(saveResult.data.draftContent);

      const publishResponse = await fetch(`/api/admin/sections/${section.key}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: saveResult.data.updatedAt
        })
      });
      const publishResult = await publishResponse.json();
      if (!publishResponse.ok || !publishResult.success) {
        throw new Error(publishResult.error?.message ?? "Content could not be published.");
      }

      setSection(publishResult.data);
      setDraft(publishResult.data.draftContent);
      await refreshRevisions();
      setMessage("Published. The public website now shows these changes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <MediaLibrary assets={media} onAssetsChanged={setMedia} />
      <div className="admin-editor-layout">
      <section className="card admin-editor" aria-labelledby="content-fields-heading">
        <div className="admin-card-heading">
          <div>
            <p className="eyebrow">EDIT WEBSITE SECTION</p>
            <h2 id="content-fields-heading">{sectionAdminCopy[section.key].title}</h2>
            <p>{sectionAdminCopy[section.key].description}</p>
          </div>
          <span className={`status ${section.publishedAt ? "published" : "draft"}`}>
            {section.publishedAt ? "Live on website" : "Not published"}
          </span>
        </div>

        <FieldTree
          value={draft}
          path={[]}
          name={section.displayName}
          onChange={change}
          onRemove={(path) => {
            setDraft((current: unknown) => removeAtPath(current, path));
            setMessage("You have unsaved changes. Visitors cannot see them.");
          }}
          media={media}
        />

        {validation && <p className="form-status error" role="alert">{validation}</p>}
        <div className="admin-action-bar">
          <button
            className="button secondary"
            disabled={busy || Boolean(validation)}
            type="button"
            onClick={() => void request(`/api/admin/sections/${section.key}`, "PATCH", {
              content: draft,
              expectedVersion: section.updatedAt
            })}
          >
            Save without publishing
          </button>
          <Link
            className="button secondary"
            href={`/admin/preview/${section.key}`}
            target="_blank"
          >
            Preview on website
          </Link>
          <button
            className="button"
            disabled={busy || Boolean(validation)}
            type="button"
            onClick={() => {
              if (window.confirm("Save and publish the current content to the public website?")) {
                void publishCurrentDraft();
              }
            }}
          >
            Publish to website
          </button>
        </div>
        <p className="admin-save-status" aria-live="polite">{message}</p>
      </section>

      <aside className="card revision-panel">
        <h2>Previously published versions</h2>
        <p>Every publish is kept here, so you can restore an earlier website version.</p>
        {revisions.length ? (
          <>
            <label className="field">
              <span>Choose a previous version</span>
              <select value={selectedRevision} onChange={(event) => setSelectedRevision(event.target.value)}>
                {revisions.map((revision) => (
                  <option value={revision.id} key={revision.id}>
                    {new Date(revision.createdAt).toLocaleString()} · v{revision.schemaVersion}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button danger-outline"
              disabled={busy || !selectedRevision}
              type="button"
              onClick={() => {
                if (window.confirm("Restore this version and publish it? The current content remains in history.")) {
                  void request(`/api/admin/sections/${section.key}/rollback`, "POST", {
                    revisionId: selectedRevision,
                    expectedVersion: section.updatedAt
                  });
                }
              }}
            >
              Restore and publish this version
            </button>
          </>
        ) : <p className="empty-copy">No published versions yet.</p>}
      </aside>
      </div>
    </>
  );
}

function FieldTree({
  value,
  path,
  name,
  onChange,
  onRemove,
  media
}: {
  value: unknown;
  path: Path;
  name: string | number;
  onChange: (path: Path, value: unknown) => void;
  onRemove: (path: Path) => void;
  media: MediaAsset[];
}) {
  if (Array.isArray(value)) {
    const stringList = value.every((item) => typeof item === "string");
    return (
      <fieldset className="field-group">
        <legend>{contentFieldLabel(name)}</legend>
        {value.map((item, index) => (
          stringList ? (
            <div className="repeatable-field" key={`${path.join(".")}-${index}`}>
              <label className="field">
                <span>{contentFieldLabel(index)}</span>
                <input
                  value={String(item)}
                  onChange={(event) => onChange([...path, index], event.target.value)}
                />
              </label>
              <button
                className="icon-text-button"
                type="button"
                onClick={() => onRemove([...path, index])}
              >
                Remove
              </button>
            </div>
          ) : (
            <FieldTree
              key={`${path.join(".")}-${index}`}
              value={item}
              path={[...path, index]}
              name={typeof item === "object" && item && "key" in item ? String((item as JsonObject).key) : index}
              onChange={onChange}
              onRemove={onRemove}
              media={media}
            />
          )
        ))}
        {stringList && (
          <button className="icon-text-button" type="button" onClick={() => onChange(path, [...value, ""])}>
            Add item
          </button>
        )}
      </fieldset>
    );
  }

  if (value && typeof value === "object") {
    return (
      <fieldset className={path.length ? "field-group nested" : "field-group root"}>
        {path.length > 0 && <legend>{contentFieldLabel(name)}</legend>}
        <div className="field-grid">
          {Object.entries(value as JsonObject).map(([key, child]) => (
            <FieldTree
              key={`${path.join(".")}.${key}`}
              value={child}
              path={[...path, key]}
              name={key}
              onChange={onChange}
              onRemove={onRemove}
              media={media}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  const key = String(name);
  const readOnly = key === "key";
  const multiline =
    multilineNames.has(key) ||
    key.toLocaleLowerCase().includes("paragraph") ||
    String(value ?? "").length > 120;

  if (key === "mediaAssetId") {
    return (
      <label className="field">
        <span>Media asset</span>
        <select value={String(value ?? "")} onChange={(event) => onChange(path, event.target.value)}>
          <option value="">Select an uploaded image</option>
          {typeof value === "string" && value && !media.some((asset) => asset.id === value) && (
            <option value={value}>Current seeded asset · {value}</option>
          )}
          {media.map((asset) => (
            <option value={asset.id} key={asset.id}>
              {asset.originalFilename} · {asset.state}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className={`field ${multiline ? "field-wide" : ""}`}>
      <span>{contentFieldLabel(name)}{readOnly && <small> Cannot be changed</small>}</span>
      {multiline ? (
        <textarea
          rows={4}
          value={String(value ?? "")}
          readOnly={readOnly}
          onChange={(event) => onChange(path, event.target.value)}
        />
      ) : (
        <input
          value={String(value ?? "")}
          readOnly={readOnly}
          onChange={(event) => onChange(path, event.target.value)}
        />
      )}
    </label>
  );
}
