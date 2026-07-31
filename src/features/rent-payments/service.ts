import { Temporal } from "@js-temporal/polyfill";
import { ApiError } from "@/lib/api";
import type {
  RentPaymentDetail,
  RentReportSnapshot,
  Tenant,
  TenantRentPayment
} from "@/lib/contracts";

export const RENT_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RENT_RECEIPT_BUCKET = "tenant-rent-payment-receipts";

const receiptTypes = {
  "application/pdf": { extension: "pdf", signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  "image/jpeg": { extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": {
    extension: "png",
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  },
  "image/webp": { extension: "webp", signature: [] }
} as const;

export type RentReceiptMimeType = keyof typeof receiptTypes;

export function paymentPeriod(value: string) {
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(normalized);
  } catch {
    throw new ApiError(422, "PAYMENT_PERIOD_INVALID", "Use a valid rent month in YYYY-MM format.");
  }
  if (date.day !== 1) {
    throw new ApiError(422, "PAYMENT_PERIOD_INVALID", "The rent month must use the first day of the month.");
  }
  return date.toString();
}

export function rentDueDateForPeriod(period: string, rentDueDay: number) {
  const month = Temporal.PlainDate.from(paymentPeriod(period));
  return month.with({ day: Math.min(rentDueDay, month.daysInMonth) }).toString();
}

export function currentPaymentPeriod(
  instant = new Date().toISOString(),
  timezone = "America/Vancouver"
) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .with({ day: 1 })
    .toString();
}

export function rentReportWindow(
  instant = new Date().toISOString(),
  timezone = "America/Vancouver"
) {
  const localNow = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
  const today = localNow.toPlainDate();
  const weekStart = today.subtract({ days: today.dayOfWeek - 1 });
  const weekEnd = weekStart.add({ days: 7 });
  const nextWeekStart = weekEnd;
  const nextWeekEnd = nextWeekStart.add({ days: 7 });
  return {
    timezone,
    generatedThrough: instant,
    today: today.toString(),
    weekStart: weekStart.toString(),
    weekEnd: weekEnd.toString(),
    nextWeekStart: nextWeekStart.toString(),
    nextWeekEnd: nextWeekEnd.toString(),
    leaseExpiryWindowEnd: today.add({ days: 30 }).toString()
  };
}

export function calendarDaysBetween(start: string, end: string) {
  return Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end)).days;
}

function startOfLocalDayInstant(date: string, timezone: string) {
  return Temporal.PlainDate.from(date)
    .toZonedDateTime({
      timeZone: timezone,
      plainTime: Temporal.PlainTime.from("00:00")
    })
    .toInstant()
    .toString();
}

export function validateRentReceipt(
  filename: string,
  declaredMimeType: string,
  bytes: Uint8Array
) {
  if (bytes.byteLength === 0 || bytes.byteLength > RENT_RECEIPT_MAX_BYTES) {
    throw new ApiError(
      422,
      "RECEIPT_SIZE_INVALID",
      `The receipt must be smaller than ${RENT_RECEIPT_MAX_BYTES / 1024 / 1024} MB.`
    );
  }
  if (!(declaredMimeType in receiptTypes)) {
    throw new ApiError(422, "RECEIPT_TYPE_INVALID", "Upload a PDF, JPG, PNG, or WEBP receipt.");
  }
  const mimeType = declaredMimeType as RentReceiptMimeType;
  const spec = receiptTypes[mimeType];
  const extension = filename.trim().split(".").pop()?.toLowerCase();
  const acceptedExtensions = mimeType === "image/jpeg" ? ["jpg", "jpeg"] : [spec.extension];
  if (!extension || !acceptedExtensions.includes(extension)) {
    throw new ApiError(422, "RECEIPT_EXTENSION_INVALID", "The receipt filename does not match its file type.");
  }
  const signatureMatches = spec.signature.every((value, index) => bytes[index] === value);
  const webpMatches = mimeType !== "image/webp" || (
    bytes.byteLength >= 12
    && new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
  );
  if (!signatureMatches || !webpMatches) {
    throw new ApiError(422, "RECEIPT_CONTENT_INVALID", "The receipt contents do not match its file type.");
  }
  return {
    mimeType,
    extension: spec.extension,
    originalFilename: sanitizeReceiptFilename(filename),
    byteSize: bytes.byteLength
  };
}

export function sanitizeReceiptFilename(filename: string) {
  const normalized = filename
    .normalize("NFKC")
    .replace(/[/\\\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return normalized || "receipt";
}

export function receiptStorageKey(
  tenantId: string,
  period: string,
  digest: string,
  extension: string
) {
  const hash = digest.replace(/^sha256:/, "");
  return `${tenantId}/${paymentPeriod(period)}/${hash}.${extension}`;
}

export function isTenantLiableForPeriod(input: {
  leaseType: "fixed_term" | "month_to_month" | null;
  moveInDate: string | null;
  leaseEndDate: string | null;
  period: string;
}) {
  if (!input.leaseType || !input.moveInDate) return false;
  const periodStart = Temporal.PlainDate.from(paymentPeriod(input.period));
  const periodEnd = periodStart.add({ months: 1 }).subtract({ days: 1 });
  const leaseStart = Temporal.PlainDate.from(input.moveInDate);
  if (Temporal.PlainDate.compare(leaseStart, periodEnd) > 0) return false;
  if (input.leaseType === "month_to_month") return true;
  if (!input.leaseEndDate) return false;
  return Temporal.PlainDate.compare(
    periodStart,
    Temporal.PlainDate.from(input.leaseEndDate).with({ day: 1 })
  ) <= 0;
}

export function buildRentReportSnapshot(input: {
  tenants: Tenant[];
  payments: TenantRentPayment[];
  instant: string;
  timezone: string;
}): RentReportSnapshot {
  const window = rentReportWindow(input.instant, input.timezone);
  const recentCollectionStart = Temporal.Instant.from(
    startOfLocalDayInstant(window.weekStart, input.timezone)
  );
  const reportInstant = Temporal.Instant.from(input.instant);
  const tenants = new Map(input.tenants.map((tenant) => [tenant.id, tenant]));
  const details = input.payments.flatMap((payment) => {
    const tenant = tenants.get(payment.tenantId);
    return tenant ? [{ tenant, payment }] : [];
  });
  const activeDetails = details.filter((detail) =>
    detail.tenant.isActive && !detail.tenant.archivedAt
  );
  const between = (detail: RentPaymentDetail, start: string, end: string) =>
    detail.payment.dueDate >= start && detail.payment.dueDate < end;
  const thisWeekDue = activeDetails.filter((detail) =>
    between(detail, window.weekStart, window.weekEnd)
  );
  const nextWeekDue = activeDetails.filter((detail) =>
    between(detail, window.nextWeekStart, window.nextWeekEnd)
  );
  const activeTenants = input.tenants.filter((tenant) => tenant.isActive && !tenant.archivedAt);
  const expiring = activeTenants
    .filter((tenant) => tenant.leaseType === "fixed_term" && tenant.leaseEndDate)
    .map((tenant) => ({
      tenant,
      daysRemaining: calendarDaysBetween(window.today, tenant.leaseEndDate!)
    }))
    .sort((left, right) =>
      left.tenant.leaseEndDate!.localeCompare(right.tenant.leaseEndDate!)
      || left.tenant.fullName.localeCompare(right.tenant.fullName)
    );
  const overdue = activeDetails
    .filter((detail) => detail.payment.status === "due" && detail.payment.dueDate < window.today)
    .map((detail) => ({
      ...detail,
      daysOverdue: calendarDaysBetween(detail.payment.dueDate, window.today)
    }))
    .sort((left, right) =>
      left.payment.dueDate.localeCompare(right.payment.dueDate)
      || left.tenant.propertyLabel.localeCompare(right.tenant.propertyLabel)
      || left.tenant.fullName.localeCompare(right.tenant.fullName)
    );
  return {
    timezone: window.timezone,
    generatedThrough: window.generatedThrough,
    weekStart: window.weekStart,
    weekEnd: window.weekEnd,
    nextWeekStart: window.nextWeekStart,
    nextWeekEnd: window.nextWeekEnd,
    leaseExpiryWindowEnd: window.leaseExpiryWindowEnd,
    thisWeek: {
      due: thisWeekDue,
      collected: thisWeekDue.filter((detail) => detail.payment.status === "collected"),
      outstanding: thisWeekDue.filter((detail) => detail.payment.status === "due")
    },
    nextWeek: {
      due: nextWeekDue,
      collectedEarly: nextWeekDue.filter((detail) => detail.payment.status === "collected"),
      outstanding: nextWeekDue.filter((detail) => detail.payment.status === "due")
    },
    overdue,
    leases: {
      monthToMonthCount: activeTenants.filter((tenant) => tenant.leaseType === "month_to_month").length,
      expiringWithin7Days: expiring.filter((detail) =>
        detail.daysRemaining >= 0 && detail.daysRemaining <= 7
      ),
      expiringWithin30Days: expiring.filter((detail) =>
        detail.daysRemaining >= 0 && detail.daysRemaining <= 30
      ),
      expiredActive: expiring.filter((detail) => detail.daysRemaining < 0)
    },
    recentCollections: details
      .filter((detail) =>
        detail.payment.status === "collected"
        && detail.payment.collectedAt
        && Temporal.Instant.compare(
          Temporal.Instant.from(detail.payment.collectedAt),
          recentCollectionStart
        ) >= 0
        && Temporal.Instant.compare(
          Temporal.Instant.from(detail.payment.collectedAt),
          reportInstant
        ) <= 0
      )
      .sort((left, right) =>
        (right.payment.collectedAt ?? "").localeCompare(left.payment.collectedAt ?? "")
      )
  };
}
