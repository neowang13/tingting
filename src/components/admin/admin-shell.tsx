import Link from "next/link";
import type { AdminIdentity } from "@/lib/auth";
import { AdminNavigation } from "@/components/admin/admin-navigation";
import { LogoutButton } from "@/components/admin/logout-button";

export function AdminShell({
  admin,
  title,
  description,
  children
}: {
  admin: AdminIdentity;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/">
          <strong>Ting Ting Admin</strong>
          <small>Property &amp; rentals console</small>
        </Link>
        <div className="admin-desktop-navigation">
          <AdminNavigation />
        </div>
        <details className="admin-mobile-navigation">
          <summary>Admin menu</summary>
          <AdminNavigation />
        </details>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-page-heading">
            <h1>{title}</h1>
            {description && <p className="admin-page-description">{description}</p>}
          </div>
          <div className="admin-user">
            <div>
              <strong>{admin.displayName.split(/\s+/).slice(0, 2).join(" ")}</strong>
              <small>{admin.email}</small>
            </div>
            <LogoutButton />
          </div>
        </header>
        <div className="admin-content">{children}</div>
      </main>
    </div>
  );
}
