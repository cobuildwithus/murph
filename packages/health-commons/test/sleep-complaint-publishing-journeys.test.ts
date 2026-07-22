import path from "node:path";
import { fileURLToPath } from "node:url";

import { experimentSessionMetricIsDeclared } from "@murphai/health-metrics";
import { beforeAll, describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "../src/catalog.ts";
import { buildHealthCommonsProtocolGeneratedArtifacts } from "../src/protocol-artifacts.ts";
import { buildHealthCommonsWebGeneratedArtifacts } from "../src/web-artifacts.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

async function buildPublishedSleepWorkflows() {
  const catalog = await buildHealthCommonsCatalog({ contentRoot });
  const web = buildHealthCommonsWebGeneratedArtifacts(catalog);
  const protocols = buildHealthCommonsProtocolGeneratedArtifacts({
    catalog,
    routeIndex: web.routeIndex,
  });

  return {
    catalog,
    protocols,
    web,
  };
}

describe("sleep complaint workflow publishing journeys", () => {
  let publishedSleepWorkflows: Awaited<ReturnType<typeof buildPublishedSleepWorkflows>>;

  beforeAll(async () => {
    publishedSleepWorkflows = await buildPublishedSleepWorkflows();
  });

  it.each([
    {
      key: "protocol_variant:bedtime-transition/standard-tiny-fallback-transition",
      optionalSignals: [
        "biomarker:sleep-onset-latency",
        "biomarker:daytime-sleepiness",
      ],
      primaryBiomarkerKey: "biomarker:bedtime-delay",
      safetyGateIds: ["dangerous_sleepiness", "external_schedule_constraint"],
      sessionFieldId: "bedtime_delay_minutes",
      sessionFieldIds: [
        "bedtime_delay_minutes",
        "sleep_opportunity_minutes",
        "estimated_sleep_onset_latency_minutes",
        "daytime_sleepiness",
        "adverse_effects",
      ],
      setupSlotIds: ["sleep_attempt_anchor", "transition_cue", "transition_versions"],
    },
    {
      key: "protocol_variant:cognitive-offload-before-bed/five-minute-tomorrow-list",
      optionalSignals: [
        "biomarker:sleep-onset-latency",
        "biomarker:daytime-sleepiness",
      ],
      primaryBiomarkerKey: "biomarker:pre-sleep-arousal",
      safetyGateIds: ["dangerous_sleepiness", "severe_writing_activation_risk"],
      sessionFieldId: "pre_sleep_arousal",
      sessionFieldIds: [
        "pre_sleep_arousal",
        "sleep_opportunity_minutes",
        "estimated_sleep_onset_latency_minutes",
        "daytime_sleepiness",
        "writing_burden",
      ],
      setupSlotIds: ["writing_window", "writing_tool"],
    },
  ])(
    "publishes $key as a bounded, measurable experiment rather than generic advice",
    ({
      key,
      optionalSignals,
      primaryBiomarkerKey,
      safetyGateIds,
      sessionFieldId,
      sessionFieldIds,
      setupSlotIds,
    }) => {
      const { catalog, protocols, web } = publishedSleepWorkflows;
      const entity = catalog.entities.find((candidate) => candidate.key === key);
      const runSpec = protocols.runSpecs.protocols.find(
        (candidate) => candidate.key === key,
      );
      const experimentCard = web.experimentIndex.experiments.find(
        (candidate) => candidate.key === key,
      );

      expect(entity).toBeDefined();
      expect(runSpec).toBeDefined();
      expect(experimentCard).toBeDefined();
      expect(runSpec?.revision.pageRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(runSpec?.revision.runSpecRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(runSpec?.testPlans).toEqual([
        expect.objectContaining({
          baselineDays: 14,
          interventionDays: 14,
          primaryBiomarkerKey,
        }),
      ]);
      expect(runSpec?.protocol?.sessionFieldIds).toEqual(sessionFieldIds);
      expect(experimentSessionMetricIsDeclared({
        biomarkerKey: primaryBiomarkerKey,
        sessionFields: runSpec?.protocol?.sessionFieldIds,
      })).toBe(true);
      expect(runSpec?.testPlans[0]?.secondaryBiomarkerKeys).toEqual(optionalSignals);
      expect(
        runSpec?.experimentOnboarding?.adaptationPolicy?.measurementPlan,
      ).toMatchObject({
        optionalSignals,
        requiredSignals: [primaryBiomarkerKey],
      });
      expect(
        runSpec?.experimentOnboarding?.trackingHints?.confounderFields,
      ).toBeUndefined();
      expect(runSpec?.protocol?.sessionFieldIds).toContain(sessionFieldId);
      expect((runSpec?.experimentOnboarding?.setupSlots ?? []).map((slot) => slot.id))
        .toEqual(expect.arrayContaining(setupSlotIds));
      expect(runSpec?.experimentOnboarding?.safetyScreen?.mustAsk.length)
        .toBeGreaterThan(0);
      expect(
        runSpec?.experimentOnboarding?.safetyScreen?.mustAsk.map((gate) => gate.id),
      ).toEqual(expect.arrayContaining(safetyGateIds));
      expect(runSpec?.safety?.stopIf?.length).toBeGreaterThan(0);
    },
  );

  it.each([
    {
      key: "experiment_family:sleep-baseline-observation",
      primaryBiomarkerKey: "biomarker:sleep-quality",
    },
    {
      key: "experiment_family:sleep-maintenance-tracking",
      primaryBiomarkerKey: "biomarker:wake-after-sleep-onset",
    },
  ])(
    "keeps $key as observation and triage instead of manufacturing an intervention run",
    ({ key, primaryBiomarkerKey }) => {
      const { catalog, protocols, web } = publishedSleepWorkflows;
      const entity = catalog.entities.find((candidate) => candidate.key === key);

      expect(entity).toMatchObject({
        entityType: "experiment_family",
        key,
      });
      expect(entity?.protocol).toBeUndefined();
      expect(entity?.testPlans).toBeUndefined();
      expect(entity?.relations).toContainEqual({
        target: primaryBiomarkerKey,
        type: "primary_biomarker",
      });
      expect(protocols.familyGraph.families.some((family) => family.key === key))
        .toBe(true);
      expect(protocols.runSpecs.protocols.some((protocol) => protocol.key === key))
        .toBe(false);
      expect(web.experimentIndex.experiments.some((experiment) => experiment.key === key))
        .toBe(false);
    },
  );
});
