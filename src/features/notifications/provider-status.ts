import type { NotificationStatus } from "@/lib/contracts";

export function mapResendStatus(providerStatus: string): NotificationStatus {
  if (providerStatus.includes("delivered")) return "delivered";
  if (providerStatus.includes("bounced") || providerStatus.includes("complained")) return "undelivered";
  if (providerStatus.includes("failed")) return "failed";
  if (providerStatus.includes("sent")) return "sent";
  return "queued";
}

export function mapTwilioStatus(providerStatus: string): NotificationStatus {
  if (providerStatus === "delivered") return "delivered";
  if (providerStatus === "undelivered") return "undelivered";
  if (providerStatus === "failed") return "failed";
  if (providerStatus === "sent") return "sent";
  return "queued";
}
