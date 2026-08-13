import { describe, expect, it } from "vitest";

import { parseHostedExecutionWake } from "../src/parsers.ts";
import { HOSTED_MAILBOX_KINDS } from "../src/runtime-control.ts";
import {
  buildHostedVaultShareActivityDistanceProjectionScope,
  buildHostedVaultShareActivityMinutesProjectionScope,
  buildHostedVaultShareActivitySessionCountProjectionScope,
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
  HOSTED_VAULT_SHARE_CURRENT_STATE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_DATA_SOURCE_MAX_SOURCES,
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
  HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH,
  HOSTED_VAULT_SHARE_HEART_RATE_ZONES_MAX_PER_DAY,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH,
  HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
  HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY,
  HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
  parseHostedVaultShareActiveProjectionKindsResponse,
  parseHostedVaultShareDeliveryRecord,
  parseHostedVaultShareDeliverRequest as parseHostedVaultShareDeliverRequestContract,
  parseHostedVaultShareDeliverResponse,
  parseHostedVaultShareEffectDeadlineAtEpochMs,
  parseHostedVaultShareProjectionScopeKey,
} from "../src/vault-share.ts";

const TEST_SOURCE_WORKSPACE_VERSION = "7";

function parseHostedVaultShareDeliverRequest(value: Record<string, unknown>) {
  const {
    expectedGenerationToken: _generationToken,
    sourceWorkspaceVersion: _sourceWorkspaceVersion,
    ...request
  } = parseHostedVaultShareDeliverRequestContract({
    expectedGenerationToken: GENERATION_TOKEN,
    sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    ...value,
  });
  return request;
}

const SLEEP_SCOPE = { projectionKind: "sleep-times.v0" } as const;
const ACTIVITY_SCOPE = { projectionKind: "activity-days.v0" } as const;
const STEPS_SCOPE = { projectionKind: "steps-days.v0" } as const;
const DEEP_SLEEP_SCOPE = { projectionKind: "deep-sleep-days.v0" } as const;
const DEEP_SLEEP_SOURCES_SCOPE = {
  projectionKind: "deep-sleep-sources-days.v1",
} as const;
const REM_SLEEP_SCOPE = { projectionKind: "rem-sleep-days.v0" } as const;
const REM_SLEEP_SOURCES_SCOPE = {
  projectionKind: "rem-sleep-sources-days.v1",
} as const;
const WORKOUT_SCOPE = { projectionKind: "workout-days.v0" } as const;
const WORKOUTS_SCOPE = {
  projectionKind: "workouts.v0",
} as const;
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
const GENERATION_TOKEN = "a".repeat(43);

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

const VALID_SOURCE_TAGGED_DEEP_SLEEP_RECORD = {
  data: {
    date: "2026-07-03",
    metricKey: "deep-sleep-minutes",
    recordedAt: "2026-07-03T07:01:00.000Z",
    unit: "minutes",
    value: 88,
  },
  occurredAt: "2026-07-03T00:00:00.000Z",
  recordKey: "2026-07-03.garmin",
  source: { label: "Garmin", source: "garmin" },
};

const VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD = {
  data: {
    date: "2026-07-03",
    metricKey: "deep-sleep-minutes",
    projectedAt: "2026-07-03T12:00:00.000Z",
    sources: [
      {
        label: "fitbit",
        recordedAt: "2026-07-03T06:58:00.000Z",
        source: "fitbit",
        unit: "minutes",
        value: 64,
      },
      {
        label: "Garmin",
        recordedAt: "2026-07-03T07:01:00.000Z",
        selected: true as const,
        source: "garmin",
        unit: "minutes",
        value: 88,
      },
      {
        label: "Oura",
        recordedAt: null,
        source: "oura",
        unit: "minutes",
        value: 112,
      },
    ],
    sourcesDisagree: true,
    unit: "minutes",
    value: 88,
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

const VALID_WORKOUTS_RECORD = {
  data: {
    calendarClosedThroughDate: "2026-07-03",
    date: "2026-07-03",
    timeSemantics:
      HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
    workouts: [
      {
        kind: "running",
        minutes: 45,
        startLocalMs: 18 * 60 * 60 * 1_000,
      },
      {
        kind: "strength-training",
        minutes: 30,
        startLocalMs: 19 * 60 * 60 * 1_000,
      },
    ],
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
  it("parses only an exact millisecond effect deadline header", () => {
    expect(parseHostedVaultShareEffectDeadlineAtEpochMs("1786543200000")).toBe(
      1_786_543_200_000,
    );
    expect(() => parseHostedVaultShareEffectDeadlineAtEpochMs(null)).toThrow(
      "effect deadline header is invalid",
    );
    expect(() => parseHostedVaultShareEffectDeadlineAtEpochMs("178654320000")).toThrow(
      "effect deadline header is invalid",
    );
  });

  it("requires one canonical source workspace version per replacement", () => {
    expect(parseHostedVaultShareDeliverRequestContract({
      expectedGenerationToken: GENERATION_TOKEN,
      projectionKind: "sleep-times.v0",
      records: [VALID_RECORD],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    })).toMatchObject({
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    });

    for (const sourceWorkspaceVersion of [
      undefined,
      "-1",
      "07",
      "9223372036854775808",
    ]) {
      expect(() => parseHostedVaultShareDeliverRequestContract({
        expectedGenerationToken: GENERATION_TOKEN,
        projectionKind: "sleep-times.v0",
        records: [VALID_RECORD],
        sourceWorkspaceVersion,
      })).toThrow(/sourceWorkspaceVersion/u);
    }
  });

  it("registers vault-share kinds in the mailbox kind registry", () => {
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.delivery");
    expect(HOSTED_MAILBOX_KINDS).toContain("vault-share.revoke");
  });

  it("exposes email and challenge health projections as selectable scopes", () => {
    expect(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS).toEqual([
      "group-email.v0",
      "time-zone.v0",
      "sleep-times.v0",
      "sleep-duration-days.v0",
      "deep-sleep-days.v0",
      "deep-sleep-sources-days.v1",
      "rem-sleep-days.v0",
      "rem-sleep-sources-days.v1",
      "activity-days.v0",
      "workout-days.v0",
      "workouts.v0",
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
      "protein-days.v0",
      "calories-days.v0",
      "carbs-days.v0",
      "fat-days.v0",
      "fiber-days.v0",
      "device-sync-status.v0",
    ]);
    expect(HOSTED_VAULT_SHARE_CURRENT_STATE_PROJECTION_KINDS).not.toContain(
      "device-sync-status.v0",
    );
    expect(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.at(-1)).toEqual({
      projectionKind: "device-sync-status.v0",
    });
    expect(getHostedVaultShareDailyMetricProjectionSpec("sleep-duration-days.v0")).toEqual({
      maxValue: 1_440,
      metricKey: "total-sleep-minutes",
      minValue: 0,
      projectionKind: "sleep-duration-days.v0",
      source: { kind: "metric-series" },
    });
    expect(getHostedVaultShareDailyMetricProjectionSpec("protein-days.v0")).toEqual({
      expectedUnit: "g",
      maxValue: 2_000,
      metricKey: "protein-grams",
      minValue: 0,
      projectionKind: "protein-days.v0",
      source: { kind: "meal-nutrition-total", totalKey: "proteinGrams" },
    });
    expect(getHostedVaultShareDailyMetricProjectionSpec("calories-days.v0")).toEqual({
      expectedUnit: "kcal",
      maxValue: 20_000,
      metricKey: "dietary-calories",
      minValue: 0,
      projectionKind: "calories-days.v0",
      source: { kind: "meal-nutrition-total", totalKey: "calories" },
    });
    expect(getHostedVaultShareDailyMetricProjectionSpec("carbs-days.v0")).toEqual({
      expectedUnit: "g",
      maxValue: 2_000,
      metricKey: "carbs-grams",
      minValue: 0,
      projectionKind: "carbs-days.v0",
      source: { kind: "meal-nutrition-total", totalKey: "carbsGrams" },
    });
    expect(getHostedVaultShareDailyMetricProjectionSpec("fat-days.v0")).toEqual({
      expectedUnit: "g",
      maxValue: 2_000,
      metricKey: "fat-grams",
      minValue: 0,
      projectionKind: "fat-days.v0",
      source: { kind: "meal-nutrition-total", totalKey: "fatGrams" },
    });
    expect(getHostedVaultShareDailyMetricProjectionSpec("fiber-days.v0")).toEqual({
      expectedUnit: "g",
      maxValue: 500,
      metricKey: "fiber-grams",
      minValue: 0,
      projectionKind: "fiber-days.v0",
      source: { kind: "meal-nutrition-total", totalKey: "fiberGrams" },
    });
    expect(
      HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((scope) =>
        buildHostedVaultShareProjectionScopeKey(scope)
      ),
    ).toEqual([
      ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS.filter(
        (projectionKind) => projectionKind !== "device-sync-status.v0",
      ),
      ...HOSTED_VAULT_SHARE_ACTIVITY_SELECTOR_ACTIVITY_KINDS.map((activityKind) =>
        `activity-minutes-days.v1.activityKind.${activityKind}`
      ),
      ...HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS.map((activityKind) =>
        `activity-distance-days.v1.activityKind.${activityKind}`
      ),
      ...HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS.map((activityKind) =>
        `activity-session-count-days.v1.activityKind.${activityKind}`
      ),
      "device-sync-status.v0",
    ]);
    expect(getHostedVaultShareDailyMetricProjectionSpec("group-email.v0")).toBeNull();
  });

  it("keeps daily metric projection kinds and specs one-to-one", () => {
    expect(
      HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS.map(
        (spec) => spec.projectionKind,
      ),
    ).toEqual(HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS);
    expect(new Set(HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS).size).toBe(
      HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS.length,
    );
    for (const spec of HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS) {
      expect(
        getHostedVaultShareDailyMetricProjectionSpec(spec.projectionKind),
      ).toEqual(spec);
    }

    expect(getHostedVaultShareDailyMetricProjectionSpec(
      DEEP_SLEEP_SOURCES_SCOPE.projectionKind,
    )).toMatchObject({
      metricKey: "deep-sleep-minutes",
      sourceMode: "all-public-sleep-sources",
    });
    expect(getHostedVaultShareDailyMetricProjectionSpec(
      REM_SLEEP_SOURCES_SCOPE.projectionKind,
    )).toMatchObject({
      metricKey: "rem-sleep-minutes",
      sourceMode: "all-public-sleep-sources",
    });
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

  it("parses only fixed-width opaque share-generation tokens", () => {
    const expectedGenerationToken = "a".repeat(43);
    expect(parseHostedVaultShareDeliverRequestContract({
      expectedGenerationToken,
      projectionKind: "sleep-times.v0",
      records: [VALID_RECORD],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    }).expectedGenerationToken).toBe(expectedGenerationToken);

    for (const invalidToken of ["short", "a".repeat(44), `${"a".repeat(42)}/`]) {
      expect(() => parseHostedVaultShareDeliverRequest({
        expectedGenerationToken: invalidToken,
        projectionKind: "sleep-times.v0",
        records: [VALID_RECORD],
      })).toThrow(/SHA-256 base64url digest/u);
    }
    expect(() => parseHostedVaultShareDeliverRequest({
      expectedGenerationToken: "",
      projectionKind: "sleep-times.v0",
      records: [VALID_RECORD],
    })).toThrow(/non-empty string/u);
  });

  it("rejects a deliver request without generation proof", () => {
    expect(() => parseHostedVaultShareDeliverRequestContract({
      projectionKind: "sleep-times.v0",
      records: [VALID_RECORD],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    })).toThrow(/expectedGenerationToken/u);
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

  it("accepts an empty records array as a complete missing-data replacement", () => {
    expect(
      parseHostedVaultShareDeliverRequest({ projectionKind: "sleep-times.v0", records: [] }),
    ).toEqual({
      projectionKind: "sleep-times.v0",
      projectionScope: { projectionKind: "sleep-times.v0" },
      records: [],
    });
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

  it("parses only the exact first-materialization delivery mode", () => {
    expect(parseHostedVaultShareDeliverRequestContract({
      expectedGenerationToken: "a".repeat(43),
      projectionKind: "sleep-times.v0",
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      records: [VALID_RECORD],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    })).toEqual(expect.objectContaining({
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    }));
    expect(() => parseHostedVaultShareDeliverRequestContract({
      expectedGenerationToken: "a".repeat(43),
      projectionKind: "sleep-times.v0",
      projectionMode: "refresh-all",
      records: [VALID_RECORD],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    })).toThrow(/first-materialization/u);
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
      hasDeferredProjectionWork: false,
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

  it("parses only opaque tokens for active projection scopes", () => {
    const scopeKey = buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE);
    const generationToken = "b".repeat(43);
    expect(parseHostedVaultShareActiveProjectionKindsResponse({
      generationTokensByProjectionScopeKey: { [scopeKey]: generationToken },
      projectionKinds: ["sleep-times.v0"],
      projectionScopes: [SLEEP_SCOPE],
    })).toEqual({
      generationTokensByProjectionScopeKey: { [scopeKey]: generationToken },
      hasDeferredProjectionWork: false,
      projectionKinds: ["sleep-times.v0"],
      projectionScopes: [SLEEP_SCOPE],
    });

    expect(() => parseHostedVaultShareActiveProjectionKindsResponse({
      generationTokensByProjectionScopeKey: {
        [buildHostedVaultShareProjectionScopeKey(PROFILE_SCOPE)]: generationToken,
      },
      projectionKinds: ["sleep-times.v0"],
      projectionScopes: [SLEEP_SCOPE],
    })).toThrow(/inactive scope key/u);
    expect(() => parseHostedVaultShareActiveProjectionKindsResponse({
      generationTokensByProjectionScopeKey: { [scopeKey]: "not-a-digest" },
      projectionKinds: ["sleep-times.v0"],
      projectionScopes: [SLEEP_SCOPE],
    })).toThrow(/SHA-256 base64url digest/u);
  });

  it("parses the fixed-width deferred-work signal and rejects non-booleans", () => {
    expect(parseHostedVaultShareActiveProjectionKindsResponse({
      hasDeferredProjectionWork: true,
      projectionKinds: [],
      projectionScopes: [],
    })).toEqual({
      hasDeferredProjectionWork: true,
      projectionKinds: [],
      projectionScopes: [],
    });
    expect(() => parseHostedVaultShareActiveProjectionKindsResponse({
      hasDeferredProjectionWork: "yes",
      projectionKinds: [],
      projectionScopes: [],
    })).toThrow(/boolean/u);
  });

  it("requires exact first-materialization acknowledgment", () => {
    expect(parseHostedVaultShareActiveProjectionKindsResponse({
      hasDeferredProjectionWork: false,
      projectionKinds: [],
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      projectionScopes: [],
    })).toEqual({
      hasDeferredProjectionWork: false,
      projectionKinds: [],
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      projectionScopes: [],
    });
    expect(() => parseHostedVaultShareActiveProjectionKindsResponse({
      projectionKinds: [],
      projectionMode: "first-materialization-v2",
      projectionScopes: [],
    })).toThrow(/first-materialization/u);
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
  it("preserves the optional broad-movement semantic marker while accepting legacy records", () => {
    const markedRecord = {
      ...VALID_ACTIVITY_RECORD,
      data: {
        ...VALID_ACTIVITY_RECORD.data,
        metricSemantics: "broad-movement",
      },
    } as const;

    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "activity-days.v0",
      records: [markedRecord],
    }).records).toEqual([markedRecord]);
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "activity-days.v0",
      records: [VALID_ACTIVITY_RECORD],
    }).records).toEqual([VALID_ACTIVITY_RECORD]);
  });

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

    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-days.v0",
        records: [{
          ...VALID_ACTIVITY_RECORD,
          data: {
            ...VALID_ACTIVITY_RECORD.data,
            metricSemantics: "workout-duration",
          },
        }],
      })
    ).toThrow(/metricSemantics is invalid/u);
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

  it("keeps every bounded public source and rejects a ninth source", () => {
    const records = Array.from(
      { length: HOSTED_VAULT_SHARE_DATA_SOURCE_MAX_SOURCES },
      (_, index) => {
        const source = `source-${index}`;
        return {
          ...VALID_DAILY_METRIC_RECORD,
          recordKey: `2026-07-03.${source}`,
          source: { label: source, source },
        };
      },
    );

    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "steps-days.v0",
      records,
    }).records).toEqual(records);

    const ninthSource = "source-8";
    expect(() => parseHostedVaultShareDeliverRequest({
      projectionKind: "steps-days.v0",
      records: [
        ...records,
        {
          ...VALID_DAILY_METRIC_RECORD,
          recordKey: `2026-07-03.${ninthSource}`,
          source: { label: ninthSource, source: ninthSource },
        },
      ],
    })).toThrow(/at most 8 public sources/u);
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

  it("parses bounded deep and REM sleep minute records", () => {
    for (const [projectionScope, metricKey] of [
      [DEEP_SLEEP_SCOPE, "deep-sleep-minutes"],
      [REM_SLEEP_SCOPE, "rem-sleep-minutes"],
    ] as const) {
      for (const value of [0, 1_440]) {
        const record = {
          ...VALID_DAILY_METRIC_RECORD,
          data: {
            ...VALID_DAILY_METRIC_RECORD.data,
            metricKey,
            unit: "minutes",
            value,
          },
        };
        expect(parseHostedVaultShareDeliverRequest({
          projectionKind: projectionScope.projectionKind,
          records: [record],
        })).toEqual({
          projectionKind: projectionScope.projectionKind,
          projectionScope,
          records: [record],
        });
      }

      for (const value of [-1, 1_441]) {
        expect(() =>
          parseHostedVaultShareDeliverRequest({
            projectionKind: projectionScope.projectionKind,
            records: [{
              ...VALID_DAILY_METRIC_RECORD,
              data: {
                ...VALID_DAILY_METRIC_RECORD.data,
                metricKey,
                unit: "minutes",
                value,
              },
            }],
          })
        ).toThrow(/value must be between/u);
      }
    }
  });

  it("preserves each source-tagged sleep stage's recorded time", () => {
    for (const [projectionScope, metricKey] of [
      [DEEP_SLEEP_SCOPE, "deep-sleep-minutes"],
      [DEEP_SLEEP_SOURCES_SCOPE, "deep-sleep-minutes"],
      [REM_SLEEP_SCOPE, "rem-sleep-minutes"],
      [REM_SLEEP_SOURCES_SCOPE, "rem-sleep-minutes"],
    ] as const) {
      const record = {
        ...VALID_SOURCE_TAGGED_DEEP_SLEEP_RECORD,
        data: {
          ...VALID_SOURCE_TAGGED_DEEP_SLEEP_RECORD.data,
          metricKey,
        },
      };
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: projectionScope.projectionKind,
        records: [record],
      }).records).toEqual([record]);

      const recordWithoutProviderTime = {
        ...record,
        data: { ...record.data, recordedAt: null },
      };
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: projectionScope.projectionKind,
        records: [recordWithoutProviderTime],
      }).records).toEqual([recordWithoutProviderTime]);
    }
  });

  it("rejects missing, malformed, or misplaced source-recorded times", () => {
    const { recordedAt: _recordedAt, ...missingRecordedAtData } =
      VALID_SOURCE_TAGGED_DEEP_SLEEP_RECORD.data;
    for (const data of [
      missingRecordedAtData,
      { ...VALID_SOURCE_TAGGED_DEEP_SLEEP_RECORD.data, recordedAt: "not-a-time" },
      {
        ...VALID_SOURCE_TAGGED_DEEP_SLEEP_RECORD.data,
        recordedAt: "2999-01-01T00:00:00.000Z",
      },
    ]) {
      expect(() => parseHostedVaultShareDeliverRequest({
        projectionKind: DEEP_SLEEP_SCOPE.projectionKind,
        records: [{ ...VALID_SOURCE_TAGGED_DEEP_SLEEP_RECORD, data }],
      })).toThrow(/recordedAt|must not be in the future/u);
    }

    expect(() => parseHostedVaultShareDeliverRequest({
      projectionKind: "steps-days.v0",
      records: [{
        ...VALID_DAILY_METRIC_RECORD,
        data: { ...VALID_DAILY_METRIC_RECORD.data, recordedAt: null },
        recordKey: "2026-07-03.garmin",
        source: { label: "Garmin", source: "garmin" },
      }],
    })).toThrow(/does not accept recordedAt/u);
  });

  it("parses every bounded public sleep source with one canonical selection", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: DEEP_SLEEP_SOURCES_SCOPE.projectionKind,
      records: [VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD],
    })).toEqual({
      projectionKind: DEEP_SLEEP_SOURCES_SCOPE.projectionKind,
      projectionScope: DEEP_SLEEP_SOURCES_SCOPE,
      records: [VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD],
    });

    const remRecord = {
      ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD,
      data: {
        ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD.data,
        metricKey: "rem-sleep-minutes",
      },
    };
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: REM_SLEEP_SOURCES_SCOPE.projectionKind,
      records: [remRecord],
    }).records).toEqual([remRecord]);

    for (const [projectionScope, metricKey] of [
      [DEEP_SLEEP_SOURCES_SCOPE, "deep-sleep-minutes"],
      [REM_SLEEP_SOURCES_SCOPE, "rem-sleep-minutes"],
    ] as const) {
      const manualRecord = {
        ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD,
        data: {
          ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD.data,
          metricKey,
          sources: [{
            label: "Manual",
            recordedAt: "2026-07-03T12:00:00.000Z",
            selected: true as const,
            source: "manual",
            unit: "minutes",
            value: 91,
          }],
          sourcesDisagree: false,
          value: 91,
        },
      };
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: projectionScope.projectionKind,
        records: [manualRecord],
      }).records).toEqual([manualRecord]);

      const manualWithFourWearablesRecord = {
        ...manualRecord,
        data: {
          ...manualRecord.data,
          sources: [
            ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD.data.sources.map(
              ({ selected: _selected, ...source }) => source,
            ),
            {
              label: "polar",
              recordedAt: "2026-07-03T07:08:00.000Z",
              source: "polar",
              unit: "minutes",
              value: 75,
            },
            {
              label: "Manual",
              recordedAt: "2026-07-03T12:00:00.000Z",
              selected: true as const,
              source: "manual",
              unit: "minutes",
              value: 91,
            },
          ],
          sourcesDisagree: true,
        },
      };
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: projectionScope.projectionKind,
        records: [manualWithFourWearablesRecord],
      }).records).toEqual([manualWithFourWearablesRecord]);
    }
  });

  it("keeps legacy sleep grants provider-neutral", () => {
    expect(() => parseHostedVaultShareDeliverRequest({
      projectionKind: DEEP_SLEEP_SCOPE.projectionKind,
      records: [VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD],
    })).toThrow(/does not accept source-aware sleep data/u);
  });

  it("rejects malformed, ambiguous, or internally inconsistent source-aware sleep data", () => {
    const expectInvalidSources = (
      data: Record<string, unknown>,
      pattern: RegExp,
    ) => {
      expect(() => parseHostedVaultShareDeliverRequest({
        projectionKind: DEEP_SLEEP_SOURCES_SCOPE.projectionKind,
        records: [{
          ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD,
          data,
        }],
      })).toThrow(pattern);
    };
    const validData = VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD.data;

    expectInvalidSources({ ...validData, projectedAt: "not-a-time" }, /projectedAt/u);
    expectInvalidSources({ ...validData, privateAccountId: "must-not-land" }, /must not include/u);
    expectInvalidSources({
      ...validData,
      projectedAt: "2999-01-01T00:00:00.000Z",
    }, /must not be in the future/u);
    expectInvalidSources({ ...validData, sources: [] }, /1-5 entries/u);
    expectInvalidSources({
      ...validData,
      sources: Array.from({ length: 5 }, (_, index) => ({
        label: `source-${index}`,
        recordedAt: null,
        ...(index === 0 ? { selected: true } : {}),
        source: `source-${index}`,
        unit: "minutes",
        value: 88,
      })),
      sourcesDisagree: false,
    }, /at most 4 wearable entries/u);
    expectInvalidSources({
      ...validData,
      sources: Array.from({ length: 6 }, (_, index) => ({
        label: index === 5 ? "Manual" : `source-${index}`,
        recordedAt: null,
        ...(index === 5 ? { selected: true } : {}),
        source: index === 5 ? "manual" : `source-${index}`,
        unit: "minutes",
        value: 88,
      })),
      sourcesDisagree: false,
    }, /1-5 entries/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source) => ({ ...source, selected: undefined })),
    }, /exactly one selected/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => ({
        ...source,
        ...(index === 0 ? { selected: true } : {}),
      })),
    }, /exactly one selected/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 1
        ? { ...source, value: 94 }
        : source),
    }, /selected source must match/u);
    expectInvalidSources({ ...validData, sourcesDisagree: false }, /must match the source values/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, label: "Garmin", source: "garmin" }
        : source),
    }, /source keys must be unique/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, source: "Private Provider" }
        : source),
    }, /canonical public provider slugs/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, label: "Bad\nLabel" }
        : source),
    }, /bounded text without control characters/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, label: "  " }
        : source),
    }, /bounded text without control characters/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, label: "Bedroom Fitbit" }
        : source),
    }, /canonical public provider keys and labels/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, label: "manual", source: "manual" }
        : source),
    }, /canonical public provider keys and labels/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, label: "Junction", source: "junction" }
        : source),
    }, /canonical public provider slugs/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, recordedAt: "not-a-time" }
        : source),
    }, /recordedAt/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, recordedAt: "2999-01-01T00:00:00.000Z" }
        : source),
    }, /must not be in the future/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, unit: "hours" }
        : source),
    }, /unit must be minutes/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, value: 1_441 }
        : source),
    }, /value must be between/u);
    expectInvalidSources({
      ...validData,
      sources: validData.sources.map((source, index) => index === 0
        ? { ...source, selected: false }
        : source),
    }, /selected must be true when present/u);
  });

  it("preserves provisional state only for completed-date daily scopes", () => {
    for (const [projectionScope, metricKey] of [
      [DEEP_SLEEP_SCOPE, "deep-sleep-minutes"],
      [DEEP_SLEEP_SOURCES_SCOPE, "deep-sleep-minutes"],
      [REM_SLEEP_SCOPE, "rem-sleep-minutes"],
      [REM_SLEEP_SOURCES_SCOPE, "rem-sleep-minutes"],
    ] as const) {
      const record = {
        ...(projectionScope === DEEP_SLEEP_SOURCES_SCOPE
          || projectionScope === REM_SLEEP_SOURCES_SCOPE
          ? {
              ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD,
              data: {
                ...VALID_SOURCE_AWARE_DEEP_SLEEP_RECORD.data,
                metricKey,
                provisional: true as const,
              },
            }
          : {
              ...VALID_DAILY_METRIC_RECORD,
              data: {
                ...VALID_DAILY_METRIC_RECORD.data,
                metricKey,
                provisional: true as const,
                unit: "minutes",
                value: 480,
              },
            }),
      };
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: projectionScope.projectionKind,
        records: [record],
      }).records).toEqual([record]);
    }

    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "steps-days.v0",
        records: [{
          ...VALID_DAILY_METRIC_RECORD,
          data: { ...VALID_DAILY_METRIC_RECORD.data, provisional: true },
        }],
      })
    ).toThrow(/provisional is invalid/u);
    for (const provisional of [false, "yes"] as const) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "deep-sleep-days.v0",
          records: [{
            ...VALID_DAILY_METRIC_RECORD,
            data: {
              ...VALID_DAILY_METRIC_RECORD.data,
              metricKey: "deep-sleep-minutes",
              provisional,
              unit: "minutes",
              value: 480,
            },
          }],
        })
      ).toThrow(/provisional is invalid/u);
    }
  });
});

describe("protein-days.v0 delivery records", () => {
  const VALID_PROTEIN_RECORD = {
    data: {
      date: "2026-07-03",
      metricKey: "protein-grams",
      unit: "g",
      value: 142.5,
    },
    occurredAt: "2026-07-03T00:00:00.000Z",
    recordKey: "2026-07-03",
  };

  it("parses a valid daily protein record", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "protein-days.v0",
      records: [VALID_PROTEIN_RECORD],
    })).toEqual({
      projectionKind: "protein-days.v0",
      projectionScope: { projectionKind: "protein-days.v0" },
      records: [VALID_PROTEIN_RECORD],
    });
  });

  it("accepts a complete true-zero day", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "protein-days.v0",
      records: [{
        ...VALID_PROTEIN_RECORD,
        data: { ...VALID_PROTEIN_RECORD.data, value: 0 },
      }],
    }).records[0]?.data).toMatchObject({ value: 0 });
  });

  it("rejects a wrong metric key", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "protein-days.v0",
        records: [{
          ...VALID_PROTEIN_RECORD,
          data: { ...VALID_PROTEIN_RECORD.data, metricKey: "steps" },
        }],
      })
    ).toThrow(/metricKey must be protein-grams/u);
  });

  it("requires the exact gram unit", () => {
    for (const unit of [null, "grams", "G", "kg"]) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "protein-days.v0",
          records: [{
            ...VALID_PROTEIN_RECORD,
            data: { ...VALID_PROTEIN_RECORD.data, unit },
          }],
        })
      ).toThrow(/unit must be g/u);
    }
  });

  it("rejects out-of-bound values", () => {
    for (const value of [-1, 2_001]) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "protein-days.v0",
          records: [{
            ...VALID_PROTEIN_RECORD,
            data: { ...VALID_PROTEIN_RECORD.data, value },
          }],
        })
      ).toThrow(/value must be between 0 and 2000/u);
    }
  });

  it("rejects record identity drift", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "protein-days.v0",
        records: [{ ...VALID_PROTEIN_RECORD, recordKey: "2026-07-04" }],
      })
    ).toThrow();

    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "protein-days.v0",
        records: [{ ...VALID_PROTEIN_RECORD, occurredAt: "2026-07-03T10:00:00.000Z" }],
      })
    ).toThrow(/date at UTC midnight/u);
  });
});

describe("nutrient meal-nutrition delivery records", () => {
  const NUTRIENTS = [
    { projectionKind: "calories-days.v0", metricKey: "dietary-calories", unit: "kcal", maxValue: 20_000, value: 2_150 },
    { projectionKind: "carbs-days.v0", metricKey: "carbs-grams", unit: "g", maxValue: 2_000, value: 240 },
    { projectionKind: "fat-days.v0", metricKey: "fat-grams", unit: "g", maxValue: 2_000, value: 71 },
    { projectionKind: "fiber-days.v0", metricKey: "fiber-grams", unit: "g", maxValue: 500, value: 34 },
  ] as const;

  for (const nutrient of NUTRIENTS) {
    const validRecord = {
      data: { date: "2026-07-03", metricKey: nutrient.metricKey, unit: nutrient.unit, value: nutrient.value },
      occurredAt: "2026-07-03T00:00:00.000Z",
      recordKey: "2026-07-03",
    };

    it(`parses a valid ${nutrient.projectionKind} record and keeps a complete zero day`, () => {
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: nutrient.projectionKind,
        records: [validRecord],
      })).toEqual({
        projectionKind: nutrient.projectionKind,
        projectionScope: { projectionKind: nutrient.projectionKind },
        records: [validRecord],
      });
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: nutrient.projectionKind,
        records: [{ ...validRecord, data: { ...validRecord.data, value: 0 } }],
      }).records[0]?.data).toMatchObject({ value: 0 });
    });

    it(`rejects a wrong metric key, unit, and out-of-bound value for ${nutrient.projectionKind}`, () => {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: nutrient.projectionKind,
          records: [{ ...validRecord, data: { ...validRecord.data, metricKey: "steps" } }],
        })
      ).toThrow(new RegExp(`metricKey must be ${nutrient.metricKey}`, "u"));

      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: nutrient.projectionKind,
          records: [{ ...validRecord, data: { ...validRecord.data, unit: "mg" } }],
        })
      ).toThrow(new RegExp(`unit must be ${nutrient.unit}`, "u"));

      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: nutrient.projectionKind,
          records: [{ ...validRecord, data: { ...validRecord.data, value: nutrient.maxValue + 1 } }],
        })
      ).toThrow(new RegExp(`value must be between 0 and ${nutrient.maxValue}`, "u"));
    });
  }
});

describe("workout-days.v0 delivery records", () => {
  it("preserves the canonical marker while accepting unmarked legacy records", () => {
    const canonicalRecord = {
      ...VALID_WORKOUT_RECORD,
      data: {
        ...VALID_WORKOUT_RECORD.data,
        metricSemantics:
          HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
      },
    };

    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "workout-days.v0",
      records: [canonicalRecord],
    }).records).toEqual([canonicalRecord]);
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "workout-days.v0",
      records: [VALID_WORKOUT_RECORD],
    }).records).toEqual([VALID_WORKOUT_RECORD]);
  });

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

    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "workout-days.v0",
        records: [{
          ...VALID_WORKOUT_RECORD,
          data: {
            ...VALID_WORKOUT_RECORD.data,
            metricSemantics: "selected-source-workout-day",
          },
        }],
      })
    ).toThrow(/metricSemantics is invalid/u);
  });
});

describe("workouts.v0 delivery records", () => {
  it("parses the strict day-keyed workout-array shape", () => {
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "workouts.v0",
      records: [VALID_WORKOUTS_RECORD],
    })).toEqual({
      projectionKind: "workouts.v0",
      projectionScope: WORKOUTS_SCOPE,
      records: [VALID_WORKOUTS_RECORD],
    });
  });

  it("requires a strict producer-owned calendar completion watermark", () => {
    for (const calendarClosedThroughDate of [
      undefined,
      "07/03/2026",
      "2026-7-3",
    ] as const) {
      expect(() =>
        parseHostedVaultShareDeliverRequest({
          projectionKind: "workouts.v0",
          records: [{
            ...VALID_WORKOUTS_RECORD,
            data: {
              ...VALID_WORKOUTS_RECORD.data,
              calendarClosedThroughDate,
            },
          }],
        })
      ).toThrow(/calendarClosedThroughDate/u);
    }
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "workouts.v0",
        records: [{
          ...VALID_WORKOUTS_RECORD,
          data: {
            ...VALID_WORKOUTS_RECORD.data,
            provisional: true,
          },
        }],
      })
    ).toThrow(/provisional is invalid/u);
  });

  it("rejects inconsistent completion watermarks in one projection", () => {
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "workouts.v0",
        records: [
          VALID_WORKOUTS_RECORD,
          {
            ...VALID_WORKOUTS_RECORD,
            data: {
              ...VALID_WORKOUTS_RECORD.data,
              calendarClosedThroughDate: "2026-07-02",
              date: "2026-07-02",
            },
            occurredAt: "2026-07-02T00:00:00.000Z",
            recordKey: "2026-07-02",
          },
        ],
      })
    ).toThrow(/one calendarClosedThroughDate/u);
  });

  it("accepts settled observed-zero days and local-clock boundaries", () => {
    const emptyRecord = {
      ...VALID_WORKOUTS_RECORD,
      data: {
        ...VALID_WORKOUTS_RECORD.data,
        workouts: [],
      },
    };
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "workouts.v0",
      records: [emptyRecord],
    }).records).toEqual([emptyRecord]);

    for (const startLocalMs of [0, 86_399_999]) {
      const parsed = parseHostedVaultShareDeliveryRecord(
        {
          ...VALID_WORKOUTS_RECORD,
          data: {
            ...VALID_WORKOUTS_RECORD.data,
            workouts: [{
              kind: "running",
              minutes: 1,
              startLocalMs,
            }],
          },
        },
        WORKOUTS_SCOPE,
      );
      expect(parsed.data).toMatchObject({
        workouts: [{ startLocalMs }],
      });
    }
  });

  it("rejects one workout beyond the exported per-day bound instead of truncating the day", () => {
    const workouts = Array.from(
      { length: HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY + 1 },
      (_, index) => ({
        kind: "running",
        minutes: 1,
        startLocalMs: index,
      }),
    );

    expect(() =>
      parseHostedVaultShareDeliveryRecord(
        {
          ...VALID_WORKOUTS_RECORD,
          data: { ...VALID_WORKOUTS_RECORD.data, workouts },
        },
        WORKOUTS_SCOPE,
      )
    ).toThrow(
      new RegExp(`at most ${HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY}`, "u"),
    );
  });

  it("rejects invalid per-workout local clocks, durations, and kinds", () => {
    for (const startLocalMs of [-1, 1.5, 86_400_000]) {
      expect(() =>
        parseHostedVaultShareDeliveryRecord(
          {
            ...VALID_WORKOUTS_RECORD,
            data: {
              ...VALID_WORKOUTS_RECORD.data,
              workouts: [{
                kind: "running",
                minutes: 30,
                startLocalMs,
              }],
            },
          },
          WORKOUTS_SCOPE,
        )
      ).toThrow(/startLocalMs/u);
    }

    for (const minutes of [0, -1, 1_441]) {
      expect(() =>
        parseHostedVaultShareDeliveryRecord(
          {
            ...VALID_WORKOUTS_RECORD,
            data: {
              ...VALID_WORKOUTS_RECORD.data,
              workouts: [{ kind: "running", minutes, startLocalMs: 0 }],
            },
          },
          WORKOUTS_SCOPE,
        )
      ).toThrow(/minutes/u);
    }

    for (const kind of [
      "",
      "Running",
      "x".repeat(HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH + 1),
    ]) {
      expect(() =>
        parseHostedVaultShareDeliveryRecord(
          {
            ...VALID_WORKOUTS_RECORD,
            data: {
              ...VALID_WORKOUTS_RECORD.data,
              workouts: [{ kind, minutes: 30, startLocalMs: 0 }],
            },
          },
          WORKOUTS_SCOPE,
        )
      ).toThrow(/kind/u);
    }
  });

  it("rejects date drift, semantic drift, and undeclared details", () => {
    expect(() =>
      parseHostedVaultShareDeliveryRecord(
        {
          ...VALID_WORKOUTS_RECORD,
          recordKey: "2026-07-02",
        },
        WORKOUTS_SCOPE,
      )
    ).toThrow(/recordKey/u);
    expect(() =>
      parseHostedVaultShareDeliveryRecord(
        {
          ...VALID_WORKOUTS_RECORD,
          occurredAt: "2026-07-03T18:00:00.000Z",
        },
        WORKOUTS_SCOPE,
      )
    ).toThrow(/workout date at UTC midnight/u);
    expect(() =>
      parseHostedVaultShareDeliveryRecord(
        {
          ...VALID_WORKOUTS_RECORD,
          data: {
            ...VALID_WORKOUTS_RECORD.data,
            timeSemantics: "utc.v0",
          },
        },
        WORKOUTS_SCOPE,
      )
    ).toThrow(/timeSemantics is invalid/u);
    expect(() =>
      parseHostedVaultShareDeliveryRecord(
        {
          ...VALID_WORKOUTS_RECORD,
          data: {
            ...VALID_WORKOUTS_RECORD.data,
            timeZone: "UTC",
          },
        },
        WORKOUTS_SCOPE,
      )
    ).toThrow(/timeZone/u);
    expect(() =>
      parseHostedVaultShareDeliveryRecord(
        {
          ...VALID_WORKOUTS_RECORD,
          data: {
            ...VALID_WORKOUTS_RECORD.data,
            workouts: [{
              kind: "running",
              minutes: 45,
              provider: "device",
              startLocalMs: 0,
            }],
          },
        },
        WORKOUTS_SCOPE,
      )
    ).toThrow(/provider/u);
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

  it("enforces the payload-safe zone count and label boundaries", () => {
    const zones = Array.from(
      { length: HOSTED_VAULT_SHARE_HEART_RATE_ZONES_MAX_PER_DAY },
      (_, zone) => ({
        durationMinutes: 24,
        label: "x".repeat(HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH),
        zone,
      }),
    );
    const request = {
      projectionKind: "heart-rate-zones-days.v0",
      records: [{
        ...VALID_HEART_RATE_ZONE_RECORD,
        data: { ...VALID_HEART_RATE_ZONE_RECORD.data, zones },
      }],
    };

    expect(() => parseHostedVaultShareDeliverRequest(request)).not.toThrow();
    expect(() => parseHostedVaultShareDeliverRequest({
      ...request,
      records: [{
        ...VALID_HEART_RATE_ZONE_RECORD,
        data: {
          ...VALID_HEART_RATE_ZONE_RECORD.data,
          zones: [...zones, { durationMinutes: 1, zone: 0 }],
        },
      }],
    })).toThrow(new RegExp(
      `1-${HOSTED_VAULT_SHARE_HEART_RATE_ZONES_MAX_PER_DAY}`,
      "u",
    ));
    expect(() => parseHostedVaultShareDeliverRequest({
      ...request,
      records: [{
        ...VALID_HEART_RATE_ZONE_RECORD,
        data: {
          ...VALID_HEART_RATE_ZONE_RECORD.data,
          zones: [{
            durationMinutes: 1,
            label: "x".repeat(
              HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH + 1,
            ),
            zone: 1,
          }],
        },
      }],
    })).toThrow(/label/u);
  });
});

describe("device-sync-status.v0 delivery records", () => {
  const projectionScope = { projectionKind: "device-sync-status.v0" } as const;
  const validRecord = {
    data: {
      observedAt: "2026-07-01T00:00:00.000Z",
      sources: [
        {
          connectionSyncJobCompletedAt: "2026-06-30T23:58:00.000Z",
          label: "Apple Health",
          status: "connected",
          statusObservedAt: "2026-06-30T23:59:00.000Z",
        },
        {
          connectionSyncJobCompletedAt: null,
          label: "WHOOP",
          status: "needs-reconnect",
          statusObservedAt: "2026-06-30T23:57:00.000Z",
        },
      ],
    },
    occurredAt: "2026-07-01T00:00:00.000Z",
    recordKey: "device-sync-status",
  } as const;

  it("keeps live read records valid but rejects device status at the delivery boundary", () => {
    expect(parseHostedVaultShareDeliveryRecord(validRecord, projectionScope)).toEqual(validRecord);
    expect(() => parseHostedVaultShareDeliverRequest({
      projectionKind: projectionScope.projectionKind,
      records: [validRecord],
    })).toThrow(/does not accept device-sync-status\.v0/u);

    expect(parseHostedVaultShareDeliveryRecord({
      data: {
        observedAt: "2026-07-01T00:00:00.000Z",
        sources: [],
      },
      occurredAt: "2026-07-01T00:00:00.000Z",
      recordKey: "device-sync-status",
    }, projectionScope).data).toEqual({
      observedAt: "2026-07-01T00:00:00.000Z",
      sources: [],
    });
  });

  it("enforces the public source count and label bounds", () => {
    const boundedSources = Array.from({ length: 8 }, (_, index) => ({
      ...validRecord.data.sources[0],
      label: `Source ${index}`,
    }));
    expect(parseHostedVaultShareDeliveryRecord({
      ...validRecord,
      data: { ...validRecord.data, sources: boundedSources },
    }, projectionScope).data).toMatchObject({ sources: boundedSources });

    expect(() => parseHostedVaultShareDeliveryRecord({
      ...validRecord,
      data: {
        ...validRecord.data,
        sources: [
          ...boundedSources,
          { ...validRecord.data.sources[0], label: "Source 8" },
        ],
      },
    }, projectionScope)).toThrow(/at most 8 entries/u);

    expect(() => parseHostedVaultShareDeliveryRecord({
      ...validRecord,
      data: {
        ...validRecord.data,
        sources: [{
          ...validRecord.data.sources[0],
          label: "s".repeat(81),
        }],
      },
    }, projectionScope)).toThrow(/1-80 characters/u);
  });

  it("rejects drifting keys, day buckets, extra fields, and duplicate labels", () => {
    const invalidRecords = [
      { ...validRecord, recordKey: "device-status" },
      {
        ...validRecord,
        data: { ...validRecord.data, observedAt: "2026-07-01T12:00:00.000Z" },
        occurredAt: "2026-07-01T12:00:00.000Z",
      },
      {
        ...validRecord,
        data: { ...validRecord.data, privateAccountId: "must-not-land" },
      },
      {
        ...validRecord,
        data: {
          ...validRecord.data,
          sources: [{
            ...validRecord.data.sources[0],
            rawProvider: "apple_health",
          }],
        },
      },
      {
        ...validRecord,
        data: {
          ...validRecord.data,
          sources: [
            validRecord.data.sources[0],
            { ...validRecord.data.sources[0], label: "apple health" },
          ],
        },
      },
    ];

    for (const record of invalidRecords) {
      expect(() => parseHostedVaultShareDeliveryRecord(record, projectionScope)).toThrow();
    }
  });

  it("rejects private infrastructure labels, invalid statuses, and bad or future times", () => {
    const invalidSources = [
      { ...validRecord.data.sources[0], label: "Junction" },
      { ...validRecord.data.sources[0], status: "error" },
      { ...validRecord.data.sources[0], statusObservedAt: "not-a-time" },
      { ...validRecord.data.sources[0], statusObservedAt: "2999-01-01T00:00:00.000Z" },
      {
        ...validRecord.data.sources[0],
        connectionSyncJobCompletedAt: "2999-01-01T00:00:00.000Z",
      },
    ];

    for (const source of invalidSources) {
      expect(() => parseHostedVaultShareDeliveryRecord({
        ...validRecord,
        data: { ...validRecord.data, sources: [source] },
      }, projectionScope)).toThrow();
    }

    expect(() => parseHostedVaultShareDeliveryRecord({
      ...validRecord,
      data: { ...validRecord.data, observedAt: "2999-01-01T00:00:00.000Z" },
      occurredAt: "2999-01-01T00:00:00.000Z",
    }, projectionScope)).toThrow(/future/u);
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
