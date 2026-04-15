import { describe, expect, it } from "vitest";

import { normalizeGarminSnapshot } from "../../src/device-providers/garmin.ts";
import { buildSyntheticDeletionResourceId } from "../../src/device-providers/shared-normalization.ts";
import { normalizeOuraSnapshot } from "../../src/device-providers/oura.ts";
import { normalizeWhoopSnapshot } from "../../src/device-providers/whoop.ts";
import { pushDeletionObservation } from "../../src/device-providers/shared-normalization.ts";

function makeExternalRef(resourceType: string, resourceId: string, version?: string, facet?: string) {
  return {
    system: "oura",
    resourceType,
    resourceId,
    version,
    facet,
  };
}

function expectSyntheticDeletionArtifact(
  normalized: {
    events?: Array<{
      externalRef?: {
        resourceId?: string;
      };
      rawArtifactRoles?: string[];
    }>;
    rawArtifacts?: Array<{
      content: unknown;
      fileName: string;
      mediaType?: string;
      role: string;
    }>;
  },
  provider: string,
  resourceType: string,
  occurredAt: string,
  sourceEventType: string,
) {
  expect(normalized.events).toHaveLength(1);
  expect(normalized.rawArtifacts).toHaveLength(1);

  const rawArtifact = normalized.rawArtifacts?.[0];
  expect(rawArtifact).toEqual({
    role: expect.stringMatching(
      new RegExp(
        `^deletion:${resourceType}:deleted-[0-9a-f]{16}:${occurredAt}:${sourceEventType}:[0-9a-f]{64}$`,
        "u",
      ),
    ),
    fileName: expect.stringMatching(
      new RegExp(
        `^deletion-${resourceType}-deleted-[0-9a-f]{16}-${occurredAt.replaceAll(":", "-")}-${sourceEventType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[0-9a-f]{64}\\.json$`,
        "u",
      ),
    ),
    mediaType: "application/json",
    content: {
      provider,
      resourceType,
      resourceId: expect.stringMatching(/^deleted-[0-9a-f]{16}$/u),
      occurredAt,
      sourceEventType,
    },
  });
  expect(normalized.events?.[0]?.rawArtifactRoles).toEqual([rawArtifact?.role]);
  expect(normalized.events?.[0]?.externalRef?.resourceId).toMatch(
    /^deleted-[0-9a-f]{16}$/u,
  );
}

describe("pushDeletionObservation", () => {
  it("persists a metadata-only deletion artifact", () => {
    const events: Parameters<typeof pushDeletionObservation>[0] = [];
    const rawArtifacts: Parameters<typeof pushDeletionObservation>[1] = [];

    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
      makeExternalRef,
    });

    expect(rawArtifacts).toEqual([
      {
        role: expect.stringMatching(
          /^deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted:[0-9a-f]{64}$/u,
        ),
        fileName: expect.stringMatching(/^deletion-sleep-sleep_123-2026-04-10T00-00-00.000Z-sleep.deleted-[0-9a-f]{64}\.json$/u),
        mediaType: "application/json",
        content: {
          provider: "oura",
          resourceType: "sleep",
          resourceId: "sleep_123",
          occurredAt: "2026-04-10T00:00:00.000Z",
          sourceEventType: "sleep.deleted",
        },
      },
    ]);
    expect(events[0]?.rawArtifactRoles).toEqual([rawArtifacts[0]?.role]);
  });

  it("uses distinct deletion artifact roles for separate delete observations", () => {
    const events: Parameters<typeof pushDeletionObservation>[0] = [];
    const rawArtifacts: Parameters<typeof pushDeletionObservation>[1] = [];

    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
      makeExternalRef,
    });
    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:01:00.000Z",
      sourceEventType: "sleep.deleted",
      makeExternalRef,
    });

    expect(rawArtifacts.map((artifact) => artifact.role)).toEqual([
      expect.stringMatching(
        /^deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted:[0-9a-f]{64}$/u,
      ),
      expect.stringMatching(
        /^deletion:sleep:sleep_123:2026-04-10T00:01:00.000Z:sleep.deleted:[0-9a-f]{64}$/u,
      ),
    ]);
    expect(events.map((event) => event.rawArtifactRoles)).toEqual([
      [rawArtifacts[0]?.role],
      [rawArtifacts[1]?.role],
    ]);
  });

  it("keeps distinct deletion identities when the source event type changes", () => {
    const events: Parameters<typeof pushDeletionObservation>[0] = [];
    const rawArtifacts: Parameters<typeof pushDeletionObservation>[1] = [];

    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
      makeExternalRef,
    });
    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "sleep.hard-deleted",
      makeExternalRef,
    });

    expect(rawArtifacts).toHaveLength(2);
    expect(rawArtifacts[0]?.role).not.toEqual(rawArtifacts[1]?.role);
    expect(rawArtifacts[0]?.fileName).not.toEqual(rawArtifacts[1]?.fileName);
    expect(events.map((event) => event.rawArtifactRoles)).toEqual([
      [rawArtifacts[0]?.role],
      [rawArtifacts[1]?.role],
    ]);
  });

  it("collapses exact duplicate delete observations that share identical metadata", () => {
    const events: Parameters<typeof pushDeletionObservation>[0] = [];
    const rawArtifacts: Parameters<typeof pushDeletionObservation>[1] = [];

    const deletion = {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
      makeExternalRef,
    } satisfies Parameters<typeof pushDeletionObservation>[2];

    pushDeletionObservation(events, rawArtifacts, deletion);
    pushDeletionObservation(events, rawArtifacts, deletion);

    expect(rawArtifacts.map((artifact) => ({
      role: artifact.role,
      fileName: artifact.fileName,
    }))).toEqual([
      {
        role: expect.stringMatching(
          /^deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted:[0-9a-f]{64}$/u,
        ),
        fileName: expect.stringMatching(/^deletion-sleep-sleep_123-2026-04-10T00-00-00.000Z-sleep.deleted-[0-9a-f]{64}\.json$/u),
      },
    ]);
    expect(events.map((event) => event.rawArtifactRoles)).toEqual([[rawArtifacts[0]?.role]]);
  });
});

describe("buildSyntheticDeletionResourceId", () => {
  it("is stable across equivalent payload key order", () => {
    const options = {
      provider: "oura",
      resourceType: "sleep",
      occurredAt: "2026-04-11T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
    };

    const left = buildSyntheticDeletionResourceId({
      ...options,
      deletion: {
        event_type: "sleep.deleted",
        nested: { b: 2, a: 1 },
        occurred_at: options.occurredAt,
      },
    });

    const right = buildSyntheticDeletionResourceId({
      ...options,
      deletion: {
        occurred_at: options.occurredAt,
        nested: { a: 1, b: 2 },
        event_type: "sleep.deleted",
      },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^deleted-[0-9a-f]{16}$/u);
  });

  it("ignores alias-only differences in normalized deletion identity fields", () => {
    const options = {
      provider: "oura",
      resourceType: "sleep",
      occurredAt: "2026-04-11T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
    };

    const snakeCase = buildSyntheticDeletionResourceId({
      ...options,
      deletion: {
        event_type: "sleep.deleted",
        occurred_at: options.occurredAt,
        payload: { tombstone: "alpha" },
        resource_type: "sleep",
      },
    });

    const camelCase = buildSyntheticDeletionResourceId({
      ...options,
      deletion: {
        eventTime: options.occurredAt,
        payload: { tombstone: "alpha" },
        resourceType: "sleep",
        sourceEventType: "sleep.deleted",
      },
    });

    expect(snakeCase).toBe(camelCase);
  });

  it("changes when the deletion payload meaningfully changes", () => {
    const shared = {
      provider: "whoop",
      resourceType: "workout",
      occurredAt: "2026-04-11T00:00:00.000Z",
      sourceEventType: "workout.deleted",
    };

    expect(
      buildSyntheticDeletionResourceId({
        ...shared,
        deletion: { occurred_at: shared.occurredAt, tombstone: "alpha" },
      }),
    ).not.toBe(
      buildSyntheticDeletionResourceId({
        ...shared,
        deletion: { occurred_at: shared.occurredAt, tombstone: "beta" },
      }),
    );
  });
});

describe("normalizeOuraSnapshot", () => {
  it("generates deterministic synthetic deletion ids when stable ids are missing", () => {
    const normalized = normalizeOuraSnapshot({
      accountId: "acct_1",
      importedAt: "2026-04-10T00:00:00.000Z",
      deletions: [
        {
          resource_type: "sleep",
          occurred_at: "2026-04-09T09:30:00.000Z",
          source_event_type: "sleep.deleted",
          payload: {
            profile: "sensitive",
          },
        },
      ],
    });

    expectSyntheticDeletionArtifact(
      normalized,
      "oura",
      "sleep",
      "2026-04-09T09:30:00.000Z",
      "sleep.deleted",
    );
  });

  it("does not keep full deleted sleep payload artifacts", () => {
    const normalized = normalizeOuraSnapshot({
      accountId: "acct_1",
      importedAt: "2026-04-10T00:00:00.000Z",
      sleeps: [
        {
          id: "sleep_123",
          type: "deleted",
          timestamp: "2026-04-09T09:30:00.000Z",
          bedtime_start: "2026-04-08T23:00:00.000Z",
          bedtime_end: "2026-04-09T07:00:00.000Z",
          payload: {
            profile: "sensitive",
          },
        },
      ],
    });

    expect(normalized.rawArtifacts).toEqual([
      {
        role: expect.stringMatching(
          /^deletion:sleep:sleep_123:2026-04-09T09:30:00.000Z:sleep.deleted:[0-9a-f]{64}$/u,
        ),
        fileName: expect.stringMatching(/^deletion-sleep-sleep_123-2026-04-09T09-30-00.000Z-sleep.deleted-[0-9a-f]{64}\.json$/u),
        mediaType: "application/json",
        content: {
          provider: "oura",
          resourceType: "sleep",
          resourceId: "sleep_123",
          occurredAt: "2026-04-09T09:30:00.000Z",
          sourceEventType: "sleep.deleted",
        },
      },
    ]);
    expect(normalized.events?.[0]?.rawArtifactRoles).toEqual([normalized.rawArtifacts?.[0]?.role]);
  });

  it("dedupes overlapping deleted-sleep and deletions inputs", () => {
    const normalized = normalizeOuraSnapshot({
      accountId: "acct_1",
      importedAt: "2026-04-10T00:00:00.000Z",
      sleeps: [
        {
          id: "sleep_123",
          type: "deleted",
          timestamp: "2026-04-09T09:30:00.000Z",
        },
      ],
      deletions: [
        {
          resource_type: "sleep",
          resource_id: "sleep_123",
          occurred_at: "2026-04-09T09:30:00.000Z",
          source_event_type: "sleep.deleted",
        },
      ],
    });

    expect(normalized.rawArtifacts).toHaveLength(1);
    expect(normalized.events).toHaveLength(1);
    expect(normalized.events?.[0]?.rawArtifactRoles).toEqual([normalized.rawArtifacts?.[0]?.role]);
  });

  it("dedupes alias-equivalent deletions when a stable id is missing", () => {
    const normalized = normalizeOuraSnapshot({
      accountId: "acct_1",
      importedAt: "2026-04-10T00:00:00.000Z",
      deletions: [
        {
          event_type: "sleep.deleted",
          occurred_at: "2026-04-09T09:30:00.000Z",
          payload: {
            profile: "sensitive",
          },
          resource_type: "sleep",
        },
        {
          eventTime: "2026-04-09T09:30:00.000Z",
          payload: {
            profile: "sensitive",
          },
          resourceType: "sleep",
          sourceEventType: "sleep.deleted",
        },
      ],
    });

    expect(normalized.rawArtifacts).toHaveLength(1);
    expect(normalized.events).toHaveLength(1);
    expect(normalized.events?.[0]?.externalRef?.resourceId).toMatch(/^deleted-[0-9a-f]{16}$/u);
    expect(normalized.events?.[0]?.rawArtifactRoles).toEqual([normalized.rawArtifacts?.[0]?.role]);
  });

  it("keeps distinct deletion artifacts when sanitized file names would otherwise collide", () => {
    const events: Parameters<typeof pushDeletionObservation>[0] = [];
    const rawArtifacts: Parameters<typeof pushDeletionObservation>[1] = [];

    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "sleep/deleted",
      makeExternalRef,
    });
    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "sleep:deleted",
      makeExternalRef,
    });

    expect(rawArtifacts).toHaveLength(2);
    expect(rawArtifacts[0]?.role).not.toEqual(rawArtifacts[1]?.role);
    expect(rawArtifacts[0]?.fileName).not.toEqual(rawArtifacts[1]?.fileName);
    expect(events).toHaveLength(2);
  });

  it("keeps distinct deletion identities when tuple members contain delimiters", () => {
    const events: Parameters<typeof pushDeletionObservation>[0] = [];
    const rawArtifacts: Parameters<typeof pushDeletionObservation>[1] = [];

    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep:123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "deleted",
      makeExternalRef,
    });
    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep:123",
      resourceId: "sleep",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: "deleted",
      makeExternalRef,
    });

    expect(rawArtifacts).toHaveLength(2);
    expect(rawArtifacts[0]?.role).not.toEqual(rawArtifacts[1]?.role);
    expect(rawArtifacts[0]?.fileName).not.toEqual(rawArtifacts[1]?.fileName);
    expect(events.map((event) => event.rawArtifactRoles)).toEqual([
      [rawArtifacts[0]?.role],
      [rawArtifacts[1]?.role],
    ]);
  });

  it("omits missing source event types from artifact strings instead of serializing undefined", () => {
    const events: Parameters<typeof pushDeletionObservation>[0] = [];
    const rawArtifacts: Parameters<typeof pushDeletionObservation>[1] = [];

    pushDeletionObservation(events, rawArtifacts, {
      provider: "oura",
      providerDisplayName: "Oura",
      resourceType: "sleep",
      resourceId: "sleep_123",
      occurredAt: "2026-04-10T00:00:00.000Z",
      sourceEventType: undefined,
      makeExternalRef,
    });

    expect(events).toHaveLength(1);
    expect(rawArtifacts).toHaveLength(1);
    expect(rawArtifacts[0]?.role).not.toContain("undefined");
    expect(rawArtifacts[0]?.fileName).not.toContain("undefined");
    expect(rawArtifacts[0]?.content).toEqual({
      occurredAt: "2026-04-10T00:00:00.000Z",
      provider: "oura",
      resourceId: "sleep_123",
      resourceType: "sleep",
    });
  });
});

describe("normalizeGarminSnapshot", () => {
  it("generates deterministic synthetic deletion ids when stable ids are missing", () => {
    const normalized = normalizeGarminSnapshot({
      accountId: "acct_2",
      importedAt: "2026-04-10T00:00:00.000Z",
      deletions: [
        {
          resourceType: "sleep",
          occurredAt: "2026-04-09T09:30:00.000Z",
          eventType: "sleep.deleted",
          payload: {
            profile: "sensitive",
          },
        },
      ],
    });

    expectSyntheticDeletionArtifact(
      normalized,
      "garmin",
      "sleep",
      "2026-04-09T09:30:00.000Z",
      "sleep.deleted",
    );
  });
});

describe("normalizeWhoopSnapshot", () => {
  it("generates deterministic synthetic deletion ids when stable ids are missing", () => {
    const normalized = normalizeWhoopSnapshot({
      accountId: "acct_3",
      importedAt: "2026-04-10T00:00:00.000Z",
      deletions: [
        {
          resource_type: "sleep",
          occurred_at: "2026-04-09T09:30:00.000Z",
          source_event_type: "sleep.deleted",
          payload: {
            profile: "sensitive",
          },
        },
      ],
    });

    expectSyntheticDeletionArtifact(
      normalized,
      "whoop",
      "sleep",
      "2026-04-09T09:30:00.000Z",
      "sleep.deleted",
    );
  });
});
