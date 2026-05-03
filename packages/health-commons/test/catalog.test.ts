import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { experimentRunScheduleIntentSchema } from "@murphai/contracts";
import { buildHealthCommonsCatalog } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("health commons catalog", () => {
  it("builds a deterministic catalog with protocol revisions and artifact manifests", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });

    expect(catalog.schemaVersion).toBe("murph.commons.catalog.v1");
    expect(catalog.catalogHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(catalog.entities.map((entity) => entity.key)).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    const saunaProtocol = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(saunaProtocol).toMatchObject({
      experimentOnboarding: {
        adaptationPolicy: {
          measurementPlan: {
            requiredSignals: ["biomarker:resting-heart-rate"],
            testPlanId: "rhr-21d",
          },
          reusableSetup: {
            enabled: true,
          },
        },
        assistantPolicy: {
          missedLogFollowup: "opt_in_only",
        },
        planDefaults: {
          sessionsPerWeek: 3,
          testPlanId: "rhr-21d",
        },
        startIntent: {
          intentSummary: "Explore Finnish Dry Sauna",
        },
      },
    });
    expect(
      saunaProtocol?.experimentOnboarding?.setupSlots?.find((slot) => slot.id === "sauna_access"),
    ).toMatchObject({
      id: "sauna_access",
      target: {
        object: "experimentRun",
        field: "saunaAccess",
      },
    });
    expect(
      saunaProtocol?.experimentOnboarding?.setupSlots?.find((slot) => slot.id === "session_timing"),
    ).toMatchObject({
      constraints: {
        defaultRunPlanSchedule: {
          kind: "cron",
          expression: "0 18 * * 2,4,6",
          timeZone: "UTC",
        },
        runPlanScheduleTimeZonePolicy: "replace_with_user_vault_timezone",
      },
      target: {
        object: "onboardingCapture",
        field: "answers.sessionTiming",
      },
    });
    for (const protocol of catalog.entities.filter((entity) => entity.experimentOnboarding)) {
      for (const slot of protocol.experimentOnboarding?.setupSlots ?? []) {
        expect(
          slot.target?.object === "experimentRun" &&
            (slot.target.field === "schedule" || slot.target.field.startsWith("schedule.")),
          `${protocol.key} setup slot ${slot.id} must not target legacy experimentRun.schedule fields`,
        ).toBe(false);
        const constraints = readRecord(slot.constraints);
        if (constraints?.defaultRunPlanSchedule !== undefined) {
          expect(
            experimentRunScheduleIntentSchema.safeParse(constraints.defaultRunPlanSchedule).success,
            `${protocol.key} setup slot ${slot.id} defaultRunPlanSchedule must be structured`,
          ).toBe(true);
          expect(
            constraints.runPlanScheduleTimeZonePolicy,
            `${protocol.key} setup slot ${slot.id} must declare the run-plan schedule timezone policy`,
          ).toBe("replace_with_user_vault_timezone");
        }
      }
    }
    expect(saunaProtocol?.revision.pageRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(saunaProtocol?.revision.runSpecRevisionId).toBe(
      "sha256:9e0132d352b6e4020386bf2110962364a43e781675b40597fa0325faf997a725",
    );
    expect(saunaProtocol?.revision.recipeHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const protocolRelationTargets = saunaProtocol?.relations?.map((relation) => relation.target) ?? [];
    expect(protocolRelationTargets).toContain(
      "experiment_family:dry-sauna",
    );
    const protocolClaimSources = saunaProtocol?.claims?.flatMap((claim) => claim.sourceKeys ?? []) ?? [];
    const catalogEntityKeys = new Set(catalog.entities.map((entity) => entity.key));
    for (const sourceKey of protocolClaimSources) {
      expect(catalogEntityKeys).toContain(sourceKey);
    }

    expect(catalog.entities.map((entity) => entity.key)).toContain("experiment_family:infrared-sauna");

    const redLightProtocol = catalog.entities.find(
      (entity) =>
        entity.key ===
        "protocol_variant:evening-light-reduction/red-light-glasses-before-bed",
    );
    expect(redLightProtocol).toMatchObject({
      experimentOnboarding: {
        planDefaults: {
          testPlanId: "sol-wiredness-21d",
        },
        startIntent: {
          intentSummary: "Explore Red Light Glasses Before Bed",
        },
      },
      revision: {
        runSpecRevisionId:
          "sha256:1f902f00d475295694579ca3df51ecb698ddd79c0a1de6af4444bac945037bf4",
      },
    });
    expect(redLightProtocol?.expectedSignalDescriptions?.map((signal) => signal.biomarkerKey)).toEqual(expect.arrayContaining([
      "biomarker:sleep-onset-latency",
      "biomarker:sleep-efficiency",
      "biomarker:resting-heart-rate",
      "biomarker:hrv-rmssd",
      "biomarker:deep-sleep-minutes",
    ]));
    expect(redLightProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:sleep-onset-latency",
      estimatedChange: expect.objectContaining({
        confidence: "mixed",
        high: 0,
        kind: "absolute",
        low: -10,
        unit: "min",
      }),
      protocolProminence: "focus",
    }));
    expect(redLightProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:sleep-efficiency",
      estimatedChange: expect.objectContaining({
        confidence: "mixed",
        high: 2,
        kind: "absolute",
        low: -1,
        unit: "%",
      }),
    }));
    expect(redLightProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:resting-heart-rate",
      estimatedChange: expect.objectContaining({
        confidence: "low",
        high: 0,
        kind: "absolute",
        low: -2,
        unit: "bpm",
      }),
    }));
    expect(redLightProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:hrv-rmssd",
      estimatedChange: expect.objectContaining({
        confidence: "low",
        high: 5,
        kind: "relative_percent",
        low: 0,
        unit: "%",
      }),
    }));
    expect(redLightProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:deep-sleep-minutes",
      estimatedChange: expect.objectContaining({
        confidence: "low",
        kind: "mixed_or_contextual",
      }),
    }));

    const psylliumProtocol = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol",
    );
    expect(psylliumProtocol?.expectedSignalDescriptions?.map((signal) => signal.biomarkerKey)).toEqual([
      "biomarker:ldl-c",
      "biomarker:non-hdl-c",
      "biomarker:apolipoprotein-b",
      "biomarker:total-cholesterol",
      "biomarker:triglycerides",
      "biomarker:hdl-c",
    ]);
    expect(psylliumProtocol?.expectedSignalDescriptions?.map((signal) => signal.protocolProminence)).toEqual([
      "focus",
      "focus",
      "focus",
      "focus",
      "context",
      "context",
    ]);
    expect(psylliumProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:ldl-c",
      expected: "Could trend lower",
      estimatedChange: expect.objectContaining({
        basis: expect.any(String),
        confidence: "moderate",
        high: -8,
        kind: "absolute",
        low: -13,
        unit: "mg/dL",
      }),
      protocolProminence: "focus",
    }));
    expect(psylliumProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:non-hdl-c",
      expected: "Could trend lower",
      estimatedChange: expect.objectContaining({
        basis: expect.any(String),
        confidence: "moderate",
        kind: "absolute",
        low: -15,
        high: -10,
        unit: "mg/dL",
      }),
      protocolProminence: "focus",
    }));
    expect(psylliumProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:apolipoprotein-b",
      expected: "Could trend lower",
      estimatedChange: expect.objectContaining({
        basis: expect.any(String),
        confidence: "moderate",
        kind: "absolute",
        low: -8,
        high: -3,
        unit: "mg/dL",
      }),
      protocolProminence: "focus",
    }));
    expect(psylliumProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:total-cholesterol",
      expected: "Could trend lower",
      estimatedChange: expect.objectContaining({
        basis: expect.any(String),
        confidence: "moderate",
        kind: "absolute",
        low: -15,
        high: -9,
        unit: "mg/dL",
      }),
      protocolProminence: "focus",
    }));
    expect(psylliumProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:triglycerides",
      expected: "Small/no reliable change",
      estimatedChange: expect.objectContaining({
        basis: expect.any(String),
        confidence: "mixed",
        kind: "absolute",
        low: -12,
        high: 2,
        unit: "mg/dL",
      }),
      protocolProminence: "context",
    }));
    expect(psylliumProtocol?.expectedSignalDescriptions).toContainEqual(expect.objectContaining({
      biomarkerKey: "biomarker:hdl-c",
      expected: "Usually stable",
      estimatedChange: expect.objectContaining({
        basis: expect.any(String),
        confidence: "mixed",
        kind: "absolute",
        low: -1,
        high: 2,
        unit: "mg/dL",
      }),
      protocolProminence: "context",
    }));

    expect(catalog.redirects).toContainEqual(
      expect.objectContaining({
        from: "experiment_family:sauna/finnish-dry",
        to: "experiment_family:dry-sauna",
      }),
    );

    expect(catalog.redirects).toContainEqual(
      expect.objectContaining({
        from: "protocol_variant:sauna/finnish-dry/murph-standard-3x-week",
        to: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      }),
    );

    expect(catalog.redirects).toContainEqual(
      expect.objectContaining({
        from: "protocol_variant:sauna/finnish-dry/bryan-johnson-blueprint",
        to: "protocol_variant:dry-sauna/bryan-johnson-blueprint",
      }),
    );

    const artifacts = catalog.artifactManifests.flatMap((manifest) => manifest.artifacts);
    expect(artifacts.find((artifact) => artifact.artifactId === "art_pmid_25705824_pdf")).toMatchObject({
      storage: "cloudflare-r2",
      redistributable: false,
      rightsStatus: "permission_required",
      objectKey: "commons/research/sauna/pmid-25705824/source.pdf",
      localPath: "research-artifacts/sauna/pmid-25705824.pdf",
    });
  });
});

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
