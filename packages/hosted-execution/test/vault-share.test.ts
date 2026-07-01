import { describe, expect, it } from "vitest";

import { parseHostedExecutionWake } from "../src/parsers.ts";
import { HOSTED_MAILBOX_KINDS } from "../src/runtime-control.ts";
import {
  buildHostedVaultShareDeliveryDedupeKey,
  buildHostedVaultShareRevokeDedupeKey,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
  parseHostedVaultShareDeliverRequest,
  parseHostedVaultShareDeliverResponse,
} from "../src/vault-share.ts";

const VALID_RECORD = {
  data: {
    date: "2026-06-09",
    sleepEndAt: "2026-06-10T06:31:00.000Z",
    sleepStartAt: "2026-06-09T22:04:00.000Z",
  },
  occurredAt: "2026-06-09T00:00:00.000Z",
  recordKey: "2026-06-09",
};

const VALID_DELIVERY = {
  grantorMemberId: "member_grantor",
  projectionKind: "sleep-times.v0",
  record: VALID_RECORD,
  schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  shareId: "share_1",
};

const VALID_REVOKE = {
  grantorMemberId: "member_grantor",
  projectionKind: "sleep-times.v0",
  revokedAt: "2026-07-01T00:00:00.000Z",
  schema: HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
  shareId: "share_1",
};

describe("vault-share contracts", () => {
  it("registers vault-share kinds in the mailbox kind registry", () => {
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.delivery");
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.revoke");
  });

  it("derives the dedupe key from share id and record key", () => {
    expect(
      buildHostedVaultShareDeliveryDedupeKey({ recordKey: "2026-06-09", shareId: "share_1" }),
    ).toBe("vault-share:share_1:2026-06-09");
  });

  it("derives the revoke dedupe key from share id and revocation timestamp", () => {
    expect(
      buildHostedVaultShareRevokeDedupeKey({
        revokedAt: "2026-07-01T00:00:00.000Z",
        shareId: "share_1",
      }),
    ).toBe("vault-share-revoke:share_1:2026-07-01T00:00:00.000Z");
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

  it("rejects a sleep record whose occurredAt is not the night-date UTC midnight", () => {
    // occurredAt is plaintext mailbox metadata on the destination side; anything beyond
    // the night date (e.g. the exact wake timestamp) would leak sleep timing into Postgres.
    for (const occurredAt of ["2026-06-10T06:31:00.000Z", "2026-06-09T00:00:00Z"]) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "sleep-times.v0",
          records: [{ ...VALID_RECORD, occurredAt }],
        }),
      ).toThrow(/night date at UTC midnight/u);
    }
  });

  it("rejects reversed or implausibly long sleep windows", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          data: {
            ...VALID_RECORD.data,
            sleepEndAt: "2026-06-09T22:04:00.000Z",
            sleepStartAt: "2026-06-10T06:31:00.000Z",
          },
        }],
      }),
    ).toThrow(/end after it starts/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          data: {
            ...VALID_RECORD.data,
            sleepEndAt: "2026-06-11T22:05:00.000Z",
            sleepStartAt: "2026-06-09T22:04:00.000Z",
          },
        }],
      }),
    ).toThrow(/at most 24 hours/u);
  });

  it("accepts a sleep window of exactly 24 hours and rejects a zero-length one", () => {
    // The plausibility bound is inclusive: exactly 24 hours is the longest valid window,
    // and a window must be strictly positive — start == end fails closed.
    const exactDayRecord = {
      ...VALID_RECORD,
      data: {
        ...VALID_RECORD.data,
        sleepEndAt: "2026-06-10T22:04:00.000Z",
        sleepStartAt: "2026-06-09T22:04:00.000Z",
      },
    };

    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [exactDayRecord],
      }).records,
    ).toEqual([exactDayRecord]);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          data: {
            ...VALID_RECORD.data,
            sleepEndAt: VALID_RECORD.data.sleepStartAt,
          },
        }],
      }),
    ).toThrow(/end after it starts/u);
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

  it("parses deliver responses to a bare status and rejects unknown statuses", () => {
    // The response is deliberately status-only: counts would leak fan-out cardinality and
    // duplicate history to the grantor runtime, and nothing consumes them.
    expect(
      parseHostedVaultShareDeliverResponse({ status: "delivered" }),
    ).toEqual({ status: "delivered" });
    expect(
      parseHostedVaultShareDeliverResponse({ status: "no-active-share" }),
    ).toEqual({ status: "no-active-share" });
    expect(() =>
      parseHostedVaultShareDeliverResponse({ status: "partial" }),
    ).toThrow(/delivered or no-active-share/u);
  });

  it("round-trips a vault-share delivery wake and pins the envelope occurredAt to the record", () => {
    // The envelope occurredAt becomes the plaintext occurred_at mailbox column, so the
    // builder derives it from the parsed record: a wire envelope timestamp that drifted
    // from the record normalizes back to the record's night-date midnight.
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
      occurredAt: VALID_RECORD.occurredAt,
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

  it("round-trips a vault-share revoke wake and pins occurredAt to revokedAt", () => {
    const parsed = parseHostedExecutionWake({
      eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
      kind: "vault-share.revoke",
      occurredAt: "2026-07-02T00:00:00.000Z",
      revoke: VALID_REVOKE,
      userId: "member_referee",
    });

    expect(parsed).toEqual({
      eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
      kind: "vault-share.revoke",
      occurredAt: "2026-07-01T00:00:00.000Z",
      revoke: VALID_REVOKE,
      userId: "member_referee",
    });
  });

  it("rejects a revoke wake whose payload schema is wrong", () => {
    expect(() =>
      parseHostedExecutionWake({
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: { ...VALID_REVOKE, schema: "murph.vault-share.revoke.v999" },
        userId: "member_referee",
      }),
    ).toThrow(/revoke payload schema/u);
  });
});
