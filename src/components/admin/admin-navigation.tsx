"use client";

import { Building2, FileText, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { label: "Properties", href: "/admin/properties", icon: Building2 },
  { label: "Applications", href: "/admin/applications", icon: FileText },
  { label: "Users", href: "/admin/users", icon: Users }
] as const;

export function AdminNavigation({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin navigation">
      {navigation.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
          || (link.href === "/admin/users" && pathname.startsWith("/admin/tenants"));
        const Icon = link.icon;
        return <div className="admin-navigation-item" key={link.href}>
          <Link aria-current={active ? "page" : undefined} href={link.href} onClick={onNavigate}>
            <Icon size={16} strokeWidth={1.8} aria-hidden />
            <span>{link.label}</span>
          </Link>
        </div>;
      })}
    </nav>
  );
}
