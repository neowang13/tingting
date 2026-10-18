"use client";

import { DateCalendar } from "@/components/shared/date-calendar";
import { formatPropertyAddress } from "@/lib/property-address";
import { formatCalendarDate } from "@/features/showings/calendar";
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
  SHOWING_TIMEZONE
} from "@/features/showings/scheduling";

interface ShowingProperty {
  slug: string;
  title: string;
  addressLine: string;
  city: string;
}

interface ViewingAvailability {
  window: { start: string; end: string; timezone: typeof SHOWING_TIMEZONE };
  dates: Array<{
    date: string;
    label: string;
  }>;
}

async function fetchViewingAvailability(propertySlug: string, signal?: AbortSignal) {
  const response = await fetch(`/api/public/showings?propertySlug=${encodeURIComponent(propertySlug)}`, { cache: "no-store", signal });
  const body = await response.json() as {
    data?: ViewingAvailability;
    error?: { message?: string };
  };
  if (!response.ok || !body.data) {
    throw new Error(body.error?.message || "Viewing dates are temporarily unavailable.");
  }
  return body.data;
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
  const [availability, setAvailability] = useState<ViewingAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const applicationHref = `/client/apply/${encodeURIComponent(property.slug)}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => nameRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetchViewingAvailability(property.slug, controller.signal)
      .then(setAvailability)
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStatus({
          type: "error",
          message: error instanceof Error ? error.message : "Viewing dates are temporarily unavailable."
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      });
    return () => controller.abort();
  }, [open, property.slug]);

  function openShowingRequest(trigger?: HTMLElement) {
    triggerRef.current = trigger ?? null;
    setStatus(null);
    setAvailabilityLoading(true);
    setAvailability(null);
    setSelectedDate("");
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
    if (!selectedDate) {
      setStatus({ type: "error", message: "Choose an available viewing date." });
      return;
    }
    const data = new FormData(form);
    if (data.get("website")) {
      setStatus({ type: "success", message: "Your viewing date is registered. An agent will contact you to arrange the time." });
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
          requestedLocalDate: data.get("requestedLocalDate"),
          timezone: SHOWING_TIMEZONE,
          notes: data.get("notes"),
          website: data.get("website")
        })
      });
      const body = await response.json() as {
        data?: { message?: string };
        error?: { code?: string; message?: string };
      };
      if (!response.ok) {
        if (body.error?.code === "SHOWING_DATE_UNAVAILABLE") {
          setAvailabilityLoading(true);
          try {
            const refreshed = await fetchViewingAvailability(property.slug);
            setAvailability(refreshed);
            if (!refreshed.dates.some((entry) => entry.date === selectedDate)) setSelectedDate("");
          } finally {
            setAvailabilityLoading(false);
          }
        }
        throw new Error(body.error?.message || "Choose another available date and try again.");
      }
      setStatus({
        type: "success",
        message: body.data?.message || "Your viewing date is registered. An agent will contact you to arrange the time."
      });
      form.reset();
      setSelectedDate("");
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "The request could not be sent. Choose another date or contact Ting Ting."
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
          <h2 id="showing-dialog-title">Choose a date to view this home</h2>
          <p id="showing-dialog-description">
            Choose an available date for this home. An agent will contact you to arrange the specific time.
          </p>

          <div className="showing-property" aria-label="Selected property">
            <CalendarCheck aria-hidden />
            <div><strong>{property.title}</strong><span>{formatPropertyAddress(property.addressLine, property.city)}</span></div>
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
            </div>
            <fieldset className="showing-date-picker" disabled={availabilityLoading || busy}>
              <legend>Viewing date *</legend>
              <input type="hidden" name="requestedLocalDate" value={selectedDate} />
              {availabilityLoading ? <p role="status">Loading viewing dates…</p> : availability && <>
                <DateCalendar label="Choose a viewing date" minimum={availability.window.start} maximum={availability.window.end}
                  selectedDates={selectedDate ? [selectedDate] : []} availableDates={availability.dates.map((entry) => entry.date)}
                  onSelect={setSelectedDate} disabled={busy} />
                <div className="viewing-calendar-legend"><span><i aria-hidden />Available date</span><span>Grey dates are unavailable</span></div>
              </>}
              {selectedDate && <p className="showing-selected-date" role="status">Selected: {formatCalendarDate(selectedDate)}</p>}
            </fieldset>
            <p className="showing-availability-note">
              Available dates for the next month · an agent will contact you to arrange the time
            </p>
            {!availabilityLoading && availability && availability.dates.length === 0 && (
              <div className="form-status" role="status">
                No viewing dates are currently available. Please check again later or contact Ting Ting directly.
              </div>
            )}
            <div className="field">
              <label htmlFor="showing-notes">Notes for Ting Ting (optional)</label>
              <textarea id="showing-notes" name="notes" rows={3} maxLength={1000} aria-describedby="showing-notes-help" />
              <p id="showing-notes-help" className="showing-availability-note">
                If your move-in is more than one month away or does not match this home&apos;s availability, mention it here. Include any pet information too.
              </p>
            </div>
            <div className="honeypot" aria-hidden="true">
              <label htmlFor="showing-website">Website</label>
              <input id="showing-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <p className="showing-availability-note">
              We use your contact and scheduling details to arrange and administer this viewing. Read our <a href="/privacy">privacy notice</a>.
            </p>
            <button className="button contact-submit" disabled={busy || availabilityLoading || !selectedDate} type="submit">
              {busy ? "Booking viewing…" : "Book this viewing"}
              <CalendarCheck size={16} aria-hidden />
            </button>
            {status && (
              <div className={`form-status ${status.type}`} role={status.type === "error" ? "alert" : "status"}>
                {status.type === "success"
                  ? <p><strong>Viewing date registered. </strong>An agent will contact you to arrange the time.</p>
                  : <p>{status.message}</p>}
                {status.type === "success" && <><p className="showing-reschedule">Need a different date? Send another request or contact Ting Ting directly.</p><p className="showing-reschedule"><a href={applicationHref}>Apply online for this home</a>.</p></>}
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
