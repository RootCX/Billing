import { describe, it, expect } from "vitest";
import {
  cleanStatusMessage,
  describeOutgoingStatus,
  explainFailure,
  groupTransmissions,
  humanizeStatusToken,
  reconcileSendStatuses,
  type OutgoingEvent,
  type OutgoingOutcome,
} from "./peppolOutgoing";

describe("describeOutgoingStatus", () => {
  it.each<[string, OutgoingOutcome]>([
    ["sent", "sent"],
    ["delivered", "delivered"],
    ["accepted", "delivered"],
    ["pending", "in_progress"],
    ["sending", "in_progress"],
    ["failed", "problem"],
    ["rejected", "problem"],
    // The status that used to be shown as "Pending" — the whole point of this module.
    ["sending_failed", "problem"],
    ["delivery_failed", "problem"],
  ])("maps %j to outcome %s", (status, outcome) => {
    expect(describeOutgoingStatus(status).outcome).toBe(outcome);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(describeOutgoingStatus("  SENDING_FAILED ").label).toBe("Send failed");
  });

  it("never labels an unknown status as a known one", () => {
    const info = describeOutgoingStatus("quarantined_by_ap");
    expect(info.unknown).toBe(true);
    expect(info.label).toBe("Quarantined by ap");
    expect(info.outcome).toBe("in_progress");
  });

  it("treats unknown statuses that read like errors as problems", () => {
    expect(describeOutgoingStatus("ap_rejected_document").outcome).toBe("problem");
    expect(describeOutgoingStatus("upload_error").outcome).toBe("problem");
  });

  it("gives a next step for every problem status", () => {
    for (const status of ["failed", "sending_failed", "delivery_failed", "rejected", "weird_failure"]) {
      expect(describeOutgoingStatus(status).nextStep).toBeTruthy();
    }
  });

  it("has nothing to do once delivered", () => {
    expect(describeOutgoingStatus("delivered").nextStep).toBeNull();
  });
});

describe("humanizeStatusToken", () => {
  it.each([
    ["sending_failed", "Sending failed"],
    ["DELIVERY-FAILED", "Delivery failed"],
    ["sent", "Sent"],
    ["", "Unknown"],
  ])("turns %j into %j", (raw, expected) => {
    expect(humanizeStatusToken(raw)).toBe(expected);
  });
});

describe("cleanStatusMessage", () => {
  it("drops handler boilerplate on success rows", () => {
    expect(
      cleanStatusMessage(
        "Status changed to SENT by OutgoingPeppolDocumentSentHandler Handler on 2026-08-17T02:39:18.442Z",
      ),
    ).toBeNull();
  });

  it("keeps only the reason on failure rows", () => {
    expect(
      cleanStatusMessage(
        "Status changed to SENDING_FAILED by OutgoingPeppolDocumentUploadHandler Handler on 2026-08-17T02:36:37.624Z with ERROR: Validation status was INVALID but should be VALID",
      ),
    ).toBe("Validation status was INVALID but should be VALID");
  });

  it("passes through a plain message and handles empty input", () => {
    expect(cleanStatusMessage("Receiver not registered")).toBe("Receiver not registered");
    expect(cleanStatusMessage("")).toBeNull();
  });
});

describe("explainFailure", () => {
  it("explains a validation failure in plain words", () => {
    const e = explainFailure(
      "Status changed to SENDING_FAILED by Handler on 2026-08-17T02:36:37.624Z with ERROR: Validation status was INVALID but should be VALID",
    );
    expect(e.title).toMatch(/Peppol checks/i);
    expect(e.nextStep).toMatch(/Compliance/i);
  });

  it("explains an unreachable receiver", () => {
    expect(explainFailure("ERROR: participant not registered in SMP").title).toMatch(/not found on Peppol/i);
  });

  it("falls back to a generic explanation without leaving the user empty-handed", () => {
    const e = explainFailure("");
    expect(e.title).toBeTruthy();
    expect(e.detail).toBeTruthy();
    expect(e.nextStep).toBeTruthy();
  });
});

describe("reconcileSendStatuses", () => {
  const event = (ulid: string, status: string, created: string): OutgoingEvent => ({
    id: `${ulid}-${status}`,
    document_ulid: ulid,
    status,
    as4_message_id: "",
    error_message: "",
    delivered_at: "",
    created_at: created,
  });

  it("downgrades a log the network says failed", () => {
    expect(
      reconcileSendStatuses(
        [{ dokapi_ulid: "A", status: "sent" as const }],
        [event("A", "sent", "2026-08-17T02:00:00Z"), event("A", "sending_failed", "2026-08-17T02:01:00Z")],
      ),
    ).toEqual(["failed"]);
  });

  it("keeps the log when the network confirms or is still working on it", () => {
    const logs = [{ dokapi_ulid: "A", status: "sent" as const }];
    expect(reconcileSendStatuses(logs, [event("A", "delivered", "2026-08-17T02:00:00Z")])).toEqual(["sent"]);
    expect(reconcileSendStatuses(logs, [event("A", "pending", "2026-08-17T02:00:00Z")])).toEqual(["sent"]);
  });

  it("only trusts the latest event of a transmission", () => {
    expect(
      reconcileSendStatuses(
        [{ dokapi_ulid: "A", status: "sent" as const }],
        [event("A", "sending_failed", "2026-08-17T02:00:00Z"), event("A", "delivered", "2026-08-17T02:05:00Z")],
      ),
    ).toEqual(["sent"]);
  });

  it("leaves a log alone when the network knows nothing about it", () => {
    expect(reconcileSendStatuses([{ dokapi_ulid: "A", status: "sent" as const }], [])).toEqual(["sent"]);
    expect(reconcileSendStatuses([{ dokapi_ulid: "", status: "failed" as const }], [event("A", "delivered", "2026-08-17T02:00:00Z")]))
      .toEqual(["failed"]);
  });

  it("reconciles each transmission of a document independently", () => {
    expect(
      reconcileSendStatuses(
        [{ dokapi_ulid: "A", status: "sent" as const }, { dokapi_ulid: "B", status: "sent" as const }],
        [event("A", "rejected", "2026-08-17T02:00:00Z"), event("B", "delivered", "2026-08-17T03:00:00Z")],
      ),
    ).toEqual(["failed", "sent"]);
  });
});

describe("groupTransmissions", () => {
  const event = (id: string, ulid: string, status: string, created: string, delivered = ""): OutgoingEvent => ({
    id,
    document_ulid: ulid,
    status,
    as4_message_id: "",
    error_message: "",
    delivered_at: delivered,
    created_at: created,
  });

  it("groups events per document and keeps the latest as authoritative", () => {
    const groups = groupTransmissions([
      event("1", "A", "sent", "2026-08-17T02:00:00Z"),
      event("2", "A", "delivered", "2026-08-17T02:05:00Z", "2026-08-17T02:05:00Z"),
      event("3", "B", "sending_failed", "2026-08-17T01:00:00Z"),
    ]);

    expect(groups.map((g) => g.documentUlid)).toEqual(["A", "B"]); // newest document first
    expect(groups[0].latest.status).toBe("delivered");
    expect(groups[0].events.map((e) => e.id)).toEqual(["1", "2"]); // oldest first
    expect(groups[0].firstSeenAt).toBe("2026-08-17T02:00:00Z");
    expect(groups[0].deliveredAt).toBe("2026-08-17T02:05:00Z");
    expect(groups[1].deliveredAt).toBe("");
  });

  it("handles out-of-order input and a single event", () => {
    const groups = groupTransmissions([
      event("2", "A", "delivered", "2026-08-17T02:05:00Z"),
      event("1", "A", "sent", "2026-08-17T02:00:00Z"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].latest.id).toBe("2");
  });

  it("returns nothing for no events", () => {
    expect(groupTransmissions([])).toEqual([]);
  });
});
