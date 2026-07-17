import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("Silent Meditation Before Bed signal cards", () => {
  it("keeps the expected signal metadata aligned with the protocol page", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });
    const protocol = catalog.entities.find(
      (entity) =>
        entity.key ===
        "protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation",
    );

    expect(protocol?.expectedSignalDescriptions?.map((signal) => signal.biomarkerKey)).toEqual([
      "biomarker:sleep-onset-latency",
      "biomarker:sleep-efficiency",
      "biomarker:deep-sleep-minutes",
      "biomarker:hrv-rmssd",
      "biomarker:resting-heart-rate",
    ]);

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:sleep-onset-latency",
        expected: "May fall asleep sooner",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: -2,
          kind: "absolute",
          low: -8,
          unit: "minutes",
          window: "14 nights",
        }),
        protocolProminence: "focus",
      }),
    );

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:sleep-efficiency",
        expected: "Could improve slightly",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 2,
          kind: "absolute",
          low: 0,
          unit: "%",
          window: "14 nights",
        }),
        protocolProminence: "context",
      }),
    );

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:deep-sleep-minutes",
        expected: "Likely unchanged or slightly higher",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 5,
          kind: "absolute",
          low: 0,
          unit: "minutes",
          window: "14 nights",
        }),
        protocolProminence: "context",
      }),
    );

    expect(protocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:hrv-rmssd",
        expected: "Could rise modestly",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 5,
          kind: "relative_percent",
          low: 0,
          unit: "%",
          window: "14 nights",
        }),
        protocolProminence: "context",
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
          low: -2,
          unit: "bpm",
          window: "14 nights",
        }),
        protocolProminence: "context",
      }),
    );
  });
});
