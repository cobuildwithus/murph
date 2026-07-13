import { describe, expect, it } from "vitest";

import {
  createEmptySharedVaultShareProjectionStore,
  flattenSharedVaultShareProjectionStore,
  parseSharedVaultShareProjectionStore,
  type SharedVaultShareProjectionsFile,
} from "../src/vault-share.ts";

const DELIVERY_SCHEMA = "murph.vault-share.delivery.v1";
const STORE_SCHEMA = "murph.shared-vault-projections.v1";

function record(input: {
  data: Record<string, unknown>;
  occurredAt: string;
  recordKey: string;
}) {
  return {
    receivedEventId: `evt-${input.recordKey}`,
    record: {
      data: input.data,
      occurredAt: input.occurredAt,
      recordKey: input.recordKey,
    },
    schema: DELIVERY_SCHEMA,
    shareId: "share-1",
  };
}

function grantor(input: {
  grantorMemberId: string;
  projectionKind: string;
  records: ReturnType<typeof record>[];
}) {
  return {
    grantorMemberId: input.grantorMemberId,
    projectionKind: input.projectionKind,
    records: input.records,
    shareId: "share-1",
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}

function rawStore(): Record<string, unknown> {
  return {
    projections: {
      "profile-name.v0": {
        grantors: {
          // member-a has a name; member-b intentionally does not.
          "member-a": grantor({
            grantorMemberId: "member-a",
            projectionKind: "profile-name.v0",
            records: [
              record({
                data: { displayName: "Alex" },
                occurredAt: "2026-07-01T00:00:00.000Z",
                recordKey: "profile-name",
              }),
            ],
          }),
        },
      },
      "steps-days.v0": {
        grantors: {
          "member-a": grantor({
            grantorMemberId: "member-a",
            projectionKind: "steps-days.v0",
            records: [
              // Deliberately older-first so the parser must reorder newest-first.
              record({
                data: { date: "2026-07-04", metricKey: "steps", unit: "count", value: 5102 },
                occurredAt: "2026-07-04T00:00:00.000Z",
                recordKey: "2026-07-04",
              }),
              record({
                data: { date: "2026-07-05", metricKey: "steps", unit: "count", value: 8241 },
                occurredAt: "2026-07-05T00:00:00.000Z",
                recordKey: "2026-07-05",
              }),
            ],
          }),
          "member-b": grantor({
            grantorMemberId: "member-b",
            projectionKind: "steps-days.v0",
            records: [
              record({
                data: { date: "2026-07-05", metricKey: "steps", unit: "count", value: 12000 },
                occurredAt: "2026-07-05T00:00:00.000Z",
                recordKey: "2026-07-05",
              }),
            ],
          }),
        },
      },
    },
    schema: STORE_SCHEMA,
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}

function parseOrThrow(value: unknown): SharedVaultShareProjectionsFile {
  const store = parseSharedVaultShareProjectionStore(value);
  if (!store) {
    throw new Error("expected a valid store");
  }
  return store;
}

describe("parseSharedVaultShareProjectionStore", () => {
  it("round-trips a valid store and reorders records newest-first", () => {
    const store = parseOrThrow(rawStore());
    expect(
      store.projections["steps-days.v0"]?.grantors["member-a"]?.records.map(
        (entry) => entry.record.recordKey,
      ),
    ).toEqual(["2026-07-05", "2026-07-04"]);
  });

  it("rejects a mismatched schema tag", () => {
    expect(
      parseSharedVaultShareProjectionStore({ ...rawStore(), schema: "murph.shared-vault-projections.v0" }),
    ).toBeNull();
  });

  it("rejects a grantor keyed under a mismatched member id", () => {
    const store = rawStore();
    const projections = store.projections as Record<string, { grantors: Record<string, unknown> }>;
    projections["steps-days.v0"].grantors["member-z"] =
      projections["steps-days.v0"].grantors["member-a"];
    expect(parseSharedVaultShareProjectionStore(store)).toBeNull();
  });

  it("rejects a record whose data fails the delivery parser", () => {
    const store = rawStore();
    const projections = store.projections as Record<
      string,
      { grantors: Record<string, { records: { record: { data: Record<string, unknown> } }[] }> }
    >;
    projections["steps-days.v0"].grantors["member-b"].records[0].record.data = {
      date: "2026-07-05",
      metricKey: "steps",
      unit: "count",
      value: -5,
    };
    expect(parseSharedVaultShareProjectionStore(store)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseSharedVaultShareProjectionStore("nope")).toBeNull();
    expect(parseSharedVaultShareProjectionStore(null)).toBeNull();
    expect(parseSharedVaultShareProjectionStore([])).toBeNull();
  });

  it("treats an empty store as an empty projection map", () => {
    const empty = createEmptySharedVaultShareProjectionStore();
    const parsed = parseOrThrow(JSON.parse(JSON.stringify(empty)));
    expect(parsed.projections).toEqual({});
  });
});

describe("flattenSharedVaultShareProjectionStore", () => {
  it("pivots to a member-major, name-joined view", () => {
    const view = flattenSharedVaultShareProjectionStore(parseOrThrow(rawStore()));

    // member-a is named "Alex" so it sorts before the unnamed member-b.
    expect(view.map((member) => member.memberId)).toEqual(["member-a", "member-b"]);

    const alex = view[0];
    expect(alex?.displayName).toBe("Alex");
    // profile-name is consumed as the name join, never surfaced as a data share.
    expect(alex?.shares.map((share) => share.projectionKind)).toEqual(["steps-days.v0"]);
    expect(alex?.shares[0]?.records.map((entry) => entry.recordKey)).toEqual([
      "2026-07-05",
      "2026-07-04",
    ]);

    const memberB = view[1];
    expect(memberB?.displayName).toBeNull();
    expect(memberB?.shares[0]?.records[0]?.data).toMatchObject({ value: 12000 });
  });

  it("includes a member who shared only their name with empty shares", () => {
    const store = rawStore();
    delete (store.projections as Record<string, unknown>)["steps-days.v0"];
    const view = flattenSharedVaultShareProjectionStore(parseOrThrow(store));
    expect(view).toEqual([{ displayName: "Alex", memberId: "member-a", shares: [] }]);
  });

  it("returns an empty view for an empty store", () => {
    expect(
      flattenSharedVaultShareProjectionStore(createEmptySharedVaultShareProjectionStore()),
    ).toEqual([]);
  });
});
