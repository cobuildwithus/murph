import { describe, expect, it } from "vitest";

import { parseHostedExecutionWake } from "../src/parsers.ts";
import { HOSTED_MAILBOX_KINDS } from "../src/runtime-control.ts";
import {
  buildHostedVaultShareDeliveryDedupeKey,
  HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHTS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  parseHostedVaultShareDeliverRequest,
  parseHostedVaultShareDeliverResponse,
} from "../src/vault-share.ts";

const VALID_NIGHT = {
  date: "2026-06-09",
  sleepEndAt: "2026-06-10T06:31:00.000Z",
  sleepStartAt: "2026-06-09T22:04:00.000Z",
};

const VALID_DELIVERY = {
  grantorMemberId: "member_grantor",
  night: VALID_NIGHT,
  projectionKind: "sleep-times.v0",
  schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  shareId: "share_1",
};

describe("vault-share contracts", () => {
  it("registers the delivery kind in the mailbox kind registry", () => {
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.delivery");
  });

  it("derives the dedupe key from share id and night date", () => {
    expect(
      buildHostedVaultShareDeliveryDedupeKey({ date: "2026-06-09", shareId: "share_1" }),
    ).toBe("vault-share:share_1:2026-06-09");
  });

  it("parses a valid deliver request", () => {
    const parsed = parseHostedVaultShareDeliverRequest({
      nights: [VALID_NIGHT],
      projectionKind: "sleep-times.v0",
    });

    expect(parsed.nights).toEqual([VALID_NIGHT]);
    expect(parsed.projectionKind).toBe("sleep-times.v0");
  });

  it("rejects an empty nights array", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({ nights: [], projectionKind: "sleep-times.v0" }),
    ).toThrow(/must not be empty/u);
  });

  it("rejects more nights than the cap", () => {
    const nights = Array.from(
      { length: HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHTS + 1 },
      (_, index) => ({
        ...VALID_NIGHT,
        date: `2026-06-${String(index + 1).padStart(2, "0")}`,
      }),
    );

    expect(() =>
      parseHostedVaultShareDeliverRequest({ nights, projectionKind: "sleep-times.v0" }),
    ).toThrow(/at most/u);
  });

  it("rejects an unknown projection kind", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        nights: [VALID_NIGHT],
        projectionKind: "biometrics.everything",
      }),
    ).toThrow(/known vault-share projection kind/u);
  });

  it("rejects malformed dates and timestamps", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        nights: [{ ...VALID_NIGHT, date: "June 9th" }],
        projectionKind: "sleep-times.v0",
      }),
    ).toThrow(/YYYY-MM-DD/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        nights: [{ ...VALID_NIGHT, sleepStartAt: "late" }],
        projectionKind: "sleep-times.v0",
      }),
    ).toThrow(/ISO-8601/u);
  });

  it("parses deliver responses and rejects unknown statuses", () => {
    expect(
      parseHostedVaultShareDeliverResponse({
        appendedCount: 2,
        duplicateCount: 1,
        status: "delivered",
      }),
    ).toEqual({ appendedCount: 2, duplicateCount: 1, status: "delivered" });
    expect(() =>
      parseHostedVaultShareDeliverResponse({
        appendedCount: 0,
        duplicateCount: 0,
        status: "partial",
      }),
    ).toThrow(/delivered or no-active-share/u);
  });

  it("round-trips a vault-share delivery wake through the wake parser", () => {
    const parsed = parseHostedExecutionWake({
      delivery: VALID_DELIVERY,
      eventId: "vault-share:share_1:2026-06-09",
      kind: "vault-share.delivery",
      occurredAt: "2026-06-10T07:00:00.000Z",
      userId: "member_referee",
    });

    expect(parsed).toEqual({
      delivery: VALID_DELIVERY,
      eventId: "vault-share:share_1:2026-06-09",
      kind: "vault-share.delivery",
      occurredAt: "2026-06-10T07:00:00.000Z",
      userId: "member_referee",
    });
  });

  it("rejects a delivery wake whose payload schema is wrong", () => {
    expect(() =>
      parseHostedExecutionWake({
        delivery: { ...VALID_DELIVERY, schema: "murph.vault-share.delivery.v999" },
        eventId: "vault-share:share_1:2026-06-09",
        kind: "vault-share.delivery",
        occurredAt: "2026-06-10T07:00:00.000Z",
        userId: "member_referee",
      }),
    ).toThrow(/delivery payload schema/u);
  });
});
