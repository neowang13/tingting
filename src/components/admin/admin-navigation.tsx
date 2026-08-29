"use client";

import { Building2, CalendarClock, FileText, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { label: "Properties", href: "/admin/properties", icon: Building2 },
  { label: "Applications", href: "/admin/applications", icon: FileText },
  { label: "Viewing dates", href: "/admin/viewings", icon: CalendarClock },
  { label: "Tenants", href: "/admin/tenants", icon: Users }
] as const;

const applicationViews = [
  { label: "Open applications", href: "/admin/applications?view=open" },
  { label: "Under review", href: "/admin/applications?view=under_review" },
  { label: "Approved", href: "/admin/applications?view=approved" },
  { label: "Rejected", href: "/admin/applications?view=rejected" },
  { label: "Contract signed", href: "/admin/applications?view=contract_signed" }
] as const;

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin navigation">
      {navigation.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        const Icon = link.icon;
        return <div className="admin-navigation-item" key={link.href}>
          <Link aria-current={active ? "page" : undefined} href={link.href}>
            <Icon size={16} strokeWidth={1.8} aria-hidden />
            <span>{link.label}</span>
          </Link>
          {link.href === "/admin/applications" && <div className="admin-navigation-submenu">
            {applicationViews.map((view) => <Link href={view.href} key={view.href}>{view.label}</Link>)}
          </div>}
        </div>;
      })}
    </nav>
  );
}
