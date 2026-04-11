import { describe, expect, it } from "vitest";

import { normalizeOuraSnapshot } from "../../src/device-providers/oura.ts";
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

describe("normalizeOuraSnapshot", () => {
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
});
