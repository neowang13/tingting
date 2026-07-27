import type {
  NotificationEvent,
  NotificationStatus
} from "@/lib/contracts";

export interface NotificationStatusPresentation {
  label: string;
  tone: "waiting" | "success" | "danger" | "neutral";
  explanation: string;
}

const statusPresentation: Record<NotificationStatus, NotificationStatusPresentation> = {
  scheduled: {
    label: "Waiting to send",
    tone: "waiting",
    explanation: "The reminder is in the queue. It has not been sent yet."
  },
  processing: {
    label: "Sending now",
    tone: "waiting",
    explanation: "The system is handing the email to the delivery provider."
  },
  queued: {
    label: "Accepted for delivery",
    tone: "waiting",
    explanation: "The email provider accepted the message, but delivery is not confirmed yet."
  },
  sent: {
    label: "Sent",
    tone: "success",
    explanation: "The email provider reports that the message was sent."
  },
  delivered: {
    label: "Delivered",
    tone: "success",
    explanation: "The recipient's mail server accepted the message."
  },
  failed: {
    label: "Not sent",
    tone: "danger",
    explanation: "The send attempt failed. Review the reason before trying again."
  },
  undelivered: {
    label: "Delivery failed",
    tone: "danger",
    explanation: "The provider could not deliver the message to the recipient."
  },
  skipped: {
    label: "Skipped",
    tone: "neutral",
    explanation: "The reminder was not sent because the tenant or email was not eligible."
  },
  unknown: {
    label: "Check delivery",
    tone: "danger",
    explanation: "The provider result is unclear. Check before sending another copy."
  },
  expired: {
    label: "Missed schedule",
    tone: "danger",
    explanation: "The reminder was more than 24 hours late and was not sent."
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    explanation: "The reminder was stopped before delivery."
  }
};

export function notificationStatusCopy(status: NotificationStatus) {
  return statusPresentation[status];
}

export function notificationSourceLabel(source: NotificationEvent["source"]) {
  return {
    scheduled: "Automatic reminder",
    manual: "One-time reminder",
    test: "Test email",
    retry: "Retry"
  }[source];
}

export function deliveryModeCopy(mode: string) {
  if (mode === "live") {
    return {
      label: "Live email delivery",
      tone: "success" as const,
      explanation: "Confirmed emails can be sent to real recipients."
    };
  }
  if (mode === "mock") {
    return {
      label: "Test mode",
      tone: "waiting" as const,
      explanation: "The system records the send, but no real email leaves the app."
    };
  }
  return {
    label: "Email delivery is off",
    tone: "danger" as const,
    explanation: "You can preview emails, but the app cannot send them."
  };
}
