import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("Tabata 20/10 signal cards", () => {
  it("keeps the expected signal metadata aligned with the protocol page", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });
    const protocol = catalog.entities.find(
      (entity) =>
        entity.key === "protocol_variant:tabata-interval-training/tabata-20-10-interval-training",
    );

    expect(protocol?.expectedSignalDescriptions?.map((signal) => signal.biomarkerKey)).toEqual([
      "biomarker:estimated-vo2max",
      "biomarker:resting-heart-rate",
      "biomarker:hrv-rmssd",
      "biomarker:sleep-efficiency",
      "biomarker:morning-blood-pressure",
    ]);

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:estimated-vo2max",
        expected: "Could improve",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 3,
          kind: "absolute",
          low: 1,
          unit: "mL/kg/min",
          window: "6 weeks",
        }),
        protocolProminence: "focus",
      }),
    );

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:resting-heart-rate",
        expected: "Could trend lower",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 0,
          kind: "absolute",
          low: -3,
          unit: "bpm",
          window: "6 weeks",
        }),
        protocolProminence: "focus",
      }),
    );

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:hrv-rmssd",
        expected: "Possible change",
        estimatedChange: expect.objectContaining({
          confidence: "mixed",
          high: 15,
          kind: "relative_percent",
          low: -10,
          unit: "%",
          window: "6 weeks",
        }),
        protocolProminence: "context",
      }),
    );

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:sleep-efficiency",
        expected: "Possible change",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 2,
          kind: "absolute",
          low: -2,
          unit: "%",
          window: "6 weeks",
        }),
        protocolProminence: "context",
      }),
    );

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:morning-blood-pressure",
        expected: "Could trend lower",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 0,
          kind: "absolute",
          low: -4,
          unit: "mmHg SBP",
          window: "6 weeks",
        }),
        protocolProminence: "context",
      }),
    );
  });
});
