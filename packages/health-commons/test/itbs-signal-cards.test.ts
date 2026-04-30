import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("ITBS signal cards", () => {
  it("keeps the catalog focused on lateral-knee pain and running tolerance", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });
    const itbsProtocol = catalog.entities.find(
      (entity) =>
        entity.key ===
        "protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run",
    );

    expect(itbsProtocol?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "parent_family",
          target: "experiment_family:iliotibial-band-syndrome-rehabilitation",
        }),
      ]),
    );
    expect(
      itbsProtocol?.relations
        ?.filter((relation) =>
          relation.type === "primary_biomarker" || relation.type === "secondary_biomarker"
        )
        .map((relation) => relation.target),
    ).toEqual([
      "biomarker:lateral-knee-pain",
      "biomarker:running-tolerance",
    ]);
    expect(itbsProtocol?.testPlans).toEqual([
      expect.objectContaining({
        primaryBiomarkerKey: "biomarker:lateral-knee-pain",
        secondaryBiomarkerKeys: ["biomarker:running-tolerance"],
        minimumAdherenceSessions: 12,
        targetAdherenceSessions: 18,
        notes: expect.arrayContaining([
          expect.stringContaining("Running load is both the exposure and a confounder"),
          expect.stringContaining("Rehab completion and running exposure support interpretation"),
        ]),
      }),
    ]);

    expect(itbsProtocol?.expectedSignalDescriptions?.map((signal) => signal.biomarkerKey)).toEqual([
      "biomarker:lateral-knee-pain",
      "biomarker:running-tolerance",
    ]);
    expect(itbsProtocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:lateral-knee-pain",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: -1,
          kind: "absolute",
          low: -4,
          unit: "points",
        }),
        protocolProminence: "focus",
      }),
    );
    expect(itbsProtocol?.expectedSignalDescriptions).toContainEqual(
      expect.objectContaining({
        biomarkerKey: "biomarker:running-tolerance",
        estimatedChange: expect.objectContaining({
          confidence: "low",
          high: 45,
          kind: "absolute",
          low: 10,
          unit: "minutes",
        }),
        protocolProminence: "focus",
      }),
    );
    expect(
      itbsProtocol?.expectedSignalDescriptions?.some((signal) =>
        signal.biomarkerKey === "biomarker:training-volume" ||
        signal.biomarkerKey === "biomarker:adherence",
      ),
    ).toBe(false);
  });
});
