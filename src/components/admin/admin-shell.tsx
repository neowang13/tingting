import Link from "next/link";
import Image from "next/image";
import type { AdminIdentity } from "@/lib/auth";
import { AdminMobileNavigation } from "@/components/admin/admin-mobile-navigation";
import { AdminNavigation } from "@/components/admin/admin-navigation";
import { LogoutButton } from "@/components/admin/logout-button";
import { AdminSessionGuard } from "@/components/admin/admin-session-guard";

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
      <AdminSessionGuard lastActiveAt={admin.lastActiveAt} />
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <Link className="admin-brand" href="/admin/properties" aria-label="Silverkey admin home">
            <Image src="/images/silverkey-logo-nav.png" alt="Silverkey" width={221} height={64} priority />
          </Link>
          <span>Admin</span>
        </div>
        <div className="admin-desktop-navigation"><AdminNavigation /></div>
        {process.env.MCP_ENABLED === "true" && <Link className="mcp-connections-link" href="/admin/mcp">Connected apps</Link>}
        <div className="admin-sidebar-user">
          <span className="admin-avatar">{admin.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
          <div><strong>{admin.displayName.split(/\s+/).slice(0, 2).join(" ")}</strong><small>{admin.email}</small></div>
          <LogoutButton />
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-page-heading">
            <h1>{title}</h1>
            {description && <p className="admin-page-description">{description}</p>}
          </div>
          <AdminMobileNavigation mcpEnabled={process.env.MCP_ENABLED === "true"} />
        </header>
        <div className="admin-content">{children}</div>
      </main>
    </div>
  );
}
