import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { AdminShell } from "@/components/admin/admin-shell";
import { ApplicationQueue } from "@/components/admin/application-queue";
import { RentalEditor } from "@/components/admin/rental-editor";
import { TenantEditor } from "@/components/admin/tenant-editor";
import { RentalDetailPage } from "@/components/public/rental-detail-page";
import { getRepository } from "@/data/repository";
import { listMediaAssets } from "@/features/content/media-service";
import { loadAdminRentalPreviewData } from "@/features/content/public-rental-detail";
import { listApplicationsForStaff } from "@/features/applications/service";
import { requireAdminPage } from "@/lib/auth";
import type { RentalListing, Tenant } from "@/lib/contracts";

interface Props {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export default async function AdminPage({ params, searchParams }: Props) {
  const admin = await requireAdminPage();
  const { segments = [] } = await params;
  const [area, id, action] = segments;
  const repository = getRepository();

  if (!area) redirect("/admin/properties");

  if (area === "properties") {
    const query = await searchParams;
    const value = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
    const rentals = await repository.listRentals(true);

    if (id && action === "preview") {
      return <div className="admin-preview">
        <div className="preview-banner" role="status">
          Private property preview · Visitors cannot see this version · <Link href={`/admin/properties/${id}`}>Return to Admin</Link>
        </div>
        <RentalDetailPage {...(await loadAdminRentalPreviewData(id))} />
      </div>;
    }

    if (id) {
      return (
        <AdminShell
          admin={admin}
          title={id === "new" ? "Create property" : "Property detail"}
          description={id === "new"
            ? "Add a managed rental unit. New properties stay inactive until they are ready to publish."
            : "Review and update the complete operational and public record for this property."}
        >
          <RentalEditor
            rental={id === "new" ? null : await repository.getRental(id)}
            initialMedia={await listMediaAssets()}
          />
        </AdminShell>
      );
    }

    const tenants = await repository.listTenants({ limit: 500 });
    const state = (rental: RentalListing) => propertyState(rental, tenants);
    const requestedStatus = value("status");
    const requestedCity = value("city");
    const requestedType = value("type");
    const search = value("q").trim().toLowerCase();
    const managed = rentals.filter((rental) => rental.status !== "archived");
    const visible = managed.filter((rental) => {
      if (requestedStatus && state(rental) !== requestedStatus) return false;
      if (requestedCity && rental.city !== requestedCity) return false;
      if (requestedType && rental.property?.propertyType !== requestedType) return false;
      if (!search) return true;
      return [propertyNumber(rental), rental.title, rental.addressLine, rental.city]
        .some((item) => item.toLowerCase().includes(search));
    });
    const cities = [...new Set(managed.map((rental) => rental.city).filter(Boolean))].sort();

    return (
      <AdminShell
        admin={admin}
        title="Properties"
        description={`${managed.length} managed · ${managed.filter((rental) => state(rental) === "available").length} currently available · ${managed.filter((rental) => state(rental) === "occupied").length} currently occupied · ${managed.filter((rental) => state(rental) === "inactive").length} inactive`}
      >
        <div className="prototype-page properties-list-page">
          <form className="properties-toolbar" method="get">
            <label className="properties-search">
              <span className="sr-only">Search property number or address</span>
              <input name="q" type="search" placeholder="Search property number or address" defaultValue={value("q")} />
            </label>
            <label><span className="sr-only">Property status</span><select name="status" defaultValue={requestedStatus}>
              <option value="">All managed</option>
              <option value="available">Currently available</option>
              <option value="occupied">Currently occupied</option>
              <option value="inactive">Inactive</option>
            </select></label>
            <label><span className="sr-only">City</span><select name="city" defaultValue={requestedCity}>
              <option value="">City: All</option>
              {cities.map((city) => <option value={city} key={city}>{city}</option>)}
            </select></label>
            <label><span className="sr-only">Property type</span><select name="type" defaultValue={requestedType}>
              <option value="">Type: All</option>
              <option value="apartment">Apartment</option><option value="condo">Condo</option>
              <option value="townhome">Townhome</option><option value="house">House</option>
              <option value="basement_suite">Basement suite</option><option value="room">Room</option><option value="other">Other</option>
            </select></label>
            <button className="button secondary" type="submit">Apply filters</button>
            <Link className="button" href="/admin/properties/new">Create property</Link>
          </form>

          <div className="property-list-heading" aria-hidden>
            <span>Cover</span><span>Number</span><span>Address</span><span>Status</span><span>Action</span>
          </div>
          <div className="property-list">
            {visible.map((rental) => {
              const rentalState = state(rental);
              return <article className="property-row" key={rental.id}>
                <div className="property-cover">{rental.coverImageUrl
                  ? <Image src={rental.coverImageUrl} alt="" width={172} height={120} unoptimized />
                  : <span aria-hidden>SK</span>}
                </div>
                <code>{propertyNumber(rental)}</code>
                <div className="property-address"><strong>{rental.addressLine}</strong><small>{rental.city}</small></div>
                <span className={`property-status ${rentalState}`}>{propertyStatusLabel(rentalState)}</span>
                <Link className="property-view-action" href={`/admin/properties/${rental.id}`}>View property</Link>
              </article>;
            })}
          </div>
          {visible.length === 0 && <section className="client-panel empty-state"><h2>No matching properties</h2><p>Change the search or filters to see managed properties.</p></section>}
        </div>
      </AdminShell>
    );
  }

  if (area === "applications" && !id) {
    const query = await searchParams;
    const requestedView = typeof query.view === "string" ? query.view : "open";
    const initialFilter = (["open", "under_review", "approved", "rejected", "contract_signed"] as const)
      .find((view) => view === requestedView) ?? "open";
    return (
      <AdminShell
        admin={admin}
        title="Client applications"
        description="Review submitted applications, screen private documents, and record approval or rejection."
      >
        <ApplicationQueue initial={await listApplicationsForStaff(admin)} initialFilter={initialFilter} />
      </AdminShell>
    );
  }

  if (area === "tenants") {
    const query = await searchParams;
    const value = (key: string) => typeof query[key] === "string" ? query[key] as string : "";

    if (id) {
      const initialTenant = id === "new" ? null : await repository.getTenant(id);
      return (
        <AdminShell
          admin={admin}
          title={initialTenant ? "Manage tenant" : "Add tenant"}
          description="Maintain the tenant, lease, contact, payment, and internal record."
        >
          <TenantEditor initial={initialTenant} initialNotice={tenantSaveNotice(value("saved"))} />
        </AdminShell>
      );
    }

    const tenants = await repository.listTenants({
      query: value("q") || undefined,
      lifecycle: (value("lifecycle") || undefined) as "active" | "inactive" | "archived" | undefined,
      leaseType: (value("lease") || undefined) as "month_to_month" | "fixed_term" | "needs_details" | undefined,
      limit: 500
    });
    const tenantTimezone = process.env.DEFAULT_TIMEZONE ?? "America/Vancouver";
    const tenantToday = Temporal.Now.instant().toZonedDateTimeISO(tenantTimezone).toPlainDate();
    const leaseWarningEnd = tenantToday.add({ days: 30 }).toString();

    return (
      <AdminShell
        admin={admin}
        title="Tenants"
        description="Search and manage current, inactive, and archived tenants."
      >
        <div className="prototype-page tenants-list-page">
          <form className="prototype-filter-toolbar" method="get">
            <label className="sr-only" htmlFor="tenant-search">Search name, property, unit, or email</label>
            <input id="tenant-search" name="q" placeholder="Search tenant, property, unit, or email" type="search" defaultValue={value("q")} />
            <label className="sr-only" htmlFor="tenant-lifecycle">Tenant status</label>
            <select id="tenant-lifecycle" name="lifecycle" defaultValue={value("lifecycle")}>
              <option value="">Status: All</option>
              <option value="active">Status: Current</option>
              <option value="inactive">Status: Inactive</option>
              <option value="archived">Status: Archived</option>
            </select>
            <label className="sr-only" htmlFor="tenant-lease">Lease type</label>
            <select id="tenant-lease" name="lease" defaultValue={value("lease")}>
              <option value="">Lease: All</option>
              <option value="month_to_month">Month to month</option>
              <option value="fixed_term">Fixed term</option>
              <option value="needs_details">Needs lease details</option>
            </select>
            <button className="button secondary" type="submit">Apply filters</button>
            <Link className="button" href="/admin/tenants/new">Add tenant</Link>
          </form>

          <div className="table-scroll">
            <table className="admin-table tenant-management-table">
              <thead><tr><th>Tenant</th><th>Rental home</th><th>Contact</th><th>Lease</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td><strong>{tenant.fullName}</strong><small>Since {formatDate(tenant.moveInDate)}</small></td>
                  <td><strong>{tenant.propertyLabel}</strong><small>{tenant.unitLabel || "No unit"}</small></td>
                  <td>{tenant.email || "No email"}<small>{tenant.phoneE164 || "No phone"}</small></td>
                  <td className={leaseExpiryTone(tenant.leaseType, tenant.leaseEndDate, tenant.isActive && !tenant.archivedAt, tenantToday.toString(), leaseWarningEnd)}>
                    {tenant.leaseType === "month_to_month"
                      ? "Month to month"
                      : tenant.leaseType === "fixed_term"
                        ? `Fixed · ends ${formatDate(tenant.leaseEndDate)}`
                        : "Needs lease details"}
                  </td>
                  <td><span className={`prototype-status ${tenant.isActive && !tenant.archivedAt ? "success" : "neutral"}`}>{tenant.archivedAt ? "Archived" : tenant.isActive ? "Current" : "Inactive"}</span></td>
                  <td><Link className="row-action" href={`/admin/tenants/${tenant.id}`}>Manage tenant</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {tenants.length === 0 && <p className="prototype-empty-row">No tenants match these filters.</p>}
        </div>
      </AdminShell>
    );
  }

  redirect("/admin/applications");
}

function propertyState(rental: RentalListing, tenants: Tenant[]) {
  const rentalAddress = rental.addressLine.toLowerCase();
  const occupied = tenants.some((tenant) => tenant.isActive && !tenant.archivedAt && (
    tenant.propertyLabel.toLowerCase() === rentalAddress ||
    rentalAddress.includes(tenant.propertyLabel.toLowerCase()) ||
    tenant.propertyLabel.toLowerCase().includes(rental.title.toLowerCase())
  ));
  if (occupied) return "occupied" as const;
  if (rental.status === "published") return "available" as const;
  return "inactive" as const;
}

function propertyStatusLabel(state: ReturnType<typeof propertyState>) {
  if (state === "available") return "Currently available";
  if (state === "occupied") return "Currently occupied";
  return "Inactive";
}

function propertyNumber(rental: RentalListing) {
  if (!rental.propertyNumber) {
    throw new Error(`Property ${rental.id} is missing its permanent Property Number.`);
  }
  return rental.propertyNumber;
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function leaseExpiryTone(
  leaseType: "month_to_month" | "fixed_term" | null,
  leaseEndDate: string | null,
  current: boolean,
  today: string,
  warningEnd: string
) {
  if (!current || leaseType !== "fixed_term" || !leaseEndDate) return undefined;
  if (leaseEndDate < today) return "prototype-status danger";
  if (leaseEndDate <= warningEnd) return "prototype-status waiting";
  return undefined;
}

function tenantSaveNotice(value: string) {
  if (!value) return undefined;
  return { message: "Tenant saved.", tone: "success" as const };
}
