import type { ClientApplicationRecord } from "@/features/applications/contracts";

export const APPLICATION_QUEUE_TABS = [
  ["under_review", "Under review"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["contract_signed", "Contract signed"]
] as const;

export type ApplicationQueueFilter = typeof APPLICATION_QUEUE_TABS[number][0];

export function resolveApplicationQueueFilter(value: unknown): ApplicationQueueFilter {
  return APPLICATION_QUEUE_TABS.find(([key]) => key === value)?.[0] ?? "under_review";
}

export function matchesApplicationQueueFilter(
  application: Pick<ClientApplicationRecord, "status" | "leaseDocument">,
  filter: ApplicationQueueFilter
) {
  if (filter === "under_review") {
    return ["submitted", "received", "under_review", "needs_information"].includes(application.status);
  }
  if (filter === "rejected") return application.status === "declined";
  if (filter === "contract_signed") return application.status === "approved" && Boolean(application.leaseDocument);
  return application.status === "approved";
}
