import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildJunctionWearableHostedReplayPlan,
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
});

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
