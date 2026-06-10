import { describe, expect, it } from "vitest";

import { parseHostedExecutionWake } from "../src/parsers.ts";
import { HOSTED_MAILBOX_KINDS } from "../src/runtime-control.ts";
import {
  buildHostedVaultShareDeliveryDedupeKey,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  parseHostedVaultShareDeliverRequest,
  parseHostedVaultShareDeliverResponse,
} from "../src/vault-share.ts";

const VALID_RECORD = {
  data: {
    date: "2026-06-09",
    sleepEndAt: "2026-06-10T06:31:00.000Z",
    sleepStartAt: "2026-06-09T22:04:00.000Z",
  },
  occurredAt: "2026-06-10T06:31:00.000Z",
  recordKey: "2026-06-09",
};

const VALID_DELIVERY = {
  grantorMemberId: "member_grantor",
  projectionKind: "sleep-times.v0",
  record: VALID_RECORD,
  schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  shareId: "share_1",
};

describe("vault-share contracts", () => {
  it("registers the delivery kind in the mailbox kind registry", () => {
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.delivery");
  });

  it("derives the dedupe key from share id and record key", () => {
    expect(
      buildHostedVaultShareDeliveryDedupeKey({ recordKey: "2026-06-09", shareId: "share_1" }),
    ).toBe("vault-share:share_1:2026-06-09");
  });

  it("parses a valid deliver request", () => {
    const parsed = parseHostedVaultShareDeliverRequest({
      projectionKind: "sleep-times.v0",
      records: [VALID_RECORD],
    });

    expect(parsed.records).toEqual([VALID_RECORD]);
    expect(parsed.projectionKind).toBe("sleep-times.v0");
  });

  it("rejects an empty records array", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({ projectionKind: "sleep-times.v0", records: [] }),
    ).toThrow(/must not be empty/u);
  });

  it("rejects more records than the cap", () => {
    const records = Array.from(
      { length: HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS + 1 },
      (_, index) => {
        const date = `2026-06-${String(index + 1).padStart(2, "0")}`;

        return {
          ...VALID_RECORD,
          data: { ...VALID_RECORD.data, date },
          recordKey: date,
        };
      },
    );

    expect(() =>
      parseHostedVaultShareDeliverRequest({ projectionKind: "sleep-times.v0", records }),
    ).toThrow(/at most/u);
  });

  it("rejects an unknown projection kind", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "biometrics.everything",
        records: [VALID_RECORD],
      }),
    ).toThrow(/known vault-share projection kind/u);
  });

  it("rejects record keys that are not path-safe", () => {
    for (const recordKey of ["../x", "a/b", "a..b", "x".repeat(129)]) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "sleep-times.v0",
          records: [{ ...VALID_RECORD, recordKey }],
        }),
      ).toThrow(/path-safe/u);
    }
  });

  it("rejects a sleep record whose recordKey drifts from the data date", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{ ...VALID_RECORD, recordKey: "2026-06-08" }],
      }),
    ).toThrow(/recordKey must equal the data date/u);
  });

  it("rejects malformed dates and timestamps", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          data: { ...VALID_RECORD.data, date: "June 9th" },
          recordKey: "June9th",
        }],
      }),
    ).toThrow(/YYYY-MM-DD/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          data: { ...VALID_RECORD.data, date: "2026-02-31" },
          recordKey: "2026-02-31",
        }],
      }),
    ).toThrow(/YYYY-MM-DD/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{ ...VALID_RECORD, occurredAt: "later" }],
      }),
    ).toThrow(/ISO-8601/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          data: { ...VALID_RECORD.data, sleepStartAt: "late" },
        }],
      }),
    ).toThrow(/ISO-8601/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          data: { ...VALID_RECORD.data, sleepEndAt: "2026-02-31T00:00:00.000Z" },
        }],
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
