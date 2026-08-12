import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	buildHostedVaultShareGenerationToken: vi.fn(),
	replaceHostedVaultShareProjectionSnapshot: vi.fn(),
	findActiveHostedVaultShares: vi.fn(),
	requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-vault-share/projection-store", () => ({
	buildHostedVaultShareGenerationToken: mocks.buildHostedVaultShareGenerationToken,
	replaceHostedVaultShareProjectionSnapshot: mocks.replaceHostedVaultShareProjectionSnapshot,
	findActiveHostedVaultShares: mocks.findActiveHostedVaultShares,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({}));
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS,
  HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
  HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES,
  HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH,
  HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY,
  hostedVaultShareProjectionKindToScope,
  parseHostedVaultShareDeliverRequest,
  type HostedVaultShareDeliverRequest,
  type HostedVaultShareDeliveryRecord,
} from "@murphai/hosted-execution/vault-share";

import {
  HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
} from "@/src/lib/hosted-vault-share/delivery-limits";

type DeliverRouteModule =
  typeof import("../app/api/internal/hosted-runtime/vault-share/deliver/route");

let deliverRoute: DeliverRouteModule;

function recentRecord(daysAgo: number): {
  data: { date: string; sleepEndAt: string; sleepStartAt: string };
  occurredAt: string;
  recordKey: string;
} {
  const end = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 8 * 60 * 60 * 1000);
  const date = end.toISOString().slice(0, 10);

  return {
    data: {
      date,
      sleepEndAt: end.toISOString(),
      sleepStartAt: start.toISOString(),
    },
    // occurredAt is parser-pinned to the night-date midnight: it becomes plaintext mailbox
    // metadata, so it must disclose nothing beyond the night date.
    occurredAt: `${date}T00:00:00.000Z`,
    recordKey: date,
  };
}

function recentActivityRecord(daysAgo: number): {
  data: {
    date: string;
    metricKey: string;
    metricSemantics: typeof HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS;
    unit: string;
    value: number;
  };
  occurredAt: string;
  recordKey: string;
} {
  const day = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const date = day.toISOString().slice(0, 10);

  return {
    data: {
      date,
      metricKey: "activity-minutes",
      metricSemantics: HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS,
      unit: "minutes",
      value: 37,
    },
    occurredAt: `${date}T00:00:00.000Z`,
    recordKey: date,
  };
}

const STALE_RECORD = {
  data: {
    date: "1999-01-01",
    sleepEndAt: "1999-01-01T06:31:00.000Z",
    sleepStartAt: "1998-12-31T22:04:00.000Z",
  },
  occurredAt: "1999-01-01T00:00:00.000Z",
  recordKey: "1999-01-01",
};

const CURRENT_GENERATION_TOKEN = "a".repeat(43);
const STALE_GENERATION_TOKEN = "b".repeat(43);
const VALID_BODY = {
  expectedGenerationToken: CURRENT_GENERATION_TOKEN,
  projectionKind: "sleep-times.v0",
  records: [recentRecord(1)],
};

const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const SLEEP_SCOPE_KEY = buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE);
const ACTIVITY_SCOPE = hostedVaultShareProjectionKindToScope("activity-days.v0");
const ACTIVITY_SCOPE_KEY = buildHostedVaultShareProjectionScopeKey(ACTIVITY_SCOPE);
const WORKOUT_SCOPE = hostedVaultShareProjectionKindToScope("workout-days.v0");
const WORKOUT_SCOPE_KEY = buildHostedVaultShareProjectionScopeKey(WORKOUT_SCOPE);
const WORKOUTS_SCOPE = hostedVaultShareProjectionKindToScope("workouts.v0");
const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");
const PROFILE_SCOPE_KEY = buildHostedVaultShareProjectionScopeKey(PROFILE_SCOPE);
const MAXIMUM_WIDTH_WORKOUT_MINUTES = 0.0000030024105450300988;

const ACTIVE_SHARE = {
  destinationMemberId: "member_referee",
  grantorMemberId: "member_grantor",
  id: "share_1",
  projectionKind: "sleep-times.v0",
  projectionScope: SLEEP_SCOPE,
  projectionScopeKey: SLEEP_SCOPE_KEY,
};

const SECOND_SHARE = {
  destinationMemberId: "member_other_referee",
  grantorMemberId: "member_grantor",
  id: "share_2",
  projectionKind: "sleep-times.v0",
  projectionScope: SLEEP_SCOPE,
  projectionScopeKey: SLEEP_SCOPE_KEY,
};

function buildRequest(body: unknown): Request {
  const requestBody = typeof body === "object" && body !== null && !Array.isArray(body)
    ? { expectedGenerationToken: CURRENT_GENERATION_TOKEN, ...body }
    : body;
  return buildRawRequest(requestBody);
}

function buildRawRequest(body: unknown): Request {
  return new Request("https://web.test/api/internal/hosted-runtime/vault-share/deliver", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function workoutsDeliveryBody(workoutsPerDay: number): HostedVaultShareDeliverRequest {
  return {
    expectedGenerationToken: CURRENT_GENERATION_TOKEN,
    projectionKind: "workouts.v0",
    projectionScope: WORKOUTS_SCOPE,
    records: Array.from(
      { length: HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS },
      (_, dayIndex): HostedVaultShareDeliveryRecord => {
        const date = `2026-07-${String(24 - dayIndex).padStart(2, "0")}`;
        return {
          data: {
            calendarClosedThroughDate: "2026-07-23",
            date,
            timeSemantics: "canonical-event-zone-or-vault-zone.v0",
            workouts: Array.from(
              { length: workoutsPerDay },
              (_, workoutIndex) => ({
                kind: "x".repeat(HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH),
                minutes: MAXIMUM_WIDTH_WORKOUT_MINUTES,
                startLocalMs: 86_399_999 - workoutIndex,
              }),
            ),
          },
          occurredAt: `${date}T00:00:00.000Z`,
          recordKey: date,
          sourceRevision: "A".repeat(
            HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
          ),
        };
      },
    ),
  };
}

function sourceAwareSleepDeliveryBody(
  sourcesPerDay: number,
): HostedVaultShareDeliverRequest {
  const projectionScope = hostedVaultShareProjectionKindToScope(
    "deep-sleep-sources-days.v1",
  );
  const publicSources = [
    { label: "WHOOP", source: "whoop" },
    { label: "Oura", source: "oura" },
    { label: "Garmin", source: "garmin" },
    { label: "fitbit", source: "fitbit" },
    { label: "Manual", source: "manual" },
    { label: "Strava", source: "strava" },
  ] as const;
  return {
    expectedGenerationToken: CURRENT_GENERATION_TOKEN,
    projectionKind: projectionScope.projectionKind,
    projectionScope,
    records: Array.from(
      { length: HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS },
      (_, dayIndex): HostedVaultShareDeliveryRecord => {
        const date = `2026-07-${String(24 - dayIndex).padStart(2, "0")}`;
        return {
          data: {
            date,
            metricKey: "deep-sleep-minutes",
            projectedAt: "2026-07-24T23:59:59.999Z",
            provisional: true,
            sources: Array.from({ length: sourcesPerDay }, (_, sourceIndex) => ({
              label: publicSources[sourceIndex]?.label ?? "unknown",
              recordedAt: "2026-07-24T23:59:59.999Z",
              ...(publicSources[sourceIndex]?.source === "manual"
                ? { selected: true as const }
                : {}),
              source: publicSources[sourceIndex]?.source ?? "unknown",
              unit: "minutes",
              value: 1_000.0000000000001,
            })),
            sourcesDisagree: false,
            unit: "minutes",
            value: 1_000.0000000000001,
          },
          occurredAt: `${date}T00:00:00.000Z`,
          recordKey: date,
          sourceRevision: "A".repeat(
            HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
          ),
        };
      },
    ),
  };
}

describe("vault-share deliver route", () => {
  beforeAll(async () => {
    deliverRoute = await import(
      "../app/api/internal/hosted-runtime/vault-share/deliver/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_grantor");
    mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE]);
		mocks.buildHostedVaultShareGenerationToken.mockReturnValue(CURRENT_GENERATION_TOKEN);
		mocks.replaceHostedVaultShareProjectionSnapshot.mockResolvedValue("replaced");
  });

  it("keeps the maximum parser-valid workouts delivery body within the ingress limit", () => {
    const body = workoutsDeliveryBody(HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY);
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    const nextBoundBody = workoutsDeliveryBody(
      HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY + 1,
    );
    const nextBoundBodyBytes = new TextEncoder().encode(
      JSON.stringify(nextBoundBody),
    ).byteLength;

    expect(() => parseHostedVaultShareDeliverRequest(body)).not.toThrow();
    expect(() => parseHostedVaultShareDeliverRequest(nextBoundBody)).toThrow(
      new RegExp(`at most ${HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY}`, "u"),
    );
    expect(JSON.stringify(MAXIMUM_WIDTH_WORKOUT_MINUTES)).toHaveLength(24);
    expect(bodyBytes).toBe(18_447);
    expect(bodyBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
    expect(nextBoundBodyBytes).toBe(19_655);
    expect(nextBoundBodyBytes).toBeGreaterThan(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
  });

  it("keeps the maximum source-aware sleep body within the ingress limit", () => {
    const body = sourceAwareSleepDeliveryBody(
      HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES,
    );
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    const nextBoundBody = sourceAwareSleepDeliveryBody(
      HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES + 1,
    );
    const nextBoundBodyBytes = new TextEncoder().encode(
      JSON.stringify(nextBoundBody),
    ).byteLength;

    expect(() => parseHostedVaultShareDeliverRequest(body)).not.toThrow();
    expect(() => parseHostedVaultShareDeliverRequest(nextBoundBody)).toThrow(
      new RegExp(
        `1-${HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES} entries`,
        "u",
      ),
    );
    expect(bodyBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
    expect(nextBoundBodyBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
  });

  it("replaces the snapshot for every active share", async () => {
    const request = buildRequest(VALID_BODY);
    const response = await deliverRoute.POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES },
    );
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_grantor",
      projectionScope: SLEEP_SCOPE,
    });
		expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
			records: VALID_BODY.records,
			share: ACTIVE_SHARE,
		});
  });

  it("preserves activity semantics through the deliver route into snapshot storage", async () => {
    const activityShare = {
      ...ACTIVE_SHARE,
      projectionKind: "activity-days.v0",
      projectionScope: ACTIVITY_SCOPE,
      projectionScopeKey: ACTIVITY_SCOPE_KEY,
    };
    const record = recentActivityRecord(1);
    mocks.findActiveHostedVaultShares.mockResolvedValue([activityShare]);

    const response = await deliverRoute.POST(buildRequest({
      projectionKind: "activity-days.v0",
      records: [record],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_grantor",
      projectionScope: ACTIVITY_SCOPE,
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      records: [record],
      share: activityShare,
    });
  });

  it("preserves workout semantics through the deliver route into snapshot storage", async () => {
    const workoutShare = {
      ...ACTIVE_SHARE,
      projectionKind: "workout-days.v0",
      projectionScope: WORKOUT_SCOPE,
      projectionScopeKey: WORKOUT_SCOPE_KEY,
    };
    const activityRecord = recentActivityRecord(1);
    const record = {
      ...activityRecord,
      data: {
        date: activityRecord.data.date,
        metricSemantics: HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
        workoutCount: 2,
        workoutMinutes: 77,
      },
    };
    mocks.findActiveHostedVaultShares.mockResolvedValue([workoutShare]);

    const response = await deliverRoute.POST(buildRequest({
      projectionKind: "workout-days.v0",
      records: [record],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_grantor",
      projectionScope: WORKOUT_SCOPE,
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      records: [record],
      share: workoutShare,
    });
  });

  it("returns no-active-share and appends nothing when no grant exists", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([]);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a tokenless previous runtime before resolving or replacing shares", async () => {
    const { expectedGenerationToken: _omitted, ...tokenlessBody } = VALID_BODY;
    const response = await deliverRoute.POST(buildRawRequest(tokenlessBody));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.findActiveHostedVaultShares).not.toHaveBeenCalled();
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

  it("rejects records read under a share generation that rotated before delivery", async () => {
    const response = await deliverRoute.POST(buildRequest({
      ...VALID_BODY,
      expectedGenerationToken: STALE_GENERATION_TOKEN,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.buildHostedVaultShareGenerationToken).toHaveBeenCalledWith([
      ACTIVE_SHARE.id,
    ]);
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

	it("treats an inactive destination runtime exactly like a missing grant", async () => {
		mocks.replaceHostedVaultShareProjectionSnapshot.mockResolvedValue("no-active-share");

		const response = await deliverRoute.POST(buildRequest(VALID_BODY));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "no-active-share" });
		expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(1);
	});

	it("treats an inactive grantor runtime exactly like a missing grant", async () => {
		mocks.replaceHostedVaultShareProjectionSnapshot.mockResolvedValue("no-active-share");

		const response = await deliverRoute.POST(buildRequest(VALID_BODY));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "no-active-share" });
		expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledTimes(1);
		expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(1);
	});

  it("returns delivered when at least one exact share generation is replaced", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE, SECOND_SHARE]);
    mocks.replaceHostedVaultShareProjectionSnapshot
      .mockResolvedValueOnce("no-active-share")
      .mockResolvedValueOnce("replaced");

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(2);
  });

	it("replaces an all-stale offer with an empty snapshot", async () => {
		const response = await deliverRoute.POST(
			buildRequest({
        projectionKind: "sleep-times.v0",
        records: [STALE_RECORD],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      records: [],
      share: ACTIVE_SHARE,
    });
  });

  it("keeps an all-stale offer indistinguishable when the destination is inactive", async () => {
    // The status must be a function of share configuration alone: a grantor probing with
    // stale records learns nothing finer than the normal active/no-active-share split.
    mocks.replaceHostedVaultShareProjectionSnapshot.mockResolvedValue("no-active-share");

    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "sleep-times.v0",
        records: [STALE_RECORD],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      records: [],
      share: ACTIVE_SHARE,
    });
  });

  it("delivers only the in-window records when an offer mixes stale and fresh records", async () => {
    const freshRecord = recentRecord(1);
    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "sleep-times.v0",
        records: [STALE_RECORD, freshRecord],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      records: [freshRecord],
      share: ACTIVE_SHARE,
    });
  });

  it("delivers a profile name no matter how long ago it was set", async () => {
    // profile-name.v0 is a current-state record with one fixed recordKey, not a
    // time-series: a name set months before the first group join is still the
    // member's current name and must reach the destination.
    const profileShare = {
      ...ACTIVE_SHARE,
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      projectionScopeKey: PROFILE_SCOPE_KEY,
    };
    mocks.findActiveHostedVaultShares.mockResolvedValue([profileShare]);
    const record = {
      data: { displayName: "Theo" },
      occurredAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
      recordKey: "profile-name",
    };

    const response = await deliverRoute.POST(
      buildRequest({ projectionKind: "profile-name.v0", records: [record] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      records: [record],
      share: profileShare,
    });
  });

  it("replaces a future-dated profile name with an empty snapshot", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([
      {
        ...ACTIVE_SHARE,
        projectionKind: "profile-name.v0",
        projectionScope: PROFILE_SCOPE,
        projectionScopeKey: PROFILE_SCOPE_KEY,
      },
    ]);

    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "profile-name.v0",
        records: [{
          data: { displayName: "Theo" },
          occurredAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          recordKey: "profile-name",
        }],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      records: [],
      share: expect.objectContaining({ projectionKind: "profile-name.v0" }),
    });
  });

  it("keeps delivering to later shares but returns retryable failure when an active delivery fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE, SECOND_SHARE]);
      mocks.replaceHostedVaultShareProjectionSnapshot
        .mockRejectedValueOnce(new Error("destination mailbox down"))
        .mockResolvedValueOnce("replaced");

      const response = await deliverRoute.POST(buildRequest(VALID_BODY));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "HOSTED_VAULT_SHARE_DELIVERY_FAILED",
          details: undefined,
          message: "Hosted vault-share delivery failed. Retry the request.",
          retryable: true,
        },
      });
      expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(2);
      // The operator log carries structured error details only — never payload fields,
      // timestamps, or the raw share id linking grantor and destination state.
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted vault-share delivery to a destination share failed.",
        {
          errorCode: "HOSTED_VAULT_SHARE_DESTINATION_DELIVERY_FAILED",
          errorMessage: "destination mailbox down",
          errorType: "Error",
        },
      );
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted onboarding route failed.",
        expect.objectContaining({
          errorResponseCode: "HOSTED_VAULT_SHARE_DELIVERY_FAILED",
          errorResponseRetryable: true,
          errorResponseStatus: 503,
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("returns retryable failure when authoritative replacement access checking errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      mocks.replaceHostedVaultShareProjectionSnapshot.mockRejectedValue(
        new Error("runtime access query failed"),
      );

      const response = await deliverRoute.POST(buildRequest(VALID_BODY));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "HOSTED_VAULT_SHARE_DELIVERY_FAILED",
          details: undefined,
          message: "Hosted vault-share delivery failed. Retry the request.",
          retryable: true,
        },
      });
      expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted vault-share delivery to a destination share failed.",
        {
          errorCode: "HOSTED_VAULT_SHARE_DESTINATION_DELIVERY_FAILED",
          errorMessage: "runtime access query failed",
          errorType: "Error",
        },
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("rejects payloads that do not match the closed schema", async () => {
    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          data: { date: "whenever", sleepEndAt: "x", sleepStartAt: "y" },
          occurredAt: "z",
          recordKey: "whenever",
        }],
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.findActiveHostedVaultShares).not.toHaveBeenCalled();
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

  it("rejects device sync status because Web derives it live", async () => {
    const response = await deliverRoute.POST(buildRequest({
      projectionKind: "device-sync-status.v0",
      records: [],
    }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.findActiveHostedVaultShares).not.toHaveBeenCalled();
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

  it("does not let a grantor deliver as someone else: identity comes from callback auth only", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_other");
    mocks.findActiveHostedVaultShares.mockResolvedValue([]);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_other",
      projectionScope: SLEEP_SCOPE,
    });
    expect(await response.json()).toEqual({ status: "no-active-share" });
  });

});
