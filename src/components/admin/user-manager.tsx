"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminUser, UserStatus } from "@/features/users/service";

const labels: Record<UserStatus, string> = {
  user: "User", tenant: "Tenant", former_tenant: "Former tenant", needs_review: "Needs verification"
};

export function UserManager({ users }: { users: AdminUser[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | UserStatus>("all");
  const visible = useMemo(() => users.filter((user) => {
    if (filter !== "all" && user.tenantStatus !== filter) return false;
    const term = query.trim().toLowerCase();
    return !term || [user.displayName, user.email ?? "", ...user.applications.map((application) => application.propertyAddress)]
      .some((value) => value.toLowerCase().includes(term));
  }), [users, query, filter]);
  return <div className="prototype-page users-page">
    <div className="prototype-filter-toolbar">
      <label className="sr-only" htmlFor="user-search">Search users</label>
      <input id="user-search" type="search" placeholder="Search name, email, or property" value={query} onChange={(event) => setQuery(event.target.value)} />
      <label className="sr-only" htmlFor="user-status">User status</label>
      <select id="user-status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
        <option value="all">All users · {users.length}</option>
        {Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label} · {users.filter((user) => user.tenantStatus === value).length}</option>)}
      </select>
      <Link className="button secondary" href="/admin/tenants">Existing tenant records</Link>
    </div>
    <div className="table-scroll">
      <table className="admin-table tenant-management-table">
        <thead><tr><th>User</th><th>Account</th><th>Status</th><th>Applications</th><th>Registered</th><th>Action</th></tr></thead>
        <tbody>{visible.map((user) => <tr key={user.userId}>
          <td><strong>{user.displayName}</strong><small>{user.email ?? "Email unavailable"}</small></td>
          <td><span>{user.emailConfirmedAt ? "Email verified" : "Email unverified"}</span><small>{user.isActive ? "Active" : "Inactive"}</small></td>
          <td><span className={`prototype-status ${user.tenantStatus === "tenant" ? "success" : "neutral"}`}>{labels[user.tenantStatus]}</span></td>
          <td>{user.applications.length}</td>
          <td>{new Date(user.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })}</td>
          <td><Link className="row-action" href={`/admin/users/${user.userId}`}>View user</Link></td>
        </tr>)}</tbody>
      </table>
    </div>
    {visible.length === 0 && <p className="prototype-empty-row">No users match these filters.</p>}
  </div>;
}

export function UserDetails({ user }: { user: AdminUser }) {
  const tenantLinks = user.linkHistory;
  return <div className="prototype-page users-page">
    <Link className="text-link" href="/admin/users">Back to users</Link>
    <section className="client-panel">
      <h2>{user.displayName}</h2>
      <p>{user.email ?? "Email unavailable"} · {user.emailConfirmedAt ? "Email verified" : "Email unverified"} · {user.isActive ? "Active account" : "Inactive account"}</p>
      <span className={`prototype-status ${user.tenantStatus === "tenant" ? "success" : "neutral"}`}>{labels[user.tenantStatus]}</span>
      {user.tenantStatus === "needs_review" && <p>Existing tenant links have no matching confirmed signed lease on file. Review the original records before marking this user as a tenant.</p>}
    </section>
    <section className="client-panel">
      <h2>Applications and contracts</h2>
      {user.applications.length === 0 ? <p>No applications yet.</p> : <div className="table-scroll"><table className="admin-table">
        <thead><tr><th>Property</th><th>Application</th><th>Signed lease</th><th>Action</th></tr></thead>
        <tbody>{user.applications.map((application) => <tr key={application.id}>
          <td><strong>{application.propertyTitle}</strong><small>{application.propertyAddress}</small></td>
          <td>{application.status.replaceAll("_", " ")}</td>
          <td>{application.convertedAt && application.hasSignedLease ? "Confirmed by admin" : application.hasSignedLease ? "Uploaded; awaiting confirmation" : "Not uploaded"}</td>
          <td><Link className="row-action" href={`/admin/applications?application=${application.id}&view=${application.status === "approved" ? "approved" : "open"}`}>Review application</Link></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {tenantLinks.length > 0 && <section className="client-panel">
      <h2>Tenancy records</h2>
      <p>Lease details, rent payments, and reminders are managed within each tenancy record.</p>
      <ul>{tenantLinks.map((link) => <li key={link.id}>
        {link.tenant.propertyLabel}{link.tenant.unitLabel ? `, ${link.tenant.unitLabel}` : ""} · {link.archivedAt || !link.tenant.isActive || link.tenant.archivedAt ? "Historical" : "Current"}{" "}
        <Link className="text-link" href={`/admin/tenants/${link.tenantId}`}>Manage tenancy record</Link>
      </li>)}</ul>
    </section>}
  </div>;
}
