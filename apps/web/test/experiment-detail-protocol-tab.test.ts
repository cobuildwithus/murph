import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsMeasurementMethodModality,
  type HealthCommonsMeasurementMethodTier,
} from "@murphai/contracts";
import { createHealthCommonsCatalogReader } from "@murphai/health-commons/runtime";

import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import { resolveHealthCommonsExperimentProtocolTab } from "@/src/lib/health-commons/experiment-projections";
import type { ExperimentResearchGroup } from "@/src/types/experiments";
import {
  createHealthCommonsRouteBundleFixtureCatalog,
} from "./health-commons-fixture-catalog";

vi.mock("@/src/components/experiments/experiment-detail/expected-signal-card", () => ({
  ExpectedSignalCard({ label }: { label: string }) {
    return createElement("div", { "data-card": label }, label);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/experiment-progress", () => ({
  ExperimentProgress({
    baselineLabel,
    overallPercent,
    protocolLabel,
  }: {
    baselineLabel: string;
    overallPercent: number;
    protocolLabel: string;
  }) {
    return createElement(
      "div",
      {
        "data-progress-baseline": baselineLabel,
        "data-progress-percent": String(overallPercent),
        "data-progress-protocol": protocolLabel,
      },
      `${baselineLabel} | ${protocolLabel} | ${overallPercent}`,
    );
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/expert-card", () => ({
  ExpertCard({ name }: { name: string }) {
    return createElement("div", null, name);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/study-card", () => ({
  StudyCard({ title }: { title: string }) {
    return createElement("div", null, title);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/safety-section", () => ({
  SafetySection() {
    return createElement("div", null, "safety");
  },
}));

import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";
import { ResearchTab } from "@/src/components/experiments/experiment-detail/research-tab";

describe("ProtocolTab", () => {
  it("renders the protocol layout without generic step labels or duplicated summary copy", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));
    const summaryParagraph = experiment.whyItWorks
      .split("\n\n")
      .find((block) => !block.trimStart().startsWith("#"))
      ?.trim();

    expect(markup).toContain("Run the protocol");
    expect(markup).toContain("Why it works");
    expect(markup).toContain("Schedule &amp; dose");
    expect(markup).toContain("7-day baseline then 14-day protocol");
    expect(markup).not.toContain("days to analysis");
    expect(markup).not.toContain("Total run");
    expect(markup).not.toContain("Protocol window");
    expect(markup).not.toContain("Before change");
    expect(markup).not.toContain("Step 1");
    expect(markup).not.toContain("STEP 1");

    expect(summaryParagraph).toBeTruthy();
    expect(countOccurrences(markup, summaryParagraph!)).toBe(1);
  });

  it("uses the page-authored Finnish focus signals and moves context signals into pills", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    const protocolTab = resolveHealthCommonsExperimentProtocolTab("finnish-sauna");

    expect(protocol).not.toBeNull();
    expect(protocolTab).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));
    const researchMarkup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(protocolTab!.expectedSignals.map((signal) => signal.expected)).toContain(
      "Small drop possible",
    );
    expect(protocolTab!.expectedSignals.map((signal) => signal.expected)).toContain(
      "Small change possible",
    );
    expect(protocolTab!.expectedSignals.map((signal) => signal.expected)).not.toContain(
      "mixed_or_contextual",
    );
    expect(protocolTab!.expectedSignals[0]?.label).toBe("Morning Blood Pressure");
    expect(protocolTab!.expectedSignals[1]?.label).toBe("Resting Heart Rate");
    expect(countOccurrences(markup, "data-card=")).toBe(2);
    expect(markup).toContain('data-card="Morning Blood Pressure"');
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup.indexOf('data-card="Morning Blood Pressure"')).toBeLessThan(
      markup.indexOf('data-card="Resting Heart Rate"'),
    );
    expect(markup).toContain("−5 to 0 mmHg");
    expect(markup).toContain("−3 to +1 bpm");
    expect(markup).toContain("Morning Blood Pressure projected −5 to 0 mmHg over 2-6 weeks");
    expect(markup).toContain("Resting Heart Rate projected −3 to +1 bpm over 2-6 weeks");
    expect(markup).not.toContain('data-card="HRV / RMSSD"');
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("2-6 weeks");
    expect(markup).toContain(
      '<span class="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">2-6 weeks</span>',
    );
    expect(markup).not.toContain('data-card="Sleep Efficiency"');
    expect(markup).not.toContain('data-card="Deep Sleep Minutes"');
    expect(markup).toContain("Morning Blood Pressure");
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("Sleep Efficiency");
    expect(markup).toContain("Deep Sleep");
    expect(markup).toContain("sauna 80–100 °C");
    expect(markup).toContain("23 min");
    expect(researchMarkup).toContain("Bottom line");
    expect(researchMarkup).toContain("Mixed");
    expect(researchMarkup).not.toContain("Evidence backbone and claim calibration");
    expect(markup).not.toContain("Read these top to bottom");
  });

  it("keeps the Bryan Johnson sauna hierarchy focused on tolerability and pressure signals", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(3);
    expect(markup).toContain('data-card="HRV / RMSSD"');
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).toContain('data-card="Morning Blood Pressure"');
    expect(markup).toContain("VO₂ Max");
    expect(markup).toContain("sauna 93 °C");
    expect(markup).toContain("after workout");
  });

  it("prioritizes aerobic adaptation signals for Norwegian 4x4 and leaves slower proxies in context", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));
    const researchMarkup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(3);
    expect(markup).toContain('data-card="VO₂ Max"');
    expect(markup).toContain("+3–10%");
    expect(markup).not.toContain("−5–10%");
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).toContain('data-card="Morning Blood Pressure"');
    expect(markup).toContain("4-minute rep is dose");
    expect(markup).toContain("4 × hard / easy");
    expect(markup).toContain("35 min");
    expect(markup).toContain("During each rep");
    expect(markup).toContain("High blood flow · shear stress · lactate turnover");
    expect(markup).not.toContain('data-card="HRV / RMSSD"');
    expect(markup).not.toContain('data-card="Sleep Efficiency"');
    expect(markup).toContain("Morning Blood Pressure");
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("Sleep Efficiency");
    expect(researchMarkup).toContain("Bottom line");
    expect(researchMarkup).toContain("best-supported claim");
    expect(researchMarkup).toContain("Moderate confidence");
    expect(researchMarkup).toContain("Exact or close 4x4 trials");
    expect(researchMarkup).toContain("Dose, target zone, and implementation");
    expect(researchMarkup).toContain("Broader HIIT and VO2max context");
    expect(researchMarkup).toContain("Clinical lineage and mixed superiority");
    expect(researchMarkup).toContain("Safety boundaries");
    expect(researchMarkup).toContain("Nearby protocols and recovery context");
    expect(researchMarkup).toContain("Read these top to bottom");
  });

  it("renders grouped research inside native details cards with source-mix summaries", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(countOccurrences(markup, "group overflow-hidden rounded-xl")).toBe(9);
    expect(countOccurrences(markup, 'open=""')).toBe(2);
    expect(markup).toContain("2 sources · 2 trials");
    expect(markup).toContain("3 sources · 1 physiology study · 1 trial · 1 guidance source");
    expect(markup).toContain("11 sources · 9 trials · 2 reviews");
    expect(markup).toContain("6 sources · 3 guidance sources · 2 reviews · 1 observational study");
  });

  it("shortens long Finnish research-group labels at display time only", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const baseExperiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const researchGroups: ExperimentResearchGroup[] = [
      {
        id: "near-term-autonomic-vascular-and-immune-signals",
        label: "Synthetic fallback label that should not drive the display mapping",
        stance: "mixed",
        summary: "Synthetic grouped-research proof for the UI-only label formatting pass.",
        defaultOpen: true,
        studies: [
          {
            type: "MECH",
            title: "Physiology study A",
            authors: "A Team",
            journal: "Example Journal",
          },
          {
            type: "MECH",
            title: "Physiology study B",
            authors: "A Team",
            journal: "Example Journal",
          },
          {
            type: "INT",
            title: "Intervention study",
            authors: "B Team",
            journal: "Example Journal",
          },
          {
            type: "REV",
            title: "Review study",
            authors: "C Team",
            journal: "Example Journal",
          },
        ],
      },
    ];
    const experiment = {
      ...baseExperiment,
      researchGroups,
    };
    const markup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(markup).toContain("Short-term signals to watch");
    expect(markup).not.toContain("Synthetic fallback label that should not drive the display mapping");
    expect(markup).toContain("4 sources · 2 physiology studies · 1 trial · 1 review");
    expect(countOccurrences(markup, 'open=""')).toBe(1);
  });

  it("uses the page-authored red-light-glasses focus signal and moves the noisier ones into context pills", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("red-light-glasses-before-bed");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(1);
    expect(markup).not.toContain('data-card="Sleep Efficiency"');
    expect(markup).toContain('data-card="Sleep Onset Latency"');
    expect(markup).not.toContain('data-card="Deep Sleep Minutes"');
    expect(markup).not.toContain('data-card="HRV / RMSSD"');
    expect(markup).not.toContain('data-card="Resting Heart Rate"');
    expect(markup).not.toContain("Primary marker");
    expect(markup).not.toContain("Sleep context");
    expect(markup).not.toContain("Exploratory signal");
    expect(markup).toContain("Deep Sleep");
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("Resting Heart Rate");
    expect(markup).toContain("Sleep Efficiency");
    expect(markup).toContain("Sleep Onset Latency");
    expect(markup).toContain("glasses on");
    expect(markup).toContain("−120 min");
  });

  it("keeps expected signals outcome-only while rendering measurement paths separately", () => {
    const catalog = createMeasurementPathFixtureCatalog();
    const reader = createHealthCommonsCatalogReader(catalog);
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna", reader);

    expect(protocol).not.toBeNull();
    expect(protocol?.expectedSignals.map((signal) => signal.label)).not.toEqual(
      expect.arrayContaining([
        "Home image analysis",
        "Clinic imaging",
      ]),
    );
    expect(
      protocol?.measurementPaths.map((path) => ({
        isDefault: path.isDefault,
        label: path.label,
        required: path.required,
      })),
    ).toEqual([
      {
        isDefault: true,
        label: "Home skin scoring",
        required: true,
      },
      {
        isDefault: false,
        label: "Home image analysis",
        required: false,
      },
      {
        isDefault: false,
        label: "Clinic imaging upgrade",
        required: false,
      },
    ]);

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("Measurement paths");
    expect(markup).toContain("How this can be measured");
    expect(markup).toContain("Photo privacy");
    expect(markup).toContain("Keep originals local and private");
    expect(markup.indexOf("Home skin scoring")).toBeLessThan(
      markup.indexOf("Home image analysis"),
    );
    expect(markup).toContain("/measurement-methods/home-image-analysis");
    expect(markup).toContain("/measurement-methods/clinic-imaging");
    expect(countOccurrences(markup, ">Optional</span>")).toBe(2);
    expect(countOccurrences(markup, "data-card=")).toBe(2);
  });

});

function createMeasurementPathFixtureCatalog(): HealthCommonsCatalog {
  const catalog = createHealthCommonsRouteBundleFixtureCatalog();
  const protocolIndex = catalog.entities.findIndex(
    (entity) => entity.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  const protocol = catalog.entities[protocolIndex];
  const template = catalog.entities.find(
    (entity) => entity.key === "biomarker:resting-heart-rate",
  );

  if (protocolIndex < 0 || !protocol || protocol.entityType !== "protocol_variant") {
    throw new Error("Expected the Finnish sauna protocol fixture.");
  }

  if (!template) {
    throw new Error("Expected a measurement-method template entity.");
  }

  catalog.entities.push(
    createMeasurementMethodEntity(template, {
      key: "measurement_method:home-skin-score",
      modalities: ["self_rating"],
      routeId: "home-skin-score",
      shortName: "Home skin score",
      tier: "default_home",
      title: "Home Skin Score",
    }),
    createMeasurementMethodEntity(template, {
      key: "measurement_method:home-image-analysis",
      modalities: ["standardized_photo", "image_analysis"],
      routeId: "home-image-analysis",
      shortName: "Home image analysis",
      tier: "optional_home",
      title: "Home Image Analysis",
    }),
    createMeasurementMethodEntity(template, {
      key: "measurement_method:clinic-imaging",
      modalities: ["instrumented_imaging"],
      routeId: "clinic-imaging",
      shortName: "Clinic imaging",
      tier: "clinic",
      title: "Clinic Imaging",
    }),
  );

  catalog.entities[protocolIndex] = {
    ...protocol,
    measurementPlan: {
      defaultPathId: "home-score",
      paths: [
        {
          label: "Home image analysis",
          methodKeys: ["measurement_method:home-image-analysis"],
          notes: ["Optional image analysis only counts if the same lighting setup is reused."],
          outcomeKeys: ["biomarker:skin-texture-roughness-score"],
          pathId: "home-image-analysis",
          required: false,
          tier: "optional_home",
        },
        {
          label: "Clinic imaging upgrade",
          methodKeys: ["measurement_method:clinic-imaging"],
          notes: ["Use this when clinic access is already practical."],
          outcomeKeys: [
            "biomarker:standardized-skin-photo-score",
            "biomarker:periocular-wrinkle-score",
            "biomarker:skin-texture-roughness-score",
          ],
          pathId: "clinic-imaging-upgrade",
          required: false,
          tier: "clinic",
        },
        {
          label: "Home skin scoring",
          methodKeys: ["measurement_method:home-skin-score"],
          notes: ["Use the same scoring prompt at baseline and follow-up."],
          outcomeKeys: ["biomarker:standardized-skin-photo-score"],
          pathId: "home-score",
          required: true,
          tier: "default_home",
        },
      ],
      schemaVersion: "murph.commons.measurement-plan.v1",
    },
  };

  return catalog;
}

function createMeasurementMethodEntity(
  template: HealthCommonsCatalogEntity,
  input: {
    key: string;
    modalities: HealthCommonsMeasurementMethodModality[];
    routeId: string;
    shortName: string;
    tier: HealthCommonsMeasurementMethodTier;
    title: string;
  },
): HealthCommonsCatalogEntity {
  const hasImageModality = input.modalities.some((modality) =>
    ["standardized_photo", "calibrated_photo", "image_analysis", "instrumented_imaging"].includes(
      modality,
    )
  );

  return {
    ...template,
    aliases: [input.shortName],
    biomarker: undefined,
    categories: ["measurement", "skin"],
    communityOutcomeSummary: undefined,
    entityType: "measurement_method",
    interpretationFrame: undefined,
    key: input.key,
    measurementContexts: undefined,
    measurementMethod: {
      burden: {
        costTier: input.tier === "clinic" ? "clinic" : "free",
        userBurden: input.tier === "clinic" ? "moderate" : "low",
      },
      interpretation: {
        caveat: "Use this as a personal trend proxy, not a diagnosis.",
        principle: "Compare the same method against itself.",
      },
      modalities: input.modalities,
      outputs: [
        {
          label: `${input.shortName} score`,
          outputId: "score",
          valueType: "score",
        },
      ],
      procedure: {
        materials: ["Same camera or appointment type"],
        schedule: ["Baseline and follow-up"],
        steps: ["Capture the same region under the same conditions."],
        summary: `Repeatable ${input.shortName.toLowerCase()} measurement.`,
      },
      ...(hasImageModality
        ? {
            privacy: {
              containsIdentifiableImages: true,
              localOnlyRecommended: true,
              notes: ["Use private storage for identifiable fixture photos."],
            },
          }
        : {}),
      shortName: input.shortName,
      tier: input.tier,
    },
    slug: `measurement-methods/${input.routeId}`,
    summary: `${input.title} is a reusable measurement method fixture.`,
    title: input.title,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
