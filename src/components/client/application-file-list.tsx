"use client";

import type { ApplicationFileRecord } from "@/features/applications/contracts";

export function ApplicationFileList({ files, busy, remove }: {
  files: ApplicationFileRecord[];
  busy: boolean;
  remove: (file: ApplicationFileRecord) => Promise<void>;
}) {
  if (!files.length) return null;
  return <ul className="application-file-list">{files.map(file => <li key={file.id}>
    <span className="application-file-details"><span>{file.originalFilename}</span><small>{Math.ceil(file.byteSize / 1024)} KB · {file.scanStatus.replaceAll("_", " ")}</small></span>
    <button className="button secondary application-file-remove" type="button" disabled={busy} aria-label={`Remove ${file.originalFilename}`} onClick={() => {
      if (window.confirm(`Remove "${file.originalFilename}" from your application? You can upload a replacement before signing.`)) void remove(file);
    }}>Remove</button>
  </li>)}</ul>;
}
