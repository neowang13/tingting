"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface NavigationItem {
  key: string;
  label: string;
  href: string;
}

interface Props {
  items: readonly NavigationItem[];
  contactCta: { label: string; href: string };
}

export function MobileNavigation({ items, contactCta }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="mobile-navigation">
      <button
        ref={buttonRef}
        className="menu-button"
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
      </button>
      {open && (
        <nav id="mobile-menu" className="mobile-menu" aria-label="Mobile navigation">
          {items.map((item, index) => (
            <Link
              ref={index === 0 ? firstLinkRef : undefined}
              key={item.key}
              href={item.href}
              onClick={close}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/client/applications" onClick={close}>My applications</Link>
          <Link className="button" href={contactCta.href} onClick={close}>
            {contactCta.label}
          </Link>
        </nav>
      )}
    </div>
  );
}
