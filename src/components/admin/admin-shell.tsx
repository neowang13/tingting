import Link from "next/link";
import type { AdminIdentity } from "@/lib/auth";
import { LogoutButton } from "@/components/admin/logout-button";

const navigation = [
  ["Dashboard", "/admin"],
  ["Website Content", "/admin/content"],
  ["Rentals", "/admin/rentals"],
  ["Tenants", "/admin/tenants"],
  ["Automation", "/admin/automation"],
  ["Send Reminder", "/admin/notifications/send"],
  ["Templates", "/admin/notifications/templates"],
  ["Delivery History", "/admin/notifications/history"],
  ["Settings", "/admin/settings"]
] as const;

export function AdminShell({
  admin,
  title,
  children
}: {
  admin: AdminIdentity;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/"><strong>TING TING XU</strong><br /><small>ADMIN</small></Link>
        <nav aria-label="Admin navigation">
          {navigation.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        </nav>
      </aside>
      <main className="admin-main">
        <div className="admin-topbar">
          <div>
            <div className="eyebrow">ADMINISTRATION</div>
            <h1 style={{ margin: "0.35rem 0" }}>{title}</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <strong>{admin.displayName}</strong><br />
            <small>{admin.email}</small>
            <br />
            <LogoutButton />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
