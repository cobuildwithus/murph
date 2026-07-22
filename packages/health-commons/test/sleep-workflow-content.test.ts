import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  resolveExperimentSessionMetricSpec,
  resolveExperimentSessionMetricSpecForBiomarker,
  resolveMetricDefinitionForBiomarker,
} from "@murphai/health-metrics";

import { buildHealthCommonsCatalog } from "../src/catalog.ts";
import { isRunnableProtocolStatus } from "../src/protocol-publishing.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("sleep workflow content", () => {
  let catalog: Awaited<ReturnType<typeof buildHealthCommonsCatalog>>;

  beforeAll(async () => {
    catalog = await buildHealthCommonsCatalog({ contentRoot });
  });

  it("keeps observation workflows non-runnable and gives runnable workflows capturable outcomes", () => {
    const entities = new Map(catalog.entities.map((entity) => [entity.key, entity]));

    for (const key of [
      "experiment_family:sleep-baseline-observation",
      "experiment_family:sleep-maintenance-tracking",
    ]) {
      const workflow = entities.get(key);

      expect(workflow).toMatchObject({
        entityType: "experiment_family",
        status: "field-testing",
      });
      expect(workflow?.protocol).toBeUndefined();
      expect(workflow?.testPlans).toBeUndefined();
    }

    expect(entities.get("biomarker:wake-after-sleep-onset")).toMatchObject({
      biomarker: {
        privateMetricBindings: [
          {
            metricKey: "wake-after-sleep-onset",
            role: "primary",
            source: "metric",
            unit: "minutes",
          },
        ],
      },
      entityType: "biomarker",
      status: "field-testing",
    });

    expect(entities.get("biomarker:bedtime-delay")).toMatchObject({
      biomarker: {
        privateMetricBindings: [
          {
            metricKey: "bedtime-delay",
            role: "primary",
            source: "metric",
            unit: "minutes",
          },
        ],
      },
      entityType: "biomarker",
      status: "field-testing",
    });

    const bedtimeTransition = entities.get(
      "protocol_variant:bedtime-transition/standard-tiny-fallback-transition",
    );
    expect(bedtimeTransition).toMatchObject({
      entityType: "protocol_variant",
      status: "field-testing",
      testPlans: [
        {
          baselineDays: 14,
          durationDays: 28,
          interventionDays: 14,
          planId: "bedtime-transition-21d",
          primaryBiomarkerKey: "biomarker:bedtime-delay",
        },
      ],
    });
    expect(bedtimeTransition?.protocol?.sessionFieldIds).toEqual([
      "bedtime_delay_minutes",
      "sleep_opportunity_minutes",
      "estimated_sleep_onset_latency_minutes",
      "daytime_sleepiness",
      "adverse_effects",
    ]);
    expect(bedtimeTransition?.protocol?.logFields).toEqual([
      "bedtime delay in minutes, recorded as 0 when on time or earlier",
      "sleep opportunity in minutes from the actual sleep attempt to final rise",
      "estimated sleep-onset latency in minutes",
      "daytime sleepiness 0-10 (0 = fully alert, 10 = struggling to stay awake; higher is worse)",
      "burden, anxiety, or adverse effect 0-10 (0 = none, 10 = severe or stop-worthy)",
    ]);
    expect(bedtimeTransition?.testPlans?.[0]?.secondaryBiomarkerKeys).toEqual([
      "biomarker:sleep-onset-latency",
      "biomarker:daytime-sleepiness",
    ]);
    expect(
      bedtimeTransition?.experimentOnboarding?.adaptationPolicy?.measurementPlan,
    ).toMatchObject({
      optionalSignals: [
        "biomarker:sleep-onset-latency",
        "biomarker:daytime-sleepiness",
      ],
      requiredSignals: ["biomarker:bedtime-delay"],
    });
    expect(
      bedtimeTransition?.experimentOnboarding?.trackingHints?.confounderFields,
    ).toBeUndefined();
    expect(bedtimeTransition?.safety?.stopIf?.length).toBeGreaterThan(0);
    expect(bedtimeTransition?.body).toContain("## Decision at the end");
    expect(
      bedtimeTransition?.experimentOnboarding?.safetyScreen?.mustAsk.map((question) => question.id),
    ).toEqual(["dangerous_sleepiness", "external_schedule_constraint"]);

    const cognitiveOffload = entities.get(
      "protocol_variant:cognitive-offload-before-bed/five-minute-tomorrow-list",
    );
    expect(cognitiveOffload).toMatchObject({
      entityType: "protocol_variant",
      status: "field-testing",
      testPlans: [
        {
          baselineDays: 14,
          durationDays: 28,
          interventionDays: 14,
          planId: "tomorrow-list-21d",
          primaryBiomarkerKey: "biomarker:pre-sleep-arousal",
        },
      ],
    });
    expect(cognitiveOffload?.protocol?.sessionFieldIds).toEqual([
      "pre_sleep_arousal",
      "sleep_opportunity_minutes",
      "estimated_sleep_onset_latency_minutes",
      "daytime_sleepiness",
      "writing_burden",
    ]);
    expect(cognitiveOffload?.protocol?.logFields).toEqual([
      "pre-sleep arousal or wiredness 0-10",
      "sleep opportunity in minutes from the actual sleep attempt to final rise",
      "estimated sleep-onset latency in minutes",
      "daytime sleepiness 0-10 (0 = fully alert, 10 = struggling to stay awake; higher is worse)",
      "writing burden or activation 0-10 (0 = none, 10 = severe or stop-worthy)",
    ]);
    expect(cognitiveOffload?.testPlans?.[0]?.secondaryBiomarkerKeys).toEqual([
      "biomarker:sleep-onset-latency",
      "biomarker:daytime-sleepiness",
    ]);
    expect(
      cognitiveOffload?.experimentOnboarding?.adaptationPolicy?.measurementPlan,
    ).toMatchObject({
      optionalSignals: [
        "biomarker:sleep-onset-latency",
        "biomarker:daytime-sleepiness",
      ],
      requiredSignals: ["biomarker:pre-sleep-arousal"],
    });
    expect(
      cognitiveOffload?.experimentOnboarding?.trackingHints?.confounderFields,
    ).toBeUndefined();
    expect(cognitiveOffload?.safety?.stopIf?.length).toBeGreaterThan(0);
    expect(cognitiveOffload?.body).toContain("## Decision at the end");
    expect(
      cognitiveOffload?.experimentOnboarding?.safetyScreen?.mustAsk.map((question) => question.id),
    ).toEqual(["dangerous_sleepiness", "severe_writing_activation_risk"]);
    expect(
      cognitiveOffload?.experimentOnboarding?.safetyScreen?.dispositionIfAnyPositive,
    ).toBe("do_not_start_unsupervised");
    expect(
      cognitiveOffload?.experimentOnboarding?.safetyScreen?.mustAsk.find(
        (question) => question.id === "severe_writing_activation_risk",
      )?.ifPositive,
    ).toBe("do_not_start_unsupervised");

    const morningLight = entities.get(
      "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure",
    );
    expect(morningLight?.protocol?.sessionFieldIds).toContain("subjective_sleep_quality");
    expect(morningLight?.protocol?.logFields).toContain(
      "subjective sleep quality 0-10 (0 = worst possible, 10 = best possible; higher is better)",
    );

    for (const [biomarkerKey, sessionFieldId] of [
      ["biomarker:bedtime-delay", "bedtime_delay_minutes"],
      ["biomarker:sleep-onset-latency", "estimated_sleep_onset_latency_minutes"],
      ["biomarker:sleep-quality", "subjective_sleep_quality"],
      ["biomarker:daytime-sleepiness", "daytime_sleepiness"],
      ["biomarker:pre-sleep-arousal", "pre_sleep_arousal"],
      ["biomarker:wake-after-sleep-onset", "wake_after_sleep_onset_minutes"],
    ] as const) {
      const biomarker = entities.get(biomarkerKey);
      const metric = resolveMetricDefinitionForBiomarker(biomarkerKey);

      expect(metric, `${biomarkerKey} must resolve to a canonical metric`).not.toBeNull();
      expect(biomarker?.biomarker?.unit).toBe(metric?.canonicalUnit);
      expect(resolveExperimentSessionMetricSpec(sessionFieldId)?.biomarkerKey).toBe(biomarkerKey);
    }

  });

  it("requires exactly one recognized primary-outcome field for every runnable typed protocol", () => {
    const capturabilityMismatches: string[] = [];
    for (const protocol of catalog.entities) {
      if (
        protocol.entityType !== "protocol_variant" ||
        protocol.hidden === true ||
        !isRunnableProtocolStatus(protocol.status)
      ) {
        continue;
      }

      for (const plan of protocol.testPlans ?? []) {
        const primaryMetric = resolveExperimentSessionMetricSpecForBiomarker(
          plan.primaryBiomarkerKey,
        );
        if (!primaryMetric) {
          continue;
        }

        const matchingFields = (protocol.protocol?.sessionFieldIds ?? []).filter(
          (fieldId) => resolveExperimentSessionMetricSpec(fieldId)?.key === primaryMetric.key,
        );
        if (matchingFields.length !== 1) {
          capturabilityMismatches.push(
            `${protocol.key} ${plan.planId} ${plan.primaryBiomarkerKey}: ${matchingFields.join(", ") || "none"}`,
          );
        }
      }
    }
    expect(capturabilityMismatches).toEqual([]);
  });
});
