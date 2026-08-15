import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	buildHostedVaultShareGenerationToken: vi.fn(),
	replaceHostedVaultShareProjectionSnapshot: vi.fn(),
	findActiveHostedVaultShares: vi.fn(),
	hasUnmaterializedHostedVaultShareProjectionGeneration: vi.fn(),
	requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-vault-share/projection-store", () => ({
	buildHostedVaultShareGenerationToken: mocks.buildHostedVaultShareGenerationToken,
	replaceHostedVaultShareProjectionSnapshot: mocks.replaceHostedVaultShareProjectionSnapshot,
	findActiveHostedVaultShares: mocks.findActiveHostedVaultShares,
	hasUnmaterializedHostedVaultShareProjectionGeneration:
		mocks.hasUnmaterializedHostedVaultShareProjectionGeneration,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({}));
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS,
  HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
  HOSTED_VAULT_SHARE_DATA_SOURCE_MAX_SOURCES,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
  HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE,
  HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
  HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
  HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH,
  HOSTED_VAULT_SHARE_HEART_RATE_ZONES_MAX_PER_DAY,
  HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
  HOSTED_VAULT_SHARE_SINGLE_SOURCE_MAX_RECORDS,
  HOSTED_VAULT_SHARE_SOURCE_TAGGED_WORKOUTS_MAX_PER_DAY,
  HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH,
  HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY,
  hostedVaultShareProjectionKindToScope,
  parseHostedVaultShareDeliverRequest,
  type HostedVaultShareDeliverRequest,
  type HostedVaultShareDeliveryRecord,
} from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
} from "@/src/lib/hosted-vault-share/delivery-limits";
import {
  HostedDomainRootEnvelopeUnavailableError,
} from "@/src/lib/hosted-crypto/domain-root-store";

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
  sourceWorkspaceVersion: "7",
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
function maximumWidthWorkoutSource(sourceIndex: number) {
  const source = `${String.fromCharCode(97 + sourceIndex)}${"x".repeat(79)}`;
  return { label: source, source };
}

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

function buildRequest(body: unknown, signal?: AbortSignal): Request {
  const requestBody = body !== null && typeof body === "object" && !Array.isArray(body)
    ? {
        expectedGenerationToken: CURRENT_GENERATION_TOKEN,
        sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
        ...body,
      }
    : body;
  return buildRawRequest(requestBody, signal);
}

function buildRawRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("https://web.test/api/internal/hosted-runtime/vault-share/deliver", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      [HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER]: String(
        Date.now() + HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
      ),
    },
    method: "POST",
    ...(signal ? { signal } : {}),
  });
}

function deliveryEffectControls() {
  return {
    deadlineAtEpochMs: expect.any(Number),
    signal: expect.any(AbortSignal),
  };
}

function workoutsDeliveryBody(
  workoutsPerSource: number,
): HostedVaultShareDeliverRequest {
  return {
    expectedGenerationToken: CURRENT_GENERATION_TOKEN,
    projectionKind: "workouts.v0",
    projectionScope: WORKOUTS_SCOPE,
    records: Array.from(
      { length: HOSTED_VAULT_SHARE_SINGLE_SOURCE_MAX_RECORDS },
      (_, dayIndex): HostedVaultShareDeliveryRecord => {
        const date = `2026-07-${String(24 - dayIndex).padStart(2, "0")}`;
        return {
          data: {
            calendarClosedThroughDate: "2026-07-23",
            date,
            timeSemantics: "canonical-event-zone-or-vault-zone.v0",
            workouts: Array.from(
              {
                length: workoutsPerSource
                  * HOSTED_VAULT_SHARE_DATA_SOURCE_MAX_SOURCES,
              },
              (_, workoutIndex) => ({
                kind: "x".repeat(HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH),
                minutes: MAXIMUM_WIDTH_WORKOUT_MINUTES,
                source: maximumWidthWorkoutSource(
                  Math.floor(workoutIndex / workoutsPerSource),
                ),
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
    sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
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
    { label: "Apple Health", source: "apple-health-kit" },
    { label: "Strava", source: "strava" },
    { label: "polar", source: "polar" },
    { label: "suunto", source: "suunto" },
    { label: "withings", source: "withings" },
  ] as const;
  return {
    expectedGenerationToken: CURRENT_GENERATION_TOKEN,
    projectionKind: projectionScope.projectionKind,
    projectionScope,
    records: Array.from(
      { length: 7 * sourcesPerDay },
      (_, recordIndex): HostedVaultShareDeliveryRecord => {
        const dayIndex = Math.floor(recordIndex / sourcesPerDay);
        const date = `2026-07-${String(24 - dayIndex).padStart(2, "0")}`;
        const source = publicSources[recordIndex % sourcesPerDay];
        if (!source) {
          throw new Error("Missing bounded public source fixture.");
        }
        return {
          data: {
            date,
            metricKey: "deep-sleep-minutes",
            provisional: true,
            recordedAt: `${date}T${String(6 + (recordIndex % sourcesPerDay)).padStart(2, "0")}:00:00.000Z`,
            unit: "minutes",
            value: 1_000.0000000000001,
          },
          occurredAt: `${date}T00:00:00.000Z`,
          recordKey: `${date}.${source.source}`,
          source,
          sourceRevision: "A".repeat(
            HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
          ),
        };
      },
    ),
    sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
  };
}

function heartRateZonesDeliveryBody(): HostedVaultShareDeliverRequest {
  const projectionScope = hostedVaultShareProjectionKindToScope(
    "heart-rate-zones-days.v0",
  );
  const sources = Array.from({ length: 8 }, (_, index) => ({
    label: `${"x".repeat(78)}-${index}`,
    source: `${"x".repeat(78)}-${index}`,
  }));
  return {
    expectedGenerationToken: CURRENT_GENERATION_TOKEN,
    projectionKind: projectionScope.projectionKind,
    projectionScope,
    records: Array.from(
      { length: 7 * sources.length },
      (_, recordIndex): HostedVaultShareDeliveryRecord => {
        const dayIndex = Math.floor(recordIndex / sources.length);
        const date = `2026-07-${String(24 - dayIndex).padStart(2, "0")}`;
        const source = sources[recordIndex % sources.length];
        if (!source) {
          throw new Error("Missing bounded public source fixture.");
        }
        return {
          data: {
            date,
            zones: Array.from(
              { length: HOSTED_VAULT_SHARE_HEART_RATE_ZONES_MAX_PER_DAY },
              (_, zone) => ({
                durationMinutes: MAXIMUM_WIDTH_WORKOUT_MINUTES,
                label: "é".repeat(
                  HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH,
                ),
                zone,
              }),
            ),
          },
          occurredAt: `${date}T00:00:00.000Z`,
          recordKey: `${date}.${source.source}`,
          source,
          sourceRevision: "A".repeat(
            HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH,
          ),
        };
      },
    ),
    sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
  };
}

describe("vault-share deliver route", () => {
  beforeAll(async () => {
    deliverRoute = await import(
      "../app/api/internal/hosted-runtime/vault-share/deliver/route"
    );
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_grantor");
    mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE]);
		mocks.hasUnmaterializedHostedVaultShareProjectionGeneration.mockResolvedValue(false);
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
      new RegExp(
        `at most ${HOSTED_VAULT_SHARE_SOURCE_TAGGED_WORKOUTS_MAX_PER_DAY} source-tagged entries`,
        "u",
      ),
    );
    expect(JSON.stringify(MAXIMUM_WIDTH_WORKOUT_MINUTES)).toHaveLength(24);
    expect(body.records[0]?.data).toMatchObject({
      workouts: expect.arrayContaining([
        expect.objectContaining({ source: maximumWidthWorkoutSource(0) }),
        expect.objectContaining({
          source: maximumWidthWorkoutSource(
            HOSTED_VAULT_SHARE_DATA_SOURCE_MAX_SOURCES - 1,
          ),
        }),
      ]),
    });
    expect(bodyBytes).toBeGreaterThan(250 * 1024);
    expect(bodyBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
    expect(nextBoundBodyBytes).toBeGreaterThan(bodyBytes);
  });

  it("keeps the maximum source-aware sleep body within the ingress limit", () => {
    const body = sourceAwareSleepDeliveryBody(8);
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    const nextBoundBody = sourceAwareSleepDeliveryBody(9);
    const nextBoundBodyBytes = new TextEncoder().encode(
      JSON.stringify(nextBoundBody),
    ).byteLength;

    expect(() => parseHostedVaultShareDeliverRequest(body)).not.toThrow();
    expect(() => parseHostedVaultShareDeliverRequest(nextBoundBody)).toThrow(
      new RegExp(`at most ${HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS}`, "u"),
    );
    expect(bodyBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
    expect(nextBoundBodyBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
  });

  it("accepts the maximum heart-rate-zone body within the ingress limit", async () => {
    const body = heartRateZonesDeliveryBody();
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    const projectionScope = hostedVaultShareProjectionKindToScope(
      "heart-rate-zones-days.v0",
    );
    mocks.findActiveHostedVaultShares.mockResolvedValue([{
      destinationMemberId: "member_referee",
      grantorMemberId: "member_grantor",
      id: "share_heart_rate_zones",
      projectionKind: projectionScope.projectionKind,
      projectionScope,
      projectionScopeKey: buildHostedVaultShareProjectionScopeKey(projectionScope),
    }]);

    expect(() => parseHostedVaultShareDeliverRequest(body)).not.toThrow();
    expect(bodyBytes).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
    );
    const response = await deliverRoute.POST(buildRequest(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
  });

  it("replaces the snapshot for every active share", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([
      ACTIVE_SHARE,
      SECOND_SHARE,
    ]);
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
		expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenNthCalledWith(1, {
			...deliveryEffectControls(),
			records: VALID_BODY.records,
			share: ACTIVE_SHARE,
			sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
		});
		expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenNthCalledWith(2, {
			...deliveryEffectControls(),
			records: VALID_BODY.records,
			share: SECOND_SHARE,
			sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
		});
  });

  it("limits first-materialization delivery to exact null-snapshot shares", async () => {
    const response = await deliverRoute.POST(buildRequest({
      ...VALID_BODY,
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_grantor",
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      projectionScope: SLEEP_SCOPE,
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      ...deliveryEffectControls(),
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      records: VALID_BODY.records,
      share: ACTIVE_SHARE,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
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
      ...deliveryEffectControls(),
      records: [record],
      share: activityShare,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
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
      ...deliveryEffectControls(),
      records: [record],
      share: workoutShare,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
    });
  });

  it("preserves source-recorded sleep times through the deliver route", async () => {
    const projectionScope = hostedVaultShareProjectionKindToScope(
      "deep-sleep-sources-days.v1",
    );
    const share = {
      ...ACTIVE_SHARE,
      projectionKind: projectionScope.projectionKind,
      projectionScope,
      projectionScopeKey: buildHostedVaultShareProjectionScopeKey(projectionScope),
    };
    const body = sourceAwareSleepDeliveryBody(2);
    const records = body.records.slice(0, 2);
    mocks.findActiveHostedVaultShares.mockResolvedValue([share]);

    const response = await deliverRoute.POST(buildRequest({
      projectionKind: projectionScope.projectionKind,
      records,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      ...deliveryEffectControls(),
      records,
      share,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
    });
    expect(records.map((record) => record.data)).toEqual([
      expect.objectContaining({ recordedAt: "2026-07-24T06:00:00.000Z" }),
      expect.objectContaining({ recordedAt: "2026-07-24T07:00:00.000Z" }),
    ]);
  });

  it("returns no-active-share and appends nothing when no grant exists", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([]);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.hasUnmaterializedHostedVaultShareProjectionGeneration)
      .toHaveBeenCalledWith({
        grantorMemberId: "member_grantor",
        projectionScope: SLEEP_SCOPE,
      });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

  it("returns retryable deferred when only inactive approved work remains", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([]);
    mocks.hasUnmaterializedHostedVaultShareProjectionGeneration.mockResolvedValue(true);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
        retryable: true,
      }),
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a tokenless previous runtime before resolving or replacing shares", async () => {
    const tokenlessBody = {
      projectionKind: VALID_BODY.projectionKind,
      records: VALID_BODY.records,
    };
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

  it("retries a stale generation while its replacement still needs a snapshot", async () => {
    mocks.hasUnmaterializedHostedVaultShareProjectionGeneration.mockResolvedValue(true);

    const response = await deliverRoute.POST(buildRequest({
      ...VALID_BODY,
      expectedGenerationToken: STALE_GENERATION_TOKEN,
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
        retryable: true,
      }),
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

  it("rejects records when participant access changes the active destination set", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE]);
    mocks.buildHostedVaultShareGenerationToken.mockReturnValue(
      CURRENT_GENERATION_TOKEN,
    );

    const response = await deliverRoute.POST(buildRequest({
      ...VALID_BODY,
      // This token represented the earlier owner-plus-participant destination
      // set; delivery now sees only the still-active owner-backed destination.
      expectedGenerationToken: STALE_GENERATION_TOKEN,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
  });

	it("retries when a destination becomes inactive during replacement", async () => {
		mocks.replaceHostedVaultShareProjectionSnapshot.mockResolvedValue("no-active-share");

		const response = await deliverRoute.POST(buildRequest(VALID_BODY));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: expect.objectContaining({
				code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
				retryable: true,
			}),
		});
		expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(1);
	});

  it("serializes the maximum destination fanout through the replacement boundary", async () => {
    const shares = Array.from(
      { length: HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX },
      (_, index) => ({
        ...ACTIVE_SHARE,
        destinationMemberId: `member_destination_${index}`,
        id: `share_generation_${index}`,
      }),
    );
    const replacementOrder: string[] = [];
    let activeReplacements = 0;
    let peakActiveReplacements = 0;
    mocks.findActiveHostedVaultShares.mockResolvedValue(shares);
    mocks.replaceHostedVaultShareProjectionSnapshot.mockImplementation(
      async ({ share }: { share: (typeof shares)[number] }) => {
        activeReplacements += 1;
        peakActiveReplacements = Math.max(
          peakActiveReplacements,
          activeReplacements,
        );
        try {
          await Promise.resolve();
          replacementOrder.push(share.id);
          return "replaced";
        } finally {
          activeReplacements -= 1;
        }
      },
    );

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledTimes(1);
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_grantor",
      projectionScope: SLEEP_SCOPE,
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(
      HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
    );
    expect(replacementOrder).toEqual(shares.map(({ id }) => id));
    expect(peakActiveReplacements).toBe(1);
    expect(activeReplacements).toBe(0);
  });

		it("treats an inactive grantor runtime exactly like a missing grant", async () => {
		mocks.replaceHostedVaultShareProjectionSnapshot.mockResolvedValue("no-active-share");

		const response = await deliverRoute.POST(buildRequest(VALID_BODY));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: expect.objectContaining({
				code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
				retryable: true,
			}),
		});
		expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledTimes(1);
		expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(1);
	});

  it("retries after replacing active destinations when another becomes inactive", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE, SECOND_SHARE]);
    mocks.replaceHostedVaultShareProjectionSnapshot
      .mockResolvedValueOnce("no-active-share")
      .mockResolvedValueOnce("replaced");

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
        retryable: true,
      }),
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(2);
  });

  it("admits no destination after the shared effect deadline has elapsed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = buildRequest(VALID_BODY);
    request.headers.set(
      HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
      String(Date.now() - 1),
    );

    try {
      const response = await deliverRoute.POST(request);

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE },
      });
      expect(mocks.replaceHostedVaultShareProjectionSnapshot).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("awaits the active replacement but admits no later share after cancellation", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    let releaseFirstReplacement = (): void => {
      throw new Error("First replacement did not start.");
    };
    const firstReplacementStarted = new Promise<void>((resolveStarted) => {
      mocks.replaceHostedVaultShareProjectionSnapshot
        .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
          expect(signal.aborted).toBe(false);
          resolveStarted();
          return new Promise<"replaced">((resolveReplacement) => {
            releaseFirstReplacement = () => resolveReplacement("replaced");
          });
        })
        .mockResolvedValueOnce("replaced");
    });
    mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE, SECOND_SHARE]);

    try {
      let responseSettled = false;
      const responsePromise = deliverRoute.POST(buildRequest(VALID_BODY, controller.signal));
      void responsePromise.finally(() => {
        responseSettled = true;
      });

      await firstReplacementStarted;
      controller.abort(new DOMException("Caller disconnected.", "AbortError"));
      await Promise.resolve();
      expect(responseSettled).toBe(false);

      releaseFirstReplacement();
      const response = await responsePromise;

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE },
      });
      expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledTimes(1);
      expect(
        mocks.replaceHostedVaultShareProjectionSnapshot.mock.calls[0]?.[0].signal.aborted,
      ).toBe(true);
    } finally {
      releaseFirstReplacement();
      consoleError.mockRestore();
    }
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
      ...deliveryEffectControls(),
      records: [],
      share: ACTIVE_SHARE,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
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

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
        retryable: true,
      }),
    });
    expect(mocks.replaceHostedVaultShareProjectionSnapshot).toHaveBeenCalledWith({
      ...deliveryEffectControls(),
      records: [],
      share: ACTIVE_SHARE,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
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
      ...deliveryEffectControls(),
      records: [freshRecord],
      share: ACTIVE_SHARE,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
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
      ...deliveryEffectControls(),
      records: [record],
      share: profileShare,
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
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
      ...deliveryEffectControls(),
      records: [],
      share: expect.objectContaining({ projectionKind: "profile-name.v0" }),
      sourceWorkspaceVersion: VALID_BODY.sourceWorkspaceVersion,
    });
  });

  it("keeps delivering to later shares when one destination root is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE, SECOND_SHARE]);
      mocks.replaceHostedVaultShareProjectionSnapshot
        .mockRejectedValueOnce(new HostedDomainRootEnvelopeUnavailableError({
          domain: "ingress",
        }))
        .mockResolvedValueOnce("replaced");

      const response = await deliverRoute.POST(buildRequest(VALID_BODY));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
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
          errorMessage: "Hosted ingress domain root envelope is not available for decrypt.",
          errorType: "HostedDomainRootEnvelopeUnavailableError",
        },
      );
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted onboarding route failed.",
        expect.objectContaining({
          errorResponseCode: HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
          errorResponseRetryable: true,
          errorResponseStatus: 503,
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("stops maximum destination fanout on an unclassified shared failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      mocks.findActiveHostedVaultShares.mockResolvedValue(Array.from(
        { length: HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX },
        (_, index) => ({
          ...ACTIVE_SHARE,
          destinationMemberId: `member_destination_${index}`,
          id: `share_generation_${index}`,
        }),
      ));
      mocks.replaceHostedVaultShareProjectionSnapshot.mockRejectedValue(
        new Error("synthetic shared KMS provider failure"),
      );

      const response = await deliverRoute.POST(buildRequest(VALID_BODY));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE,
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
          errorMessage: "synthetic shared KMS provider failure",
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
