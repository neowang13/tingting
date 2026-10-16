"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AdminNavigation } from "@/components/admin/admin-navigation";
import { LogoutButton } from "@/components/admin/logout-button";

export function AdminMobileNavigation() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 861px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return <div className="admin-mobile-navigation">
    <button className="admin-menu-button" type="button" aria-label="Open navigation" aria-haspopup="dialog"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}><Menu size={23} aria-hidden /></button>
    <dialog ref={dialogRef} id={id} className="admin-navigation-drawer" aria-labelledby={`${id}-title`}
      onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="admin-drawer-heading">
        <h2 id={`${id}-title`}>Navigation</h2>
        <button className="admin-menu-button" type="button" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={22} aria-hidden /></button>
      </div>
      <AdminNavigation onNavigate={() => setOpen(false)} />
      <div className="admin-drawer-signout"><LogoutButton /></div>
    </dialog>
  </div>;
}
