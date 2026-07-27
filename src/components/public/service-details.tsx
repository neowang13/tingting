"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Service {
  key: string;
  title: string;
  ctaLabel: string;
  detail: {
    eyebrow: string;
    heading: string;
    body: string;
    includedHeading: string;
    includedItems: string[];
    processHeading: string;
    processBody: string;
    primaryCtaLabel: string;
    secondaryCtaLabel: string;
  };
}

interface Props {
  service: Service;
}

export function ServiceDetails({ service }: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();

    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dialog.close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button ref={triggerRef} className="service-link" type="button" onClick={() => setOpen(true)}>
        {service.ctaLabel}
        <ArrowRight size={15} aria-hidden />
      </button>
      <dialog
        ref={dialogRef}
        className="service-dialog"
        aria-labelledby={`${service.key}-detail-title`}
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="service-dialog-panel">
          <button
            className="dialog-close"
            type="button"
            aria-label="Close service details"
            onClick={() => dialogRef.current?.close()}
          >
            <X aria-hidden />
          </button>
          <div className="eyebrow">{service.detail.eyebrow}</div>
          <h2 id={`${service.key}-detail-title`}>{service.detail.heading}</h2>
          <p>{service.detail.body}</p>
          <div className="detail-grid">
            <div>
              <h3>{service.detail.includedHeading}</h3>
              <ul>
                {service.detail.includedItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h3>{service.detail.processHeading}</h3>
              <p>{service.detail.processBody}</p>
            </div>
          </div>
          <div className="dialog-actions">
            <Link className="button" href="/#contact" onClick={() => dialogRef.current?.close()}>
              {service.detail.primaryCtaLabel}
            </Link>
            <Link className="button secondary" href="/#contact" onClick={() => dialogRef.current?.close()}>
              {service.detail.secondaryCtaLabel}
            </Link>
          </div>
        </div>
      </dialog>
    </>
  );
}
