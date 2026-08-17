/**
 * Plain-language reading of the raw Peppol statuses Core stores in
 * `peppol/outgoing_status`.
 *
 * The `status` column is a free-form string: the integration maps a handful of
 * Dokapi statuses (SENT, DELIVERED, FAILED, ACCEPTED, REJECTED) and lowercases
 * everything else it receives (`sending_failed`, `delivery_failed`, …). So the
 * vocabulary is open — anything unknown must still be shown honestly instead of
 * being silently bucketed as "pending".
 */

/** How a transmission ended up, from the point of view of someone sending an invoice. */
export type OutgoingOutcome = "delivered" | "sent" | "in_progress" | "problem";

export interface OutgoingStatusInfo {
  outcome: OutgoingOutcome;
  /** Short label for the status pill. */
  label: string;
  /** One sentence explaining what happened, no jargon. */
  meaning: string;
  /** What the user should do now, or null when there is nothing to do. */
  nextStep: string | null;
  /** True when the label was derived from an unknown status token. */
  unknown: boolean;
}

const KNOWN: Record<string, Omit<OutgoingStatusInfo, "unknown">> = {
  sent: {
    outcome: "sent",
    label: "Sent",
    meaning: "On its way to your customer's provider.",
    nextStep: "Nothing to do. Some providers never confirm, so it can stay here.",
  },
  delivered: {
    outcome: "delivered",
    label: "Delivered",
    meaning: "Your customer's provider received it.",
    nextStep: null,
  },
  accepted: {
    outcome: "delivered",
    label: "Accepted",
    meaning: "Your customer accepted it in their accounting.",
    nextStep: null,
  },
  rejected: {
    outcome: "problem",
    label: "Refused by customer",
    meaning: "Received, then refused by your customer.",
    nextStep: "Ask your customer why, then send a corrected document.",
  },
  failed: {
    outcome: "problem",
    label: "Send failed",
    meaning: "It never reached your customer.",
    nextStep: "Fix the cause below, then send again.",
  },
  sending_failed: {
    outcome: "problem",
    label: "Send failed",
    meaning: "Stopped before leaving the network — nobody received it.",
    nextStep: "Fix the cause below, then send again.",
  },
  delivery_failed: {
    outcome: "problem",
    label: "Delivery failed",
    meaning: "Sent, but your customer's provider refused it.",
    nextStep: "Check their Peppol address, then send again.",
  },
  pending: {
    outcome: "in_progress",
    label: "Waiting",
    meaning: "Taken by the network, no result yet.",
    nextStep: "Check back in a few minutes.",
  },
  sending: {
    outcome: "in_progress",
    label: "Sending",
    meaning: "Being handed to your customer's provider.",
    nextStep: "Check back in a few minutes.",
  },
  created: {
    outcome: "in_progress",
    label: "Preparing",
    meaning: "Registered, waiting to be sent.",
    nextStep: "Check back in a few minutes.",
  },
  validated: {
    outcome: "in_progress",
    label: "Not sent yet",
    meaning: "Passed the Peppol checks, queued for sending.",
    nextStep: "Check back in a few minutes.",
  },
};

const PROBLEM_HINTS = /fail|error|invalid|reject|refus|cancel|abort|expire/i;

/** `sending_failed` → `Sending failed`. */
export function humanizeStatusToken(status: string): string {
  const words = status.replace(/[_-]+/g, " ").trim();
  if (!words) return "Unknown";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function describeOutgoingStatus(status: string): OutgoingStatusInfo {
  const key = (status ?? "").trim().toLowerCase();
  const known = KNOWN[key];
  if (known) return { ...known, unknown: false };

  // Unknown status: stay honest — show the network's own wording, and only
  // claim there is a problem when the wording says so.
  const isProblem = PROBLEM_HINTS.test(key);
  return {
    outcome: isProblem ? "problem" : "in_progress",
    label: humanizeStatusToken(key),
    meaning: isProblem
      ? "The network reported a problem."
      : "Status reported by the network, not described yet.",
    nextStep: isProblem
      ? "See the technical details, then send again."
      : "Contact support if this line never changes.",
    unknown: true,
  };
}

/**
 * Strips the handler boilerplate Core stores in `error_message`
 * ("Status changed to SENT by …Handler on <date>") and keeps the part that
 * actually says something. Returns null when nothing useful is left — success
 * rows carry boilerplate only and must not look like errors.
 */
export function cleanStatusMessage(raw: string): string | null {
  const message = (raw ?? "").trim();
  if (!message) return null;

  const afterError = message.match(/with ERRORS?:\s*(.+)$/is);
  if (afterError) return afterError[1].trim();

  if (/^status changed to\b/i.test(message)) return null;
  return message;
}

export interface ErrorExplanation {
  title: string;
  detail: string;
  nextStep: string;
}

/**
 * Turns a raw failure message into something a non-technical user can act on.
 * Always returns an explanation for problem rows, falling back to a generic one.
 */
export function explainFailure(raw: string): ErrorExplanation {
  const message = cleanStatusMessage(raw) ?? "";

  if (/validation status was invalid|validation failed|schematron|not compliant/i.test(message)) {
    return {
      title: "Failed the Peppol checks",
      detail:
        "Usually a missing VAT number, a missing address, or a credit note with no link to its invoice.",
      nextStep: "Fix the warnings in the Compliance tab, then send again.",
    };
  }

  if (/participant|receiver|recipient|not registered|unknown endpoint|smp|no such/i.test(message)) {
    return {
      title: "Customer not found on Peppol",
      detail: "Their Peppol address matches no registered receiver, or they are not on Peppol.",
      nextStep: "Correct the customer's Peppol address, then send again.",
    };
  }

  if (/timeout|timed out|connection|network|unavailable|503|502|gateway/i.test(message)) {
    return {
      title: "Temporary network problem",
      detail: "The network was unreachable while sending. Nothing wrong with your document.",
      nextStep: "Send again in a few minutes.",
    };
  }

  if (/certificat|signature|credential|unauthorized|401|403/i.test(message)) {
    return {
      title: "Peppol access refused",
      detail: "The network refused the credentials used to send on your behalf.",
      nextStep: "Check your Peppol registration in Settings, then contact support.",
    };
  }

  return {
    title: "Could not be sent",
    detail: message ? "Reason given: " + message : "The network gave no reason.",
    nextStep: "Send again, or copy the details for support.",
  };
}

/** Groups status events per document, newest document first, events oldest first. */
export interface OutgoingEvent {
  id: string;
  document_ulid: string;
  status: string;
  as4_message_id: string;
  error_message: string;
  delivered_at: string;
  created_at: string;
}

export interface OutgoingTransmission<E extends OutgoingEvent = OutgoingEvent> {
  documentUlid: string;
  /** Oldest first — the story of the transmission. */
  events: E[];
  /** The event that decides what we show: the most recent one. */
  latest: E;
  firstSeenAt: string;
  deliveredAt: string;
}

/**
 * Reconciles what Billing recorded with what the network reported.
 *
 * `peppol_send_log` is written once, at send time, and says "sent" forever — the
 * webhook that later reports a failure lands in `peppol/outgoing_status` instead.
 * Trusting the log alone leaves an invoice locked as "sent" while the network says
 * nobody received it, so the user can neither fix nor resend it. The network wins.
 */
export function reconcileSendStatuses<S extends string>(
  logs: readonly { dokapi_ulid: string; status: S }[],
  events: readonly OutgoingEvent[],
): (S | "failed")[] {
  const outcomeByUlid = new Map(
    groupTransmissions(events).map((t) => [t.documentUlid, describeOutgoingStatus(t.latest.status).outcome]),
  );

  return logs.map((log) => {
    const outcome = log.dokapi_ulid ? outcomeByUlid.get(log.dokapi_ulid) : undefined;
    return outcome === "problem" ? "failed" : log.status;
  });
}

export function groupTransmissions<E extends OutgoingEvent>(events: readonly E[]): OutgoingTransmission<E>[] {
  const byUlid = new Map<string, E[]>();
  for (const event of events) {
    const list = byUlid.get(event.document_ulid);
    if (list) list.push(event);
    else byUlid.set(event.document_ulid, [event]);
  }

  const time = (ts: string) => new Date(ts).getTime() || 0;

  return [...byUlid.entries()]
    .map(([documentUlid, list]) => {
      const ordered = [...list].sort((a, b) => time(a.created_at) - time(b.created_at));
      return {
        documentUlid,
        events: ordered,
        latest: ordered[ordered.length - 1],
        firstSeenAt: ordered[0].created_at,
        deliveredAt: ordered.find((e) => e.delivered_at)?.delivered_at ?? "",
      };
    })
    .sort((a, b) => time(b.latest.created_at) - time(a.latest.created_at));
}
