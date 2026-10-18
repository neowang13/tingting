"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { ApplicationFileRecord } from "@/features/applications/contracts";

async function readFiles(endpoint: string, signal?: AbortSignal) {
  const response = await fetch(endpoint, { cache: "no-store", signal });
  if (!response.ok) throw new Error("File list could not be synchronized.");
  const body = await response.json() as { data?: { files?: ApplicationFileRecord[] } };
  if (!Array.isArray(body.data?.files)) throw new Error("File list unavailable.");
  return body.data.files;
}

export async function removeAndReconcileFile(endpoint: string, fileId: string) {
  let error = "The file removal could not be confirmed. Reconnect and try again.";
  try {
    const response = await fetch(`${endpoint}/${fileId}`, { method: "DELETE" });
    if (response.ok) return { removed: true };
    const body = await response.json() as { error?: { message?: string } };
    error = body.error?.message || error;
  } catch { /* A lost response does not mean the deletion failed. */ }
  try {
    const files = await readFiles(endpoint);
    return { removed: !files.some(file => file.id === fileId), files, error };
  } catch { return { removed: false, error }; }
}

// Synchronize attachment state only. Unsaved form answers remain untouched.
export function useApplicationFileSync(endpoint: string, paused: boolean, setFiles: Dispatch<SetStateAction<ApplicationFileRecord[]>>) {
  useEffect(() => {
    if (paused) return;
    let active = true;
    let controller: AbortController | undefined;
    async function sync() {
      controller?.abort();
      const request = new AbortController(); controller = request;
      try {
        const files = await readFiles(endpoint, request.signal);
        if (active && !request.signal.aborted) setFiles(files);
      } catch { /* Offline reads keep current files; the next reconnect retries. */ }
    }
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    return () => {
      active = false; controller?.abort();
      window.removeEventListener("online", sync); window.removeEventListener("focus", sync);
    };
  }, [endpoint, paused, setFiles]);
}
