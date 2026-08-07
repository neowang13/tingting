"use client";

import Link from "next/link";
import { ChevronDown, LayoutDashboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function clientInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${Array.from(parts[0])[0] ?? ""}${Array.from(parts.at(-1) ?? "")[0] ?? ""}`.toLocaleUpperCase();
  }
  return Array.from(parts[0] ?? "C").slice(0, 2).join("").toLocaleUpperCase();
}

export function ClientAccountMenu({ displayName }: { displayName: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    portalRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open]);

  return (
    <div className="client-account-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        className="client-account-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="client-account-dropdown"
        aria-label={`Open account menu for ${displayName}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="client-avatar" aria-hidden>{clientInitials(displayName)}</span>
        <span className="client-account-name">{displayName}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="client-account-dropdown" id="client-account-dropdown">
          <Link ref={portalRef} href="/client/applications" onClick={() => setOpen(false)}>
            <LayoutDashboard size={17} aria-hidden />
            Portal
          </Link>
        </div>
      )}
    </div>
  );
}
