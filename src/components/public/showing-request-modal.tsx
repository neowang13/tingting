"use client";

import { CalendarCheck, X } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import {
  SHOWING_MAX_DAYS_AHEAD,
  SHOWING_MIN_NOTICE_HOURS,
  SHOWING_TIMEZONE,
  showingDateBounds,
  showingTimeOptions
} from "@/features/showings/scheduling";

interface ShowingProperty {
  slug: string;
  title: string;
  addressLine: string;
  city: string;
}

const ShowingRequestContext = createContext<((trigger?: HTMLElement) => void) | null>(null);

export function ShowingRequestModalProvider({
  property,
  children
}: {
  property: ShowingProperty;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dateBounds = showingDateBounds();
  const applicationNext = `/client/applications?property=${encodeURIComponent(property.slug)}`;
  const applicationHref = `/client/login?property=${encodeURIComponent(property.slug)}&next=${encodeURIComponent(applicationNext)}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => nameRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function openShowingRequest(trigger?: HTMLElement) {
    triggerRef.current = trigger ?? null;
    setStatus(null);
    setOpen(true);
  }

  function close() {
    dialogRef.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setStatus(null);
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    if (data.get("website")) {
      setStatus({ type: "success", message: "Your showing has been requested. Ting Ting will contact you before the appointment is confirmed." });
      form.reset();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/public/showings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          propertySlug: property.slug,
          desiredMoveInDate: data.get("desiredMoveInDate"),
          requestedLocalDate: data.get("requestedLocalDate"),
          requestedLocalTime: data.get("requestedLocalTime"),
          timezone: SHOWING_TIMEZONE,
          notes: data.get("notes"),
          hasPets: data.get("hasPets") === "yes",
          needsParking: data.get("needsParking") === "yes",
          representationDisclosureAcknowledged: data.get("representationDisclosureAcknowledged") === "yes",
          consent: data.get("consent") === "yes",
          website: data.get("website")
        })
      });
      const body = await response.json() as {
        data?: { message?: string };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message || "Choose another available time and try again.");
      setStatus({
        type: "success",
        message: body.data?.message || "Your showing has been requested. Ting Ting will contact you before it is confirmed."
      });
      form.reset();
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "The request could not be sent. Choose another time or contact Ting Ting."
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShowingRequestContext.Provider value={openShowingRequest}>
      {children}
      <dialog
        ref={dialogRef}
        className="contact-dialog showing-dialog"
        aria-labelledby="showing-dialog-title"
        aria-describedby="showing-dialog-description"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="contact-dialog-panel showing-dialog-panel">
          <button className="dialog-close" type="button" aria-label="Close showing request form" onClick={close}>
            <X aria-hidden />
          </button>
          <div className="eyebrow">REQUEST A SHOWING</div>
          <h2 id="showing-dialog-title">Choose a time to view this home</h2>
          <p id="showing-dialog-description">
            Send your preferred time. This is a request—not a confirmed appointment. Ting Ting will contact you to accept it or arrange another time.
          </p>

          <div className="showing-property" aria-label="Selected property">
            <CalendarCheck aria-hidden />
            <div><strong>{property.title}</strong><span>{property.addressLine}, {property.city}</span></div>
          </div>

          <form className="contact-form showing-form" onSubmit={submit} noValidate>
            <div className="contact-form-grid">
              <div className="field">
                <label htmlFor="showing-name">Name *</label>
                <input ref={nameRef} id="showing-name" name="name" required autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="showing-phone">Phone number *</label>
                <input id="showing-phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" />
              </div>
              <div className="field">
                <label htmlFor="showing-email">Email address *</label>
                <input id="showing-email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="field">
                <label htmlFor="showing-move-in">Desired move-in date *</label>
                <input id="showing-move-in" name="desiredMoveInDate" type="date" required min={dateBounds.minimum} />
              </div>
              <div className="field">
                <label htmlFor="showing-date">Preferred date *</label>
                <input
                  id="showing-date"
                  name="requestedLocalDate"
                  type="date"
                  required
                  min={dateBounds.minimum}
                  max={dateBounds.maximum}
                />
              </div>
              <div className="field">
                <label htmlFor="showing-time">Preferred time *</label>
                <select id="showing-time" name="requestedLocalTime" required defaultValue="">
                  <option value="" disabled>Choose a time</option>
                  {showingTimeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="showing-availability-note">
              Pacific Time · Monday–Saturday · 9:00 AM–6:00 PM · at least {SHOWING_MIN_NOTICE_HOURS} hours’ notice · up to {SHOWING_MAX_DAYS_AHEAD} days ahead
            </p>
            <div className="field">
              <label htmlFor="showing-notes">Notes for Ting Ting (optional)</label>
              <textarea id="showing-notes" name="notes" rows={3} maxLength={1000} />
            </div>
            <div className="application-inline-checks showing-needs">
              <label><input name="hasPets" type="checkbox" value="yes" />I have pets</label>
              <label><input name="needsParking" type="checkbox" value="yes" />I require parking</label>
            </div>
            <label className="showing-consent" htmlFor="showing-disclosure">
              <input id="showing-disclosure" name="representationDisclosureAcknowledged" type="checkbox" value="yes" required />
              <span>I have reviewed the BCFSA <a href="https://www.bcfsa.ca/public-resources/real-estate/mandatory-disclosure" target="_blank" rel="noreferrer">Disclosure for Residential Tenancies</a> before sharing my rental needs. *</span>
            </label>
            <label className="showing-consent" htmlFor="showing-consent">
              <input id="showing-consent" name="consent" type="checkbox" value="yes" required />
              <span>I consent to Ting Ting Xu using these contact and scheduling details to respond to this request. The appointment is not confirmed until Ting Ting accepts it. *</span>
            </label>
            <div className="honeypot" aria-hidden="true">
              <label htmlFor="showing-website">Website</label>
              <input id="showing-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <button className="button contact-submit" disabled={busy} type="submit">
              {busy ? "Sending request…" : "Request this showing"}
              <CalendarCheck size={16} aria-hidden />
            </button>
            {status && (
              <div className={`form-status ${status.type}`} role={status.type === "error" ? "alert" : "status"}>
                <p><strong>{status.type === "success" ? "Showing requested—not yet confirmed. " : ""}</strong>{status.message}</p>
                {status.type === "success" && <><p className="showing-reschedule">Need a different time? Send another request or contact Ting Ting directly.</p><p className="showing-reschedule">Already invited to apply? <a href={applicationHref}>Continue in Client Login</a>.</p></>}
              </div>
            )}
          </form>
        </div>
      </dialog>
    </ShowingRequestContext.Provider>
  );
}

export function ShowingRequestTrigger({ children, className = "button" }: { children: ReactNode; className?: string }) {
  const openShowingRequest = useContext(ShowingRequestContext);
  if (!openShowingRequest) throw new Error("ShowingRequestTrigger must be used inside ShowingRequestModalProvider");
  return <button className={className} type="button" onClick={(event) => openShowingRequest(event.currentTarget)}>{children}</button>;
}
