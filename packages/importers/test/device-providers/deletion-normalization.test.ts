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
        role: "deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted",
        fileName: "deletion-sleep-sleep_123-2026-04-10T00-00-00.000Z-sleep.deleted.json",
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
    expect(events[0]?.rawArtifactRoles).toEqual([
      "deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted",
    ]);
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
      "deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted",
      "deletion:sleep:sleep_123:2026-04-10T00:01:00.000Z:sleep.deleted",
    ]);
    expect(events.map((event) => event.rawArtifactRoles)).toEqual([
      ["deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted"],
      ["deletion:sleep:sleep_123:2026-04-10T00:01:00.000Z:sleep.deleted"],
    ]);
  });

  it("adds a deterministic ordinal when repeated delete observations share identical metadata", () => {
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
        role: "deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted",
        fileName: "deletion-sleep-sleep_123-2026-04-10T00-00-00.000Z-sleep.deleted.json",
      },
      {
        role: "deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted:2",
        fileName: "deletion-sleep-sleep_123-2026-04-10T00-00-00.000Z-sleep.deleted-2.json",
      },
    ]);
    expect(events.map((event) => event.rawArtifactRoles)).toEqual([
      ["deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted"],
      ["deletion:sleep:sleep_123:2026-04-10T00:00:00.000Z:sleep.deleted:2"],
    ]);
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
        role: "deletion:sleep:sleep_123:2026-04-09T09:30:00.000Z:sleep.deleted",
        fileName: "deletion-sleep-sleep_123-2026-04-09T09-30-00.000Z-sleep.deleted.json",
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
    expect(normalized.events?.[0]?.rawArtifactRoles).toEqual([
      "deletion:sleep:sleep_123:2026-04-09T09:30:00.000Z:sleep.deleted",
    ]);
  });
});
