import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildJunctionWearableHostedReplayPlan,
  JUNCTION_WEARABLE_HOSTED_DIRECT_REPLAY_BROWSER_VAULT_METRIC_EXPECTATIONS,
  promoteWearableCaptureToJunctionHostedSmokeFixture,
  runJunctionWearableFixtureE2e,
} from "../src/testing.ts";

describe("Junction wearable fixture testing helpers", () => {
  it("reject unsafe fixture data before building replay payloads or importing into a vault", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-fixture-"));
    const fixturePath = path.join(tempRoot, "junction-wearables-sanitized.json");

    try {
      await writeFile(fixturePath, JSON.stringify(buildUnsafeFixture()), "utf8");

      await expect(
        buildJunctionWearableHostedReplayPlan({ fixturePath }),
      ).rejects.toThrow("Junction wearable fixture is privacy unsafe.");
      await expect(
        runJunctionWearableFixtureE2e({ fixturePath }),
      ).rejects.toThrow("Junction wearable fixture is privacy unsafe.");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("promotes capture exports into hosted-smoke fixtures", () => {
    const promoted = promoteWearableCaptureToJunctionHostedSmokeFixture({
      ...buildCaptureFixture(),
      eventLedgers: [{ ignored: true }],
      metricSampleLedgers: [{ ignored: true }],
    }, {
      sourceExportHash: "b".repeat(64),
    });

    expect(promoted.schema).toBe("murph.junction-wearables-sanitized-fixture.v1");
    expect(promoted.fixtureKind).toBe("hosted-smoke");
    expect(promoted.sourceExportHash).toBe("b".repeat(64));
    expect(promoted).not.toHaveProperty("eventLedgers");
    expect(promoted).not.toHaveProperty("metricSampleLedgers");
  });

  it("makes hosted replay sizing explicit and emits production-shaped Junction event types", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-fixture-"));
    const fixturePath = path.join(tempRoot, "junction-wearables-hosted-smoke.json");

    try {
      await writeFile(fixturePath, JSON.stringify(buildSafeFixture({ recordCount: 30 })), "utf8");

      const smoke = await buildJunctionWearableHostedReplayPlan({ fixturePath });
      expect(smoke.replay).toEqual({
        droppedRecordCount: 0,
        mode: "directDirtyResource",
        recordLimitPerProviderResource: 24,
        size: "smoke",
      });
      expect(smoke.dirtyResources).toHaveLength(24);
      expect(smoke.dirtyResources.every((resource) =>
        resource.payload.eventType === "daily.data.activity.created"
      )).toBe(true);

      const full = await buildJunctionWearableHostedReplayPlan({
        fixturePath,
        replaySize: "full",
      });
      expect(full.replay).toEqual({
        droppedRecordCount: 0,
        mode: "directDirtyResource",
        recordLimitPerProviderResource: null,
        size: "full",
      });
      expect(full.dirtyResources).toHaveLength(30);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("does not replay dense timeseries artifacts that production no longer imports", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-fixture-"));
    const fixturePath = path.join(tempRoot, "junction-wearables-hosted-smoke.json");

    try {
      const fixture = buildSafeFixture({ recordCount: 1 });
      fixture.rawArtifacts.push({
        content: [{
          calendar_date: "2026-04-01",
          date: "2026-04-01",
          resource: "activity",
          sourceProviderSlug: "oura",
          steps: 58,
        }],
        relativePath: "hosted-smoke/oura/02-junction-timeseries-heartrate.json",
      });
      await writeFile(fixturePath, JSON.stringify(fixture), "utf8");

      const plan = await buildJunctionWearableHostedReplayPlan({ fixturePath });
      expect(plan.resources.map((resource) => [
        resource.resourceCategory,
        resource.resource,
      ])).toEqual([["summary", "activity"]]);
      expect(plan.dirtyResources.every((resource) =>
        resource.resourceCategory !== "timeseries"
      )).toBe(true);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("keeps hosted direct replay on resources that do not require Junction REST fallback", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-fixture-"));
    const fixturePath = path.join(tempRoot, "junction-wearables-hosted-smoke.json");

    try {
      const fixture = buildSafeFixture({ recordCount: 1 });
      fixture.rawArtifacts.push(
        {
          content: [{
            calendar_date: "2026-04-01",
            date: "2026-04-01",
            sourceProviderSlug: "garmin",
            stages: [],
          }],
          relativePath: "hosted-smoke/garmin/02-junction-summary-sleep-cycle.json",
        },
        {
          content: [{
            data: [{ timestamp: "2026-04-01T12:00:00.000Z", unit: "%", value: 97 }],
            sourceProviderSlug: "garmin",
          }],
          relativePath: "hosted-smoke/garmin/03-junction-timeseries-blood-oxygen.json",
        },
      );
      await writeFile(fixturePath, JSON.stringify(fixture), "utf8");

      const plan = await buildJunctionWearableHostedReplayPlan({ fixturePath });
      expect(plan.resources.map((resource) => [
        resource.resourceCategory,
        resource.resource,
      ])).toEqual([["summary", "activity"]]);
      expect(plan.dirtyResources.every((resource) =>
        resource.resourceCategory === "summary" && resource.resource === "activity"
      )).toBe(true);
      expect(
        JUNCTION_WEARABLE_HOSTED_DIRECT_REPLAY_BROWSER_VAULT_METRIC_EXPECTATIONS.map(
          (expectation) => expectation.metricKey,
        ),
      ).not.toEqual(expect.arrayContaining(["activity-minutes", "body-weight"]));
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("rejects invalid hosted replay record limits", async () => {
    await expect(buildJunctionWearableHostedReplayPlan({
      fixturePath: "unused.json",
      maxRecordsPerProviderResource: 0,
    })).rejects.toThrow(/positive integer/u);
    await expect(buildJunctionWearableHostedReplayPlan({
      fixturePath: "unused.json",
      maxRecordsPerProviderResource: Number.NaN,
    })).rejects.toThrow(/positive integer/u);
    await expect(buildJunctionWearableHostedReplayPlan({
      fixturePath: "unused.json",
      maxRecordsPerProviderResource: 24,
      replaySize: "full",
    })).rejects.toThrow(/full replay/u);
  });

  it("reads common hosted replay artifact wrapper shapes explicitly", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-fixture-"));
    const fixturePath = path.join(tempRoot, "junction-wearables-hosted-smoke.json");

    try {
      await writeFile(
        fixturePath,
        JSON.stringify(buildSafeFixture({
          content: {
            data: [
              {
                calendar_date: "2026-04-01",
                date: "2026-04-01",
                resource: "activity",
                sourceProviderSlug: "garmin",
                steps: 1,
              },
            ],
          },
          recordCount: 0,
        })),
        "utf8",
      );

      const plan = await buildJunctionWearableHostedReplayPlan({ fixturePath });
      expect(plan.dirtyResources).toHaveLength(1);
      expect(plan.resources[0]?.recordCount).toBe(1);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("fails explicitly when hosted replay wrapper fields are not arrays", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-fixture-"));
    const fixturePath = path.join(tempRoot, "junction-wearables-hosted-smoke.json");

    try {
      await writeFile(
        fixturePath,
        JSON.stringify(buildSafeFixture({
          content: {
            data: {
              calendar_date: "2026-04-01",
              sourceProviderSlug: "garmin",
            },
          },
          recordCount: 0,
        })),
        "utf8",
      );

      await expect(buildJunctionWearableHostedReplayPlan({ fixturePath }))
        .rejects.toThrow(/wrapper field data must be an array/u);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when hosted replay records would be dropped", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-fixture-"));
    const fixturePath = path.join(tempRoot, "junction-wearables-hosted-smoke.json");

    try {
      await writeFile(
        fixturePath,
        JSON.stringify(buildSafeFixture({
          recordCount: 1,
          oversizedRecord: true,
        })),
        "utf8",
      );

      await expect(buildJunctionWearableHostedReplayPlan({ fixturePath }))
        .rejects.toThrow(/dropped oversized record/u);
      const partial = await buildJunctionWearableHostedReplayPlan({
        allowDroppedRecords: true,
        fixturePath,
      });
      expect(partial.replay.droppedRecordCount).toBe(1);
      expect(partial.dirtyResources).toHaveLength(0);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

function buildCaptureFixture() {
  return {
    ...buildSafeFixture({ recordCount: 1 }),
    schema: "murph.wearable-fixture-capture.v1",
  };
}

function buildUnsafeFixture() {
  return {
    fixtureKind: "hosted-smoke",
    generatedAt: "2026-09-28T23:59:59.999Z",
    rawArtifacts: [
      {
        content: [
          {
            access_token: "secret-access-token",
            calendar_date: "2026-09-28",
            email: "person@example.test",
            sourceProviderSlug: "garmin",
            title: "unsafe-freeform-title",
          },
        ],
        relativePath: "hosted-smoke/garmin/01-junction-summary-activity.json",
      },
    ],
    redactionReport: {
      droppedKeys: 1,
      includedJsonFiles: 1,
      includedJsonlRecords: 0,
      pseudonymizedValues: 1,
      scannedFiles: 1,
      shiftedDates: 1,
    },
    schema: "murph.junction-wearables-sanitized-fixture.v1",
    sourceExportHash: "a".repeat(64),
    targets: [
      {
        id: "garmin",
        label: "Garmin",
        sourceProviderSlug: "garmin",
      },
    ],
  };
}

function buildSafeFixture(input: {
  content?: unknown;
  oversizedRecord?: boolean;
  recordCount: number;
}) {
  return {
    fixtureKind: "hosted-smoke",
    generatedAt: "2026-04-30T12:00:00.000Z",
    rawArtifacts: [
      {
        content: input.content ?? Array.from({ length: input.recordCount }, (_, index) => ({
          calendar_date: `2026-04-${String(index + 1).padStart(2, "0")}`,
          date: `2026-04-${String(index + 1).padStart(2, "0")}`,
          resource: "activity",
          sourceProviderSlug: "garmin",
          steps: index + 1,
          ...(input.oversizedRecord ? { sampleMemo: "x".repeat(70_000) } : {}),
        })),
        relativePath: "hosted-smoke/garmin/01-junction-summary-activity.json",
      },
    ],
    redactionReport: {
      droppedKeys: 1,
      includedJsonFiles: 1,
      includedJsonlRecords: 0,
      pseudonymizedValues: 1,
      scannedFiles: 1,
      shiftedDates: 1,
    },
    schema: "murph.junction-wearables-sanitized-fixture.v1",
    sourceExportHash: "a".repeat(64),
    targets: [
      {
        id: "garmin",
        label: "Garmin",
        sourceProviderSlug: "garmin",
      },
    ],
  };
}
