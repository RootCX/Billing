import { describe, expect, it } from "vitest";
import { getPeppolSendState, type PeppolSendState, type PeppolSendStatus } from "./types";

describe("getPeppolSendState", () => {
  it.each<[PeppolSendStatus[], PeppolSendState]>([
    [[], "retryable"],
    [["failed"], "retryable"],
    [["failed", "pending"], "pending"],
    [["failed", "sent"], "sent"],
    [["sent", "failed"], "sent"],
    [["pending", "delivered"], "sent"],
  ])("classifies history %j as %s", (statuses, expected) => {
    expect(getPeppolSendState(statuses)).toBe(expected);
  });
});
