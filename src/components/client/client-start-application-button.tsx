"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClientStartApplicationButton({ propertySlug }: { propertySlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div>
      <button className="button" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/client/applications/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ propertySlug })
          });
          const body = await response.json() as {
            data?: { applicationId?: string };
            error?: { message?: string };
          };
          if (!response.ok || !body.data?.applicationId) {
            throw new Error(body.error?.message || "The application could not be started.");
          }
          router.push(`/client/applications/${encodeURIComponent(body.data.applicationId)}`);
          router.refresh();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "The application could not be started.");
          setBusy(false);
        }
      }}>{busy ? "Opening application…" : "Start or continue application"}</button>
      {error && <p className="form-status error" role="alert">{error}</p>}
    </div>
  );
}
