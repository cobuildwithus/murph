import { describe, expect, it } from "vitest";

import { parseHostedExecutionWake } from "../src/parsers.ts";
import { HOSTED_MAILBOX_KINDS } from "../src/runtime-control.ts";
import {
  buildHostedVaultShareActivityDistanceProjectionScope,
  buildHostedVaultShareActivityMinutesProjectionScope,
  buildHostedVaultShareActivitySessionCountProjectionScope,
  buildHostedVaultShareDeliveryDedupeKey,
  buildHostedVaultShareProjectionScopeKey,
  buildHostedVaultShareRevokeDedupeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
  parseHostedVaultShareActiveProjectionKindsResponse,
  parseHostedVaultShareDeliverRequest,
  parseHostedVaultShareDeliverResponse,
  parseHostedVaultShareProjectionScopeKey,
} from "../src/vault-share.ts";

const SLEEP_SCOPE = { projectionKind: "sleep-times.v0" } as const;
const ACTIVITY_SCOPE = { projectionKind: "activity-days.v0" } as const;
const STEPS_SCOPE = { projectionKind: "steps-days.v0" } as const;
const WORKOUT_SCOPE = { projectionKind: "workout-days.v0" } as const;
const HEART_RATE_ZONE_SCOPE = { projectionKind: "heart-rate-zones-days.v0" } as const;
const PROFILE_SCOPE = { projectionKind: "profile-name.v0" } as const;
const RUNNING_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "running",
});
const RUNNING_DISTANCE_SCOPE = buildHostedVaultShareActivityDistanceProjectionScope({
  activityKind: "running",
});
const RUNNING_SESSION_COUNT_SCOPE = buildHostedVaultShareActivitySessionCountProjectionScope({
  activityKind: "running",
});
const SWIMMING_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "swimming",
});

const VALID_RECORD = {
  data: {
    date: "2026-06-09",
    sleepEndAt: "2026-06-10T06:31:00.000Z",
    sleepStartAt: "2026-06-09T22:04:00.000Z",
  },
  occurredAt: "2026-06-09T00:00:00.000Z",
  recordKey: "2026-06-09",
};

const VALID_ACTIVITY_RECORD = {
  data: {
    date: "2026-07-03",
    metricKey: "activity-minutes",
    unit: "minutes",
    value: 73,
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03",
};

const VALID_DAILY_METRIC_RECORD = {
  data: {
    date: "2026-07-03",
    metricKey: "steps",
    unit: "count",
    value: 12_345,
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03",
};

const VALID_WORKOUT_RECORD = {
  data: {
    date: "2026-07-03",
    workoutCount: 2,
    workoutMinutes: 85,
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03",
};

const VALID_RUNNING_MINUTES_RECORD = {
  data: {
    activityKind: "running",
    date: "2026-07-03",
    sessionCount: 2,
    sessionMinutes: 85,
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03",
};

const VALID_RUNNING_DISTANCE_RECORD = {
  data: {
    activityKind: "running",
    date: "2026-07-03",
    sessionCount: 2,
    sessionDistanceMeters: 8_400,
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03",
};

const VALID_RUNNING_SESSION_COUNT_RECORD = {
  data: {
    activityKind: "running",
    date: "2026-07-03",
    sessionCount: 2,
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03",
};

const VALID_HEART_RATE_ZONE_RECORD = {
  data: {
    date: "2026-07-03",
    zones: [
      {
        durationMinutes: 24,
        label: "Zone 2",
        zone: 2,
      },
    ],
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03",
};

const VALID_DELIVERY = {
  grantorMemberId: "member_grantor",
  projectionKind: "sleep-times.v0",
  projectionScope: SLEEP_SCOPE,
  record: VALID_RECORD,
  schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  shareId: "share_1",
};

const VALID_REVOKE = {
  grantorMemberId: "member_grantor",
  projectionKind: "sleep-times.v0",
  projectionScope: SLEEP_SCOPE,
  revokedAt: "2026-07-01T00:00:00.000Z",
  schema: HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
  shareId: "share_1",
};

describe("vault-share contracts", () => {
  it("registers vault-share kinds in the mailbox kind registry", () => {
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.delivery");
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.revoke");
  });

  it("exposes email and challenge health projections as selectable scopes", () => {
    expect(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS).toEqual([
      "group-email.v0",
      "sleep-times.v0",
      "activity-days.v0",
      "workout-days.v0",
      "heart-rate-zones-days.v0",
      "steps-days.v0",
      "max-heart-rate-days.v0",
      "distance-days.v0",
      "active-calories-days.v0",
      "elevation-gain-days.v0",
      "floors-climbed-days.v0",
      "day-strain-days.v0",
      "workout-strain-days.v0",
      "activity-score-days.v0",
      "vo2-max-days.v0",
      "resting-heart-rate-days.v0",
      "hrv-days.v0",
    ]);
    expect(
      HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((scope) =>
        buildHostedVaultShareProjectionScopeKey(scope)
      ),
    ).toEqual([
      ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
      ...HOSTED_VAULT_SHARE_ACTIVITY_SELECTOR_ACTIVITY_KINDS.map((activityKind) =>
        `activity-minutes-days.v1.activityKind.${activityKind}`
      ),
      ...HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS.map((activityKind) =>
        `activity-distance-days.v1.activityKind.${activityKind}`
      ),
      ...HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS.map((activityKind) =>
        `activity-session-count-days.v1.activityKind.${activityKind}`
      ),
    ]);
    expect(getHostedVaultShareDailyMetricProjectionSpec("group-email.v0")).toBeNull();
  });

  it("derives the delivery dedupe key from share id, record key, and revision", () => {
    expect(
      buildHostedVaultShareDeliveryDedupeKey({
        recordKey: "2026-06-09",
        recordRevision: "revision_1",
        shareId: "share_1",
      }),
    ).toBe("vault-share:share_1:2026-06-09:revision_1");
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
    expect(parsed.projectionScope).toEqual(SLEEP_SCOPE);
  });

  it("parses an optional opaque source revision", () => {
    const parsed = parseHostedVaultShareDeliverRequest({
      projectionKind: "sleep-times.v0",
      records: [{
        ...VALID_RECORD,
        sourceRevision: "abcdEFGH0123_-",
      }],
    });

    expect(parsed.records[0]?.sourceRevision).toBe("abcdEFGH0123_-");
  });

  it("rejects a non-opaque source revision", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          ...VALID_RECORD,
          sourceRevision: "record/id",
        }],
      })
    ).toThrow(/sourceRevision/u);
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

  it("deduplicates supported active projection-kind responses and rejects unknown values", () => {
    const runningScope = {
      projectionKind: "activity-minutes-days.v1",
      selector: { activityKind: "running" },
    } as const;
    expect(parseHostedVaultShareActiveProjectionKindsResponse({
      projectionKinds: [
        "profile-name.v0",
        "activity-days.v0",
        "activity-days.v0",
      ],
      projectionScopes: [
        "profile-name.v0",
        runningScope,
        runningScope,
      ],
    })).toEqual({
      projectionKinds: ["profile-name.v0", "activity-days.v0"],
      projectionScopes: [PROFILE_SCOPE, runningScope],
    });
    expect(() =>
      parseHostedVaultShareActiveProjectionKindsResponse({
        projectionKinds: [17],
      })
    ).toThrow(/non-empty string/u);
    expect(() =>
      parseHostedVaultShareActiveProjectionKindsResponse({
        projectionKinds: ["future-challenge-kind.v0"],
      })
    ).toThrow(/known vault-share projection kind/u);
    expect(() =>
      parseHostedVaultShareActiveProjectionKindsResponse({
        projectionScopes: [{ projectionKind: "future-challenge-kind.v0" }],
      })
    ).toThrow(/known vault-share projection kind/u);
  });

  it("parses exact projection scope keys for capability negotiation", () => {
    expect(parseHostedVaultShareProjectionScopeKey(
      buildHostedVaultShareProjectionScopeKey(RUNNING_DISTANCE_SCOPE),
      "supported scope",
    )).toEqual(RUNNING_DISTANCE_SCOPE);
    expect(parseHostedVaultShareProjectionScopeKey(
      buildHostedVaultShareProjectionScopeKey(PROFILE_SCOPE),
      "supported scope",
    )).toEqual(PROFILE_SCOPE);
    expect(() =>
      parseHostedVaultShareProjectionScopeKey(
        "activity-distance-days.v1.activityKind.future-sport",
        "supported scope",
      )
    ).toThrow(/known vault-share projection scope key/u);
  });

  it("rejects malformed activity selector projection scopes", () => {
    for (const projectionScope of [
      "activity-distance-days.v1",
      "activity-distance-days.v1.running",
      "activity-distance-days.v1.activityKind",
      "activity-distance-days.v1.activityKind.running.extra",
      { projectionKind: "activity-distance-days.v1" },
      {
        projectionKind: "activity-distance-days.v1",
        selector: { activityKind: "*" },
      },
      {
        projectionKind: "activity-distance-days.v1",
        selector: { activityKind: "running", provider: "strava" },
      },
      {
        projectionKind: "activity-session-count-days.v1",
        selector: { activityKind: "running+walking" },
      },
      {
        projectionKind: "activity-distance-days.v1",
        selector: { activityKind: "sleep" },
      },
      {
        projectionKind: "activity-session-count-days.v1",
        selector: { activityKind: "sleep" },
      },
      {
        projectionKind: "activity-session-count-days.v1",
        selector: { activityKind: "Running" },
      },
    ]) {
      expect(() =>
        parseHostedVaultShareActiveProjectionKindsResponse({
          projectionScopes: [projectionScope],
        })
      ).toThrow();
    }
  });

  it("round-trips a vault-share delivery wake and pins the envelope occurredAt to the record", () => {
    // The envelope occurredAt becomes the plaintext occurred_at mailbox column, so the
    // builder derives it from the parsed record: a wire envelope timestamp that drifted
    // from the record normalizes back to the record's night-date midnight.
    const parsed = parseHostedExecutionWake({
      delivery: VALID_DELIVERY,
      eventId: "vault-share:share_1:2026-06-09:revision_1",
      kind: "vault-share.delivery",
      occurredAt: "2026-06-10T07:00:00.000Z",
      userId: "member_referee",
    });

    expect(parsed).toEqual({
      delivery: VALID_DELIVERY,
      eventId: "vault-share:share_1:2026-06-09:revision_1",
      kind: "vault-share.delivery",
      occurredAt: VALID_RECORD.occurredAt,
      userId: "member_referee",
    });
  });

  it("rejects a delivery wake whose payload schema is wrong", () => {
    expect(() =>
      parseHostedExecutionWake({
        delivery: { ...VALID_DELIVERY, schema: "murph.vault-share.delivery.v999" },
        eventId: "vault-share:share_1:2026-06-09:revision_1",
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


describe("activity-days.v0 scalar delivery records", () => {
  it("parses activity minutes through the daily scalar metric parser", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "activity-days.v0",
      records: [VALID_ACTIVITY_RECORD],
    })).toEqual({
      projectionKind: "activity-days.v0",
      projectionScope: ACTIVITY_SCOPE,
      records: [VALID_ACTIVITY_RECORD],
    });
  });

  it("rejects an activity record whose recordKey drifts from the data date", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-days.v0",
        records: [{ ...VALID_ACTIVITY_RECORD, recordKey: "2026-07-04" }],
      })
    ).toThrow(/recordKey must equal the data date/u);
  });

  it("rejects an activity record whose occurredAt is not the activity-date UTC midnight", () => {
    for (const occurredAt of ["2026-07-03T14:30:00.000Z", "2026-07-03T00:00:00Z"]) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "activity-days.v0",
          records: [{ ...VALID_ACTIVITY_RECORD, occurredAt }],
        })
      ).toThrow(/date at UTC midnight/u);
    }
  });

  it("rejects malformed activity dates, wrong metric keys, and implausible active-minute totals", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-days.v0",
        records: [{
          ...VALID_ACTIVITY_RECORD,
          data: { ...VALID_ACTIVITY_RECORD.data, date: "July 3" },
          recordKey: "July3",
        }],
      })
    ).toThrow(/YYYY-MM-DD/u);

    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-days.v0",
        records: [{
          ...VALID_ACTIVITY_RECORD,
          data: { ...VALID_ACTIVITY_RECORD.data, metricKey: "steps" },
        }],
      })
    ).toThrow(/metricKey must be activity-minutes/u);

    for (const value of [-1, 1441, Number.NaN]) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "activity-days.v0",
          records: [{
            ...VALID_ACTIVITY_RECORD,
            data: { ...VALID_ACTIVITY_RECORD.data, value },
          }],
        })
      ).toThrow(/value must be between|finite number/u);
    }
  });
});

describe("daily metric vault-share delivery records", () => {
  it("parses a valid daily scalar metric record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "steps-days.v0",
      records: [VALID_DAILY_METRIC_RECORD],
    })).toEqual({
      projectionKind: "steps-days.v0",
      projectionScope: STEPS_SCOPE,
      records: [VALID_DAILY_METRIC_RECORD],
    });
  });

  it("rejects daily scalar records that do not match the projection kind", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "steps-days.v0",
        records: [{
          ...VALID_DAILY_METRIC_RECORD,
          data: { ...VALID_DAILY_METRIC_RECORD.data, metricKey: "distance-km" },
        }],
      })
    ).toThrow(/metricKey must be steps/u);
  });

  it("rejects implausible daily scalar values and metadata drift", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "steps-days.v0",
        records: [{
          ...VALID_DAILY_METRIC_RECORD,
          data: { ...VALID_DAILY_METRIC_RECORD.data, value: 1_000_001 },
        }],
      })
    ).toThrow(/value must be between/u);

    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "steps-days.v0",
        records: [{ ...VALID_DAILY_METRIC_RECORD, occurredAt: "2026-07-03T10:00:00.000Z" }],
      })
    ).toThrow(/date at UTC midnight/u);
  });
});

describe("workout-days.v0 delivery records", () => {
  it("parses a valid daily workout summary record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "workout-days.v0",
      records: [VALID_WORKOUT_RECORD],
    })).toEqual({
      projectionKind: "workout-days.v0",
      projectionScope: WORKOUT_SCOPE,
      records: [VALID_WORKOUT_RECORD],
    });
  });

  it("rejects malformed workout summaries", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "workout-days.v0",
        records: [{
          ...VALID_WORKOUT_RECORD,
          data: { ...VALID_WORKOUT_RECORD.data, workoutCount: 1.5 },
        }],
      })
    ).toThrow(/workoutCount/u);
  });
});

describe("activity-minutes-days.v1 selector delivery records", () => {
  it("parses a valid running minutes daily record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "activity-minutes-days.v1",
      projectionScope: RUNNING_SCOPE,
      records: [VALID_RUNNING_MINUTES_RECORD],
    })).toEqual({
      projectionKind: "activity-minutes-days.v1",
      projectionScope: RUNNING_SCOPE,
      records: [VALID_RUNNING_MINUTES_RECORD],
    });
  });

  it("requires an explicit selector", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-minutes-days.v1",
        records: [VALID_RUNNING_MINUTES_RECORD],
      })
    ).toThrow(/requires a vault-share projection selector/u);
  });

  it("rejects records whose activity kind does not match the projection", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-minutes-days.v1",
        projectionScope: RUNNING_SCOPE,
        records: [{
          ...VALID_RUNNING_MINUTES_RECORD,
          data: { ...VALID_RUNNING_MINUTES_RECORD.data, activityKind: "walking" },
        }],
      })
    ).toThrow(/activityKind must be running/u);
  });

  it("rejects malformed activity-specific minute summaries", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-minutes-days.v1",
        projectionScope: SWIMMING_SCOPE,
        records: [{
          ...VALID_RUNNING_MINUTES_RECORD,
          data: {
            ...VALID_RUNNING_MINUTES_RECORD.data,
            activityKind: "swimming",
            sessionMinutes: 1_441,
          },
        }],
      })
    ).toThrow(/sessionMinutes/u);
  });
});

describe("activity-distance-days.v1 selector delivery records", () => {
  it("parses a valid running distance daily record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "activity-distance-days.v1",
      projectionScope: RUNNING_DISTANCE_SCOPE,
      records: [VALID_RUNNING_DISTANCE_RECORD],
    })).toEqual({
      projectionKind: "activity-distance-days.v1",
      projectionScope: RUNNING_DISTANCE_SCOPE,
      records: [VALID_RUNNING_DISTANCE_RECORD],
    });
  });

  it("requires an explicit selector", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-distance-days.v1",
        records: [VALID_RUNNING_DISTANCE_RECORD],
      })
    ).toThrow(/requires a vault-share projection selector/u);
  });

  it("rejects records whose activity kind does not match the projection", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-distance-days.v1",
        projectionScope: RUNNING_DISTANCE_SCOPE,
        records: [{
          ...VALID_RUNNING_DISTANCE_RECORD,
          data: { ...VALID_RUNNING_DISTANCE_RECORD.data, activityKind: "walking" },
        }],
      })
    ).toThrow(/activityKind must be running/u);
  });

  it("rejects malformed or overbroad distance summaries", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-distance-days.v1",
        projectionScope: RUNNING_DISTANCE_SCOPE,
        records: [{
          ...VALID_RUNNING_DISTANCE_RECORD,
          data: { ...VALID_RUNNING_DISTANCE_RECORD.data, sessionDistanceMeters: 8_400.5 },
        }],
      })
    ).toThrow(/sessionDistanceMeters/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-distance-days.v1",
        projectionScope: RUNNING_DISTANCE_SCOPE,
        records: [{
          ...VALID_RUNNING_DISTANCE_RECORD,
          data: { ...VALID_RUNNING_DISTANCE_RECORD.data, route: [] },
        }],
      })
    ).toThrow(/route/u);
  });
});

describe("activity-session-count-days.v1 selector delivery records", () => {
  it("parses a valid running session-count daily record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "activity-session-count-days.v1",
      projectionScope: RUNNING_SESSION_COUNT_SCOPE,
      records: [VALID_RUNNING_SESSION_COUNT_RECORD],
    })).toEqual({
      projectionKind: "activity-session-count-days.v1",
      projectionScope: RUNNING_SESSION_COUNT_SCOPE,
      records: [VALID_RUNNING_SESSION_COUNT_RECORD],
    });
  });

  it("requires an explicit selector", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-session-count-days.v1",
        records: [VALID_RUNNING_SESSION_COUNT_RECORD],
      })
    ).toThrow(/requires a vault-share projection selector/u);
  });

  it("rejects records whose activity kind does not match the projection", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-session-count-days.v1",
        projectionScope: RUNNING_SESSION_COUNT_SCOPE,
        records: [{
          ...VALID_RUNNING_SESSION_COUNT_RECORD,
          data: { ...VALID_RUNNING_SESSION_COUNT_RECORD.data, activityKind: "walking" },
        }],
      })
    ).toThrow(/activityKind must be running/u);
  });

  it("rejects malformed or overbroad session-count summaries", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-session-count-days.v1",
        projectionScope: RUNNING_SESSION_COUNT_SCOPE,
        records: [{
          ...VALID_RUNNING_SESSION_COUNT_RECORD,
          data: { ...VALID_RUNNING_SESSION_COUNT_RECORD.data, sessionCount: 1.5 },
        }],
      })
    ).toThrow(/sessionCount/u);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-session-count-days.v1",
        projectionScope: RUNNING_SESSION_COUNT_SCOPE,
        records: [{
          ...VALID_RUNNING_SESSION_COUNT_RECORD,
          data: { ...VALID_RUNNING_SESSION_COUNT_RECORD.data, sessionMinutes: 40 },
        }],
      })
    ).toThrow(/sessionMinutes/u);
  });
});

describe("heart-rate-zones-days.v0 delivery records", () => {
  it("parses a valid daily heart-rate zone summary record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "heart-rate-zones-days.v0",
      records: [VALID_HEART_RATE_ZONE_RECORD],
    })).toEqual({
      projectionKind: "heart-rate-zones-days.v0",
      projectionScope: HEART_RATE_ZONE_SCOPE,
      records: [VALID_HEART_RATE_ZONE_RECORD],
    });
  });

  it("rejects malformed heart-rate zone summaries", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "heart-rate-zones-days.v0",
        records: [{
          ...VALID_HEART_RATE_ZONE_RECORD,
          data: { ...VALID_HEART_RATE_ZONE_RECORD.data, zones: [] },
        }],
      })
    ).toThrow(/zones/u);

    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "heart-rate-zones-days.v0",
        records: [{
          ...VALID_HEART_RATE_ZONE_RECORD,
          data: {
            ...VALID_HEART_RATE_ZONE_RECORD.data,
            zones: [{ durationMinutes: 20 }],
          },
        }],
      })
    ).toThrow(/identify the zone/u);
  });
});

describe("profile-name.v0 delivery records", () => {
  it("parses a valid profile-name record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "profile-name.v0",
      records: [
        {
          data: { displayName: "Theo" },
          occurredAt: "2026-07-01T00:00:00.000Z",
          recordKey: "profile-name",
        },
      ],
    })).toEqual({
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      records: [
        {
          data: { displayName: "Theo" },
          occurredAt: "2026-07-01T00:00:00.000Z",
          recordKey: "profile-name",
        },
      ],
    });
  });

  it("rejects profile-name records with a drifting record key", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "profile-name.v0",
        records: [
          {
            data: { displayName: "Theo" },
            occurredAt: "2026-07-01T00:00:00.000Z",
            recordKey: "profile-name-2",
          },
        ],
      })
    ).toThrow(/recordKey must be "profile-name"/u);
  });

  it("rejects blank, oversized, and control-character display names", () => {
    for (const displayName of ["", "  ", "a".repeat(121), "The\u0000o"]) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "profile-name.v0",
          records: [
            {
              data: { displayName },
              occurredAt: "2026-07-01T00:00:00.000Z",
              recordKey: "profile-name",
            },
          ],
        })
      ).toThrow(/displayName/u);
    }
  });
});
