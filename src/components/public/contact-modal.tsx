"use client";

import { X } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { ContactForm } from "@/components/public/contact-form";
import type { PublicHomepageData } from "@/features/content/public-homepage";

type ContactContent = PublicHomepageData["sections"]["contact"];

const ContactModalContext = createContext<((trigger?: HTMLElement) => void) | null>(null);

export function ContactModalProvider({
  contact,
  children
}: {
  contact: ContactContent;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function openContact(trigger?: HTMLElement) {
    triggerRef.current = trigger ?? null;
    setOpen(true);
  }

  function closeContact() {
    dialogRef.current?.close();
  }

  return (
    <ContactModalContext.Provider value={openContact}>
      {children}
      <dialog
        ref={dialogRef}
        className="contact-dialog"
        aria-labelledby="contact-dialog-title"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeContact();
        }}
      >
        <div className="contact-dialog-panel">
          <button className="dialog-close" type="button" aria-label="Close contact form" onClick={closeContact}>
            <X aria-hidden />
          </button>
          <div className="eyebrow">CONTACT TING TING</div>
          <h2 id="contact-dialog-title">{contact.heading}</h2>
          <p>{contact.body}</p>
          <ContactForm
            idPrefix="contact-modal"
            labels={contact.fieldLabels}
            options={contact.preferredContactOptions}
            submitLabel={contact.submitLabel}
            successMessage={contact.successMessage}
            errorMessage={contact.errorMessage}
            publicEmail={contact.publicEmail}
            publicPhone={contact.publicPhone}
          />
        </div>
      </dialog>
    </ContactModalContext.Provider>
  );
}

export function ContactTrigger({
  children,
  className = "button",
  ariaLabel
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const openContact = useContext(ContactModalContext);
  if (!openContact) throw new Error("ContactTrigger must be used inside ContactModalProvider");

  return (
    <button
      className={className}
      type="button"
      aria-label={ariaLabel}
      onClick={(event) => openContact(event.currentTarget)}
    >
      {children}
    </button>
  );
}
