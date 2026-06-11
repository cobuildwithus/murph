import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  createHealthCommonsCatalogReader,
} from "@murphai/health-commons/runtime";
import {
  listHealthCommonsExperimentBrowseProtocols,
  listHealthCommonsExperimentRouteParams as listHealthCommonsExperimentBrowseRouteParams,
} from "@/src/lib/health-commons/experiment-browse";
import {
  listHealthCommonsBiomarkerRoutes,
  resolveHealthCommonsBiomarkerDetail,
} from "@/src/lib/health-commons/biomarker-detail";
import {
  listHealthCommonsExperimentRouteParams,
  listHealthCommonsExperimentProtocols,
  resolveHealthCommonsExperimentProtocol,
} from "@/src/lib/health-commons/experiment-detail";
import {
  resolveHealthCommonsExperimentProtocolTab,
  resolveHealthCommonsExperimentResearchTab,
  resolveHealthCommonsExperimentResultsPublic,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";
import {
  getGeneratedExperimentIndex,
  loadGeneratedExperimentProjection,
} from "@/src/lib/health-commons/generated-experiment-artifacts";
import {
  createHealthCommonsRouteBundleFixtureCatalog,
} from "./health-commons-fixture-catalog";

const SUPPLEMENT_PROTOCOL_FIXTURES = [
  {
    key: "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides",
    routeId: "hydrolyzed-collagen-peptides",
  },
  {
    key: "protocol_variant:creatine-supplementation/creatine-monohydrate",
    routeId: "creatine-monohydrate",
  },
  {
    key: "protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation",
    routeId: "oral-epa-dha-supplementation",
  },
  {
    key: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol",
    routeId: "psyllium-husk-for-cholesterol",
  },
  {
    key: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol",
    routeId: "red-yeast-rice-for-cholesterol",
  },
  {
    key: "protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation",
    routeId: "daily-vitamin-d3-supplementation",
  },
] as const;

const PUBLIC_SOURCE_KEY_RESIDUE_PATTERN =
  /source_artifact:|\b(?:source|citation)\s+keys?\b|`{2,}/iu;

describe("Health Commons experiment protocol metadata", () => {
  it("keeps public experiment resolution on generated route bundles, not the monolithic catalog import", () => {
    const source = readFileSync(
      new URL("../src/lib/health-commons/experiment-detail.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("generated/catalog.json");
    expect(source).not.toContain("./catalog");

    const routeParams = listHealthCommonsExperimentRouteParams();
    expect(routeParams).toContainEqual({ experimentId: "finnish-sauna" });

    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    expect(protocol?.commons?.routeId).toBe("finnish-sauna");
    expect(protocol?.studies.length).toBeGreaterThan(0);
  });

  it("uses the generated browse index directly for the public experiment library list", () => {
    const source = readFileSync(
      new URL("../src/lib/health-commons/experiment-detail.ts", import.meta.url),
      "utf8",
    );
    const listStart = source.indexOf("export function listHealthCommonsExperimentProtocols(");
    const resolveStart = source.indexOf("export function resolveHealthCommonsExperimentProtocol(");
    const listBlock = source.slice(listStart, resolveStart);

    expect(listBlock).toContain("getGeneratedHealthCommonsWebExperimentIndex()");
    expect(listBlock).not.toContain("loadGeneratedHealthCommonsWebRouteBundle");

    const protocols = listHealthCommonsExperimentProtocols();
    const protocolIds = protocols.map((protocol) => protocol.id);

    expect(protocolIds).toContain("finnish-sauna");
    expect(protocolIds).toContain("bryan-johnson-blueprint");
    expect(protocolIds).not.toContain("creatine-monohydrate");
    expect(protocolIds).not.toContain("daily-vitamin-d3-supplementation");
  });

  it("uses the simplified protocol title", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.title).toBe("Bryan Johnson Sauna");
  });

  it("uses the dedicated Bryan Johnson sauna artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-bryan-johnson-sauna.jpg");
  });

  it("uses the dedicated Finnish sauna artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-finnish-sauna.jpeg");
  });

  it("uses the dedicated Norwegian 4x4 artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-norwegian-4x4.jpeg");
  });

  it("uses the dedicated red-light glasses artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("red-light-glasses-before-bed");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-red-light-glasses-before-bed.jpeg");
  });

  it("projects protocol session shapes from Health Commons content", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");
    const protocolTab = resolveHealthCommonsExperimentProtocolTab("norwegian-4x4");

    expect(protocol?.sessionShape?.summarySegments?.map((segment) => segment.label)).toEqual([
      "warm-up",
      "4 × hard / easy",
      "cool-down",
    ]);
    expect(protocol?.sessionShape?.ticks).toEqual([
      { label: "0", offsetMinutes: 0 },
      { label: "10 min", offsetMinutes: 10 },
      { label: "35 min", offsetMinutes: 35 },
      { label: "40 min", offsetMinutes: 40 },
    ]);
    expect(protocolTab?.sessionShape).toEqual(protocol?.sessionShape);
  });

  it("projects requested concrete protocol windows from session-shape content", () => {
    const expectedShapes = [
      {
        labels: ["easy cardio"],
        routeId: "zone-2-aerobic-base-block",
        ticks: [
          { label: "0", offsetMinutes: 0 },
          { label: "35 min minimum", offsetMinutes: 35 },
          { label: "60 min", offsetMinutes: 60 },
        ],
      },
      {
        labels: ["entry", "cold exposure", "gentle rewarm"],
        routeId: "cold-plunge",
        ticks: [
          { label: "0", offsetMinutes: 0 },
          { label: "entry", offsetMinutes: 1 },
          { label: "1-3 min in water", offsetMinutes: 4 },
          { label: "rewarm", offsetMinutes: 5 },
        ],
      },
      {
        labels: ["outdoor light"],
        routeId: "morning-outdoor-light-exposure",
        ticks: [
          { label: "0", offsetMinutes: 0 },
          { label: "10 min minimum", offsetMinutes: 10 },
          { label: "30 min", offsetMinutes: 30 },
        ],
      },
      {
        labels: ["post-meal walk"],
        routeId: "walking-after-every-meal",
        ticks: [
          { label: "0", offsetMinutes: 0 },
          { label: "10 min minimum", offsetMinutes: 10 },
          { label: "15 min", offsetMinutes: 15 },
        ],
      },
      {
        labels: ["chamber session"],
        routeId: "hyperbaric-oxygen-therapy",
        ticks: [
          { label: "0", offsetMinutes: 0 },
          { label: "60 min minimum", offsetMinutes: 60 },
          { label: "90 min", offsetMinutes: 90 },
        ],
      },
      {
        labels: ["red/NIR exposure"],
        routeId: "whole-body-red-and-near-infrared-light-exposure",
        ticks: [
          { label: "0", offsetMinutes: 0 },
          { label: "12 min minimum", offsetMinutes: 12 },
          { label: "20 min", offsetMinutes: 20 },
        ],
      },
      {
        labels: ["fasting window", "first refeed"],
        routeId: "prolonged-fasting-24-72-hours",
        ticks: [
          { label: "0", offsetMinutes: 0 },
          { label: "24 h minimum", offsetMinutes: 1440 },
          { label: "72 h / refeed", offsetMinutes: 4325 },
        ],
      },
      {
        labels: ["caffeine-free buffer", "bedtime"],
        routeId: "caffeine-curfew-dose-reset",
        ticks: [
          { label: "cutoff", offsetMinutes: 0 },
          { label: "8 h / bedtime", offsetMinutes: 485 },
        ],
      },
      {
        labels: ["wake/rise window"],
        routeId: "consistent-wake-time",
        ticks: ["target wake", "+60 min"],
      },
    ] as const;

    for (const expectedShape of expectedShapes) {
      const protocol = resolveHealthCommonsExperimentProtocol(expectedShape.routeId);
      const protocolTab = resolveHealthCommonsExperimentProtocolTab(expectedShape.routeId);

      expect(protocol?.sessionShape?.segments.map((segment) => segment.label)).toEqual(
        expectedShape.labels,
      );
      expect(protocol?.sessionShape?.ticks).toEqual(expectedShape.ticks);
      expect(protocolTab?.sessionShape).toEqual(protocol?.sessionShape);
    }

    const umbrellaProtocol = resolveHealthCommonsExperimentProtocol(
      "pre-sleep-resonance-breathing-and-meditation",
    );

    expect(umbrellaProtocol?.sessionShape).toBeUndefined();
  });

  it("uses the dedicated caffeine curfew artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("caffeine-curfew-dose-reset");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-caffeine-curfew.jpeg");
  });

  it("uses the simplified intermittent fasting title", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("time-restricted-eating-18-6");

    expect(protocol).not.toBeNull();
    expect(protocol?.title).toBe("Intermittent Fasting");
  });

  it("uses the dedicated intermittent fasting artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("time-restricted-eating-18-6");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-intermittent-fasting.jpg");
  });

  it("uses the dedicated red and near infrared skin artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol(
      "red-near-infrared-skin-texture-photoaging",
    );

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-red-light-for-skin.jpeg");
  });

  it("uses the dedicated prolonged fasting artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("prolonged-fasting-24-72-hours");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-prolonged-fasting.jpeg");
  });

  it("uses the dedicated pneumatic compression pants artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("pneumatic-compression-pants");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-pneumatic-compression-pants.jpg");
  });

  it("omits protocols hidden by Health Commons frontmatter from the public experiments library", () => {
    const catalog = createFixtureCatalog();

    for (const supplementProtocol of SUPPLEMENT_PROTOCOL_FIXTURES) {
      const protocolIndex = catalog.entities.findIndex(
        (entity) => entity.key === supplementProtocol.key,
      );
      const protocol = catalog.entities[protocolIndex];

      expect(protocol?.entityType).toBe("protocol_variant");
      if (!protocol || protocol.entityType !== "protocol_variant") {
        return;
      }

      catalog.entities[protocolIndex] = {
        ...protocol,
        hidden: true,
      };
    }

    const protocols = listHealthCommonsExperimentProtocols(
      createHealthCommonsCatalogReader(catalog),
    );
    const protocolIds = protocols.map((entry) => entry.id);

    for (const supplementProtocol of SUPPLEMENT_PROTOCOL_FIXTURES) {
      expect(protocolIds).not.toContain(supplementProtocol.routeId);
    }
    expect(protocolIds).toContain("bryan-johnson-blueprint");
    expect(
      resolveHealthCommonsExperimentProtocol(
        "hydrolyzed-collagen-peptides",
        createHealthCommonsCatalogReader(catalog),
      ),
    ).toBeNull();
  });

  it("does not resolve hidden generated protocols by direct route id", () => {
    expect(resolveHealthCommonsExperimentProtocol("hydrolyzed-collagen-peptides")).toBeNull();
  });

  it("omits hidden generated protocols from the experiment browse list and route params", () => {
    const hiddenRouteIds = getGeneratedExperimentIndex()
      .experiments
      .filter((entry) => entry.hidden === true)
      .map((entry) => entry.routeId);

    expect(hiddenRouteIds).toContain("it-band-syndrome-rehab-and-return-to-run");

    const browseProtocolIds = listHealthCommonsExperimentBrowseProtocols()
      .map((protocol) => protocol.id);
    const browseRouteParamIds = listHealthCommonsExperimentBrowseRouteParams()
      .map((entry) => entry.experimentId);

    for (const hiddenRouteId of hiddenRouteIds) {
      expect(browseProtocolIds).not.toContain(hiddenRouteId);
      expect(browseRouteParamIds).not.toContain(hiddenRouteId);
    }

    expect(
      resolveHealthCommonsExperimentProtocol("it-band-syndrome-rehab-and-return-to-run"),
    ).toBeNull();
  });

  it("prefers page-owned cold plunge artwork when the protocol declares media", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("cold-plunge");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/cold-plunge-tub.jpeg");
  });

  it("uses cold plunge signal descriptions from the protocol page", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("cold-plunge");

    expect(protocol).not.toBeNull();
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "Self-Reported Mood")?.description,
    ).toBe(
      "Cold water creates a strong arousal surge, followed by relief after exit, shifting perceived challenge and mood state.",
    );
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "HRV / RMSSD")?.description,
    ).toBe(
      "Cold shifts the nervous system toward sympathetic drive; overnight RMSSD reflects whether parasympathetic recovery returned.",
    );
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "Resting Heart Rate")?.description,
    ).toBe(
      "Immersion raises cardiac load; next-morning resting pulse shows whether the stress response has resolved.",
    );
  });

  it("strips Health Commons source keys from public Daily Step Floor copy", () => {
    const fullProtocol = resolveHealthCommonsExperimentProtocol("daily-step-floor");
    const browseProtocol = listHealthCommonsExperimentBrowseProtocols().find((protocol) =>
      protocol.id === "daily-step-floor"
    );
    const shell = resolveHealthCommonsExperimentShell("daily-step-floor");
    const protocolTab = resolveHealthCommonsExperimentProtocolTab("daily-step-floor");
    const researchTab = resolveHealthCommonsExperimentResearchTab("daily-step-floor");
    const resultsPublic = resolveHealthCommonsExperimentResultsPublic("daily-step-floor");
    const rawProtocolTab = loadGeneratedExperimentProjection(
      "daily-step-floor",
      "experiment.protocol",
    );

    if (
      !fullProtocol
      || !browseProtocol
      || !shell
      || !protocolTab
      || !researchTab
      || !resultsPublic
      || !rawProtocolTab
    ) {
      throw new Error("Daily Step Floor projections should resolve for public routes.");
    }

    const expectedSignalRouteIds = [
      "daily-step-count",
      "step-floor-days",
      "resting-heart-rate",
      "estimated-vo2max",
      "morning-blood-pressure",
      "sleep-efficiency",
      "musculoskeletal-pain",
      "walking-safety-events",
      "sedentary-time",
      "moderate-to-vigorous-activity-minutes",
      "walking-bout-minutes",
      "walking-cadence",
    ];
    const publishedBiomarkerRouteIds = new Set(listHealthCommonsBiomarkerRoutes());
    const expectedPublishedSignalRouteIds = expectedSignalRouteIds.map((routeId) =>
      publishedBiomarkerRouteIds.has(routeId) ? routeId : undefined
    );
    expect(fullProtocol.expectedSignals.map((signal) => signal.biomarkerRouteId)).toEqual(
      expectedPublishedSignalRouteIds,
    );
    expect(protocolTab.expectedSignals.map((signal) => signal.biomarkerRouteId)).toEqual(
      expectedSignalRouteIds,
    );
    expect(protocolTab.mechanismChain).toContainEqual({
      content: "Step floor · same source of truth · baseline-informed target",
      label: "Daily dose",
    });

    const rawSignalWithSourceKeys = rawProtocolTab.expectedSignals.find((signal) =>
      signal.description?.includes("source_artifact:")
      || signal.estimatedChange?.basis?.includes("source_artifact:")
    );
    const rawSourceBearingCopy = [
      rawSignalWithSourceKeys?.description,
      rawSignalWithSourceKeys?.estimatedChange?.basis,
    ].filter((value): value is string => typeof value === "string").join("\n");

    if (!rawSignalWithSourceKeys || !rawSourceBearingCopy) {
      throw new Error("Daily Step Floor fixture should include raw source keys before projection.");
    }

    expect(rawSourceBearingCopy).toMatch(/\bsource\s*keys?\s*:/iu);
    const scrubbedSignal = protocolTab.expectedSignals.find((signal) =>
      signal.label === rawSignalWithSourceKeys.label
    );
    const scrubbedSourceBearingCopy = [
      scrubbedSignal?.description,
      scrubbedSignal?.estimatedChange?.basis,
    ].filter((value): value is string => typeof value === "string").join("\n");

    if (!scrubbedSignal || !scrubbedSourceBearingCopy) {
      throw new Error("Daily Step Floor scrubbed signal should retain public copy.");
    }

    expect(scrubbedSourceBearingCopy).not.toContain("source_artifact:");
    expect(scrubbedSourceBearingCopy).not.toMatch(/\bsource\s*keys?\s*:/iu);

    const publicCopy = [
      fullProtocol.title,
      fullProtocol.description,
      fullProtocol.whyItWorks,
      ...collectExperimentProtocolCopy(fullProtocol),
      browseProtocol.title,
      browseProtocol.description,
      browseProtocol.whyItWorks,
      shell.title,
      shell.description,
      protocolTab.title,
      protocolTab.whyItWorks,
      ...collectExperimentProtocolCopy(protocolTab),
      researchTab.title,
      researchTab.description,
      ...researchTab.protocolKeepInMind,
      ...collectResearchLandscapeCopy(researchTab.researchLandscape),
      ...researchTab.studies.flatMap(collectResearchStudyCopy),
      ...(researchTab.researchGroups ?? []).flatMap((group) => [
        group.label,
        group.summary,
        ...group.studies.flatMap(collectResearchStudyCopy),
      ]),
      resultsPublic.title,
      ...resultsPublic.protocol.flatMap((step) => [step.title, step.detail]),
    ].join("\n");

    expect(publicCopy).not.toMatch(PUBLIC_SOURCE_KEY_RESIDUE_PATTERN);
  });

  it("strips Health Commons source keys from all public experiment projection copy", () => {
    const browseProtocols = new Map(
      listHealthCommonsExperimentBrowseProtocols().map((protocol) => [protocol.id, protocol]),
    );
    const dirtyCopy: string[] = [];

    for (const { experimentId } of listHealthCommonsExperimentRouteParams()) {
      const fullProtocol = resolveHealthCommonsExperimentProtocol(experimentId);
      const browseProtocol = browseProtocols.get(experimentId);
      const shell = resolveHealthCommonsExperimentShell(experimentId);
      const protocolTab = resolveHealthCommonsExperimentProtocolTab(experimentId);
      const researchTab = resolveHealthCommonsExperimentResearchTab(experimentId);
      const resultsPublic = resolveHealthCommonsExperimentResultsPublic(experimentId);

      if (
        !fullProtocol
        || !browseProtocol
        || !shell
        || !protocolTab
        || !researchTab
        || !resultsPublic
      ) {
        throw new Error(`${experimentId} should resolve for all public experiment projections.`);
      }

      const publicCopy = [
        fullProtocol.title,
        fullProtocol.description,
        fullProtocol.whyItWorks,
        ...collectExperimentProtocolCopy(fullProtocol),
        browseProtocol.title,
        browseProtocol.description,
        browseProtocol.whyItWorks,
        shell.title,
        shell.description,
        protocolTab.title,
        protocolTab.whyItWorks,
        ...collectExperimentProtocolCopy(protocolTab),
        researchTab.title,
        researchTab.description,
        ...researchTab.protocolKeepInMind,
        ...collectResearchLandscapeCopy(researchTab.researchLandscape),
        ...researchTab.studies.flatMap(collectResearchStudyCopy),
        ...(researchTab.researchGroups ?? []).flatMap((group) => [
          group.label,
          group.summary,
          ...group.studies.flatMap(collectResearchStudyCopy),
        ]),
        resultsPublic.title,
        ...resultsPublic.protocol.flatMap((step) => [step.title, step.detail]),
      ].join("\n");

      const issue = describeSourceKeyResidue(experimentId, publicCopy);
      if (issue) {
        dirtyCopy.push(issue);
      }
    }

    expect(dirtyCopy).toEqual([]);
  });

  it("strips Health Commons source keys from public biomarker detail copy", () => {
    const dirtyCopy: string[] = [];

    for (const biomarkerId of listHealthCommonsBiomarkerRoutes()) {
      const biomarker = resolveHealthCommonsBiomarkerDetail(biomarkerId);

      if (!biomarker) {
        throw new Error(`${biomarkerId} biomarker should resolve for public routes.`);
      }

      const issue = describeSourceKeyResidue(
        biomarkerId,
        collectBiomarkerCopy(biomarker).join("\n"),
      );
      if (issue) {
        dirtyCopy.push(issue);
      }
    }

    expect(dirtyCopy).toEqual([]);
  });

});

type ExperimentProtocolLike = NonNullable<
  ReturnType<typeof resolveHealthCommonsExperimentProtocolTab>
>;

type ExperimentResearchTab = NonNullable<
  ReturnType<typeof resolveHealthCommonsExperimentResearchTab>
>;

type BiomarkerDetail = NonNullable<
  ReturnType<typeof resolveHealthCommonsBiomarkerDetail>
>;

function collectExperimentProtocolCopy(
  protocol: Pick<
    ExperimentProtocolLike,
    | "expectedSignals"
    | "mechanismChain"
    | "measurementPaths"
    | "protocol"
    | "protocolFacts"
    | "protocolTips"
    | "safety"
  >,
): string[] {
  return [
    ...protocol.expectedSignals.flatMap((signal) => [
      signal.label,
      signal.value,
      signal.delta,
      signal.expected,
      signal.baseline ?? "",
      signal.description ?? "",
      signal.estimatedChange?.basis ?? "",
      signal.estimatedChange && "unit" in signal.estimatedChange
        ? signal.estimatedChange.unit
        : "",
      signal.estimatedChange?.window ?? "",
      signal.unit ?? "",
    ]),
    ...protocol.mechanismChain.flatMap((step) => [step.label, step.content]),
    ...protocol.measurementPaths.flatMap((path) => [
      path.label,
      ...path.notes,
      ...path.outcomeLabels,
      ...path.safetyOutcomeLabels,
      ...path.methods.flatMap((method) => [
        method.shortName,
        method.summary ?? "",
        method.title,
        ...(method.privacy?.notes ?? []),
      ]),
    ]),
    ...protocol.protocol.flatMap((step) => [step.title, step.detail]),
    ...protocol.protocolFacts.flatMap((fact) => [
      fact.label,
      fact.value,
      fact.detail ?? "",
    ]),
    ...protocol.protocolTips,
    ...protocol.safety.precautions,
    ...protocol.safety.whoShouldAvoid,
  ];
}

function collectResearchLandscapeCopy(
  landscape: ExperimentResearchTab["researchLandscape"],
): string[] {
  if (!landscape) {
    return [];
  }

  return [
    landscape.bottomLine,
    landscape.mainCaveat,
    landscape.primaryClaim,
  ];
}

function collectResearchStudyCopy(
  study: ExperimentResearchTab["studies"][number],
): string[] {
  return [
    study.authors,
    study.caveat ?? "",
    study.designLabel ?? "",
    study.duration ?? "",
    study.finding ?? "",
    study.headline ?? "",
    study.implication ?? "",
    study.journal,
    study.population ?? "",
    study.title,
  ];
}

function collectBiomarkerCopy(biomarker: BiomarkerDetail): string[] {
  return [
    biomarker.body,
    biomarker.summary,
    biomarker.title,
    biomarker.shortName,
    biomarker.measurement.bestContext,
    ...biomarker.measurement.confounders,
    ...biomarker.measurement.howToMeasure,
    ...biomarker.measurementContexts,
    biomarker.interpretationFrame.caveat,
    biomarker.interpretationFrame.principle,
    ...biomarker.explainerCards.flatMap((card) => [card.title, card.body]),
    ...biomarker.claims.flatMap((claim) => [
      claim.text,
      ...claim.caveats,
      ...claim.sources.flatMap((source) => [source.title, source.summary, source.typeLabel]),
    ]),
    ...biomarker.sourceHighlights.flatMap((source) => [source.title, source.summary, source.typeLabel]),
    ...biomarker.protocolRankings.flatMap((protocol) => [
      protocol.title,
      protocol.description,
      protocol.mechanism,
      protocol.category,
      protocol.burdenLabel,
      protocol.cautionLabel,
    ]),
    biomarker.communityOutcomeSummary.placeholder ?? "",
  ];
}

function describeSourceKeyResidue(label: string, text: string): string | null {
  const match = PUBLIC_SOURCE_KEY_RESIDUE_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const index = match.index;
  const excerpt = text
    .slice(Math.max(0, index - 80), index + 120)
    .replace(/\s+/gu, " ")
    .trim();
  return `${label}: ${excerpt}`;
}

function createFixtureCatalog() {
  return createHealthCommonsRouteBundleFixtureCatalog();
}
