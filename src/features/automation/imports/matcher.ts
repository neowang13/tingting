import type {
  AutomationTenant,
  NormalizedTenantImportRow,
  TenantImportOutcome
} from "@/features/automation/contracts";

export interface MatchResult {
  outcome: TenantImportOutcome;
  matchedTenant: AutomationTenant | null;
  errorCodes: string[];
  changedFields: string[];
}

function compatible(row: NormalizedTenantImportRow, tenant: AutomationTenant) {
  return (
    row.propertyLabel.toLowerCase() === tenant.propertyLabel.toLowerCase() &&
    (row.unitLabel ?? "").toLowerCase() === (tenant.unitLabel ?? "").toLowerCase()
  );
}

const managedFields = [
  "fullName",
  "propertyLabel",
  "unitLabel",
  "email",
  "phoneE164",
  "preferredChannels",
  "timezone",
  "internalNotes",
  "isActive"
] as const;

function permissionChanges(row: NormalizedTenantImportRow, tenant: AutomationTenant) {
  const changed: string[] = [];
  if (
    row.emailContactStatus !== "unconfirmed" &&
    row.emailContactStatus !== tenant.emailContactStatus
  ) changed.push("emailContactStatus");
  if (
    row.smsContactStatus !== "unconfirmed" &&
    row.smsContactStatus !== tenant.smsContactStatus
  ) changed.push("smsContactStatus");
  return changed;
}

export function matchTenantImportRow(
  row: NormalizedTenantImportRow,
  tenants: AutomationTenant[],
  sourceSystem: string,
  mode: "create_only" | "create_or_update"
): MatchResult {
  let matches: AutomationTenant[] = [];
  if (row.externalReference) {
    matches = tenants.filter(
      (tenant) =>
        tenant.sourceSystem === sourceSystem &&
        tenant.externalReference === row.externalReference
    );
  }
  if (matches.length === 0) {
    const emailMatches = row.email
      ? tenants.filter((tenant) => tenant.email === row.email && compatible(row, tenant))
      : [];
    const phoneMatches = row.phoneE164
      ? tenants.filter((tenant) => tenant.phoneE164 === row.phoneE164 && compatible(row, tenant))
      : [];
    const combined = [...new Map([...emailMatches, ...phoneMatches].map((tenant) => [tenant.id, tenant])).values()];
    if (
      emailMatches.length === 1 &&
      phoneMatches.length === 1 &&
      emailMatches[0].id !== phoneMatches[0].id
    ) {
      return {
        outcome: "conflict",
        matchedTenant: null,
        errorCodes: ["EMAIL_PHONE_MATCH_DIFFERENT_TENANTS"],
        changedFields: []
      };
    }
    matches = combined;
  }
  if (matches.length > 1) {
    return {
      outcome: "conflict",
      matchedTenant: null,
      errorCodes: ["MULTIPLE_TENANT_MATCHES"],
      changedFields: []
    };
  }
  if (matches.length === 0) {
    const nameCandidate = tenants.some(
      (tenant) =>
        tenant.fullName.toLowerCase() === row.fullName.toLowerCase() &&
        compatible(row, tenant)
    );
    return nameCandidate
      ? { outcome: "conflict", matchedTenant: null, errorCodes: ["NAME_ONLY_MATCH_REQUIRES_REVIEW"], changedFields: [] }
      : { outcome: "new", matchedTenant: null, errorCodes: [], changedFields: [] };
  }
  const tenant = matches[0];
  if (mode === "create_only") {
    return { outcome: "conflict", matchedTenant: tenant, errorCodes: ["EXISTING_TENANT_IN_CREATE_ONLY"], changedFields: [] };
  }
  const changedFields: string[] = managedFields.filter((field) => {
    const incoming = row[field];
    if ((incoming === null || incoming === "") && tenant[field]) return false;
    return JSON.stringify(incoming) !== JSON.stringify(tenant[field]);
  });
  changedFields.push(...permissionChanges(row, tenant));
  return {
    outcome: changedFields.length > 0 ? "update" : "unchanged",
    matchedTenant: tenant,
    errorCodes: [],
    changedFields: [...changedFields]
  };
}

export function detectWithinFileDuplicates(rows: Array<NormalizedTenantImportRow | null>) {
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (!row) return;
    for (const key of [
      row.externalReference ? `external:${row.externalReference}` : null,
      row.email ? `email:${row.email}` : null,
      row.phoneE164 ? `phone:${row.phoneE164}` : null
    ].filter((item): item is string => Boolean(item))) {
      groups.set(key, [...(groups.get(key) ?? []), index]);
    }
  });
  const outcomes = new Map<number, "duplicate" | "conflict">();
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const payloads = indexes.map((index) => JSON.stringify(rows[index]));
    const identical = new Set(payloads).size === 1;
    indexes.forEach((index, position) => {
      if (!identical || position > 0) outcomes.set(index, identical ? "duplicate" : "conflict");
    });
  }
  return outcomes;
}
