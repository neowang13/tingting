"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationGroups = [
  {
    label: "Overview",
    links: [
      { label: "Home", href: "/admin", exact: true }
    ]
  },
  {
    label: "Website",
    links: [
      { label: "Website content", href: "/admin/content", exact: false },
      { label: "Rental listings", href: "/admin/rentals", exact: false },
      { label: "Client applications", href: "/admin/applications", exact: false }
    ]
  },
  {
    label: "Rent management",
    links: [
      { label: "Client accounts", href: "/admin/clients", exact: false },
      { label: "Tenants & schedules", href: "/admin/tenants", exact: false },
      { label: "Email activity", href: "/admin/notifications/history", exact: false },
      { label: "Email templates", href: "/admin/notifications/templates", exact: false }
    ]
  },
  {
    label: "System",
    links: [
      { label: "Reminder settings", href: "/admin/settings", exact: false }
    ]
  }
] as const;

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin navigation">
      {navigationGroups.map((group) => (
        <div className="admin-nav-group" key={group.label}>
          <span>{group.label}</span>
          {group.links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
