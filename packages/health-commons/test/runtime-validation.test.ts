import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HealthCommonsProtocolArtifactError,
  loadGeneratedHealthCommonsProtocolFamilyGraph,
  loadGeneratedHealthCommonsProtocolIndex,
  loadGeneratedHealthCommonsProtocolRunSpecs,
  loadGeneratedHealthCommonsWebBiomarkerIndex,
  loadGeneratedHealthCommonsWebExperimentIndex,
  loadGeneratedHealthCommonsWebExperimentProtocolTab,
  loadGeneratedHealthCommonsWebExperimentResearchTab,
  loadGeneratedHealthCommonsWebExperimentResultsPublic,
  loadGeneratedHealthCommonsWebExperimentShell,
} from "@murphai/health-commons/runtime";
import {
  HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION,
  HEALTH_COMMONS_PROTOCOL_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION,
  type HealthCommonsProtocolIndexEntry,
} from "../src/protocol-artifacts.ts";
import {
  HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_SHELL_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
  type HealthCommonsWebBiomarkerIndexEntry,
  type HealthCommonsWebExperimentIndexEntry,
  type HealthCommonsWebExperimentProtocolTab,
  type HealthCommonsWebExperimentResearchGroup,
  type HealthCommonsWebExperimentResearchStudy,
  type HealthCommonsWebExperimentResearchTab,
  type HealthCommonsWebExperimentResultsPublic,
  type HealthCommonsWebExperimentShell,
  type HealthCommonsWebExperimentSignal,
  type HealthCommonsWebRouteIndex,
} from "../src/web-artifacts.ts";

const ROUTE_ID = "validation-protocol";
const KEY = `protocol_variant:${ROUTE_ID}`;
const CATALOG_HASH = `sha256:${"0".repeat(64)}`;
const REVISION = { pageRevisionId: `sha256:${"1".repeat(64)}` };
const RESEARCH_PATH = `tabs/experiments/${ROUTE_ID}/research.json`;
const PROTOCOL_PATH = `tabs/experiments/${ROUTE_ID}/protocol.json`;
const RESULTS_PATH = `tabs/experiments/${ROUTE_ID}/results-public.json`;
const SHELL_PATH = `shell/experiments/${ROUTE_ID}.json`;
const ROUTE = {
  aliases: [], entityType: "protocol_variant", routeId: ROUTE_ID, slug: ROUTE_ID,
} satisfies HealthCommonsWebExperimentResearchTab["route"];
const RESEARCH_ERROR = `Health Commons generated experiment research tab is invalid: ${RESEARCH_PATH}.`;
const GROUPS_ERROR = `Health Commons generated experiment research groups are invalid: ${RESEARCH_PATH}.`;
const LANDSCAPE_ERROR = `Health Commons generated experiment research landscape is invalid: ${RESEARCH_PATH}.`;
const PROTOCOL_ERROR = `Health Commons generated experiment protocol tab is invalid: ${PROTOCOL_PATH}.`;

type WebOptions = { generatedWebRoot: string; routeId: string };

function writeJson(root: string, relativePath: string, value: unknown): unknown {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const raw = JSON.stringify(value);
  writeFileSync(target, raw, "utf8");
  // Expectations describe the JSON actually read, not omitted undefined properties.
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

function withGeneratedWebRoot(run: (options: WebOptions) => void): void {
  const generatedWebRoot = mkdtempSync(path.join(os.tmpdir(), "commons-validation-"));
  try {
    writeJson(generatedWebRoot, "routes/index.json", {
      catalogHash: CATALOG_HASH,
      schemaVersion: HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
      routes: [{
        ...ROUTE,
        bundlePath: `bundles/protocol_variant/${ROUTE_ID}.json`,
        key: KEY,
        projections: {
          "experiment.research": RESEARCH_PATH,
          "experiment.protocol": PROTOCOL_PATH,
          "experiment.results-public": RESULTS_PATH,
          "experiment.shell": SHELL_PATH,
        },
      }],
    } satisfies HealthCommonsWebRouteIndex);
    run({ generatedWebRoot, routeId: ROUTE_ID });
  } finally {
    rmSync(generatedWebRoot, { recursive: true, force: true });
  }
}

const study = {
  authors: "Example Author", journal: "Example Journal", title: "Example Study", type: "RCT",
} satisfies HealthCommonsWebExperimentResearchStudy;
const populatedStudy = {
  ...study,
  caveat: "", designLabel: "Example design", displayPriority: -1.5,
  duration: "Example window", finding: "Example finding", findingKind: "finding",
  groupId: "example-group", headline: "Example headline", implication: "Example implication",
  includedStudyCount: 2.5, participantCountKind: "reported", participants: -3,
  population: "Example population", result: "mixed", scope: "direct_protocol",
  stance: "supports", url: "https://example.test/study", year: 2030,
} satisfies HealthCommonsWebExperimentResearchStudy;
const researchTab = {
  catalogHash: CATALOG_HASH, description: "", key: KEY, protocolKeepInMind: [],
  researchStats: [], revision: REVISION, route: ROUTE,
  schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION,
  studies: [], title: "Example protocol",
} satisfies HealthCommonsWebExperimentResearchTab;
const researchGroup = {
  id: "example-group", label: "Example group", stance: "supports", studies: [], summary: "",
} satisfies HealthCommonsWebExperimentResearchGroup;

function researchWithStudy(value: unknown, placement: "studies" | "researchGroups") {
  return placement === "studies"
    ? { ...researchTab, studies: [value] }
    : { ...researchTab, researchGroups: [{ ...researchGroup, studies: [value] }] };
}

describe.each(["studies", "researchGroups"] as const)("generated %s study boundary", (placement) => {
  const expectedError = placement === "studies" ? RESEARCH_ERROR : GROUPS_ERROR;

  it.each([
    ["minimal", study],
    ["populated optional metadata", populatedStudy],
    ["empty required strings", { ...study, authors: "", journal: "", title: "" }],
    ["omitted optional fields", { ...study, caveat: undefined, year: undefined, url: undefined }],
  ] as const)("accepts %s without changing the artifact", (_name, value) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, RESEARCH_PATH, researchWithStudy(value, placement));
      expect(loadGeneratedHealthCommonsWebExperimentResearchTab(options)).toStrictEqual(expected);
    });
  });

  it.each([
    ["null", null], ["array", []], ["scalar", "study"],
    ["missing author", { ...study, authors: undefined }],
    ["missing journal", { ...study, journal: undefined }],
    ["missing title", { ...study, title: undefined }],
    ["missing type", { ...study, type: undefined }],
    ["null required text", { ...study, title: null }],
    ["wrong required primitive", { ...study, journal: 3 }],
    ["null optional text", { ...study, caveat: null }],
    ["wrong optional text", { ...study, duration: false }],
    ["null optional number", { ...study, year: null }],
    ["numeric string", { ...study, participants: "3" }],
    ["wrong optional priority", { ...study, displayPriority: false }],
    ["wrong included count", { ...study, includedStudyCount: {} }],
    ["unknown key", { ...study, extra: "not allowed" }],
    ["enumerable prototype-named key", { ...study, constructor: "not allowed" }],
  ] as const)("rejects %s", (_name, value) => {
    withGeneratedWebRoot((options) => {
      writeJson(options.generatedWebRoot, RESEARCH_PATH, researchWithStudy(value, placement));
      expect(() => loadGeneratedHealthCommonsWebExperimentResearchTab(options))
        .toThrow(new Error(expectedError));
    });
  });

  it.each([
    ["type", ["GUIDE", "INT", "MA", "MECH", "N1", "OBS", "RCT", "REV", "SRC"]],
    ["findingKind", ["finding", "protocol_takeaway", "why_it_matters"]],
    ["participantCountKind", ["approximate", "range", "reported"]],
    ["result", ["mixed", "negative", "no_clear_advantage", "not_efficacy_evidence", "positive"]],
    ["scope", ["adjacent_variant", "clinical_supervised", "direct_protocol", "general_guideline", "measurement_context", "same_mechanism"]],
    ["stance", ["context_only", "contradicts", "does_not_confirm", "mixed", "safety_boundary", "supports"]],
  ] as const)("preserves the closed %s enum", (field, values) => {
    withGeneratedWebRoot((options) => {
      for (const value of values) {
        const expected = writeJson(options.generatedWebRoot, RESEARCH_PATH,
          researchWithStudy({ ...study, [field]: value }, placement));
        expect(loadGeneratedHealthCommonsWebExperimentResearchTab(options)).toStrictEqual(expected);
      }
      for (const value of ["unknown", "", null, 1]) {
        writeJson(options.generatedWebRoot, RESEARCH_PATH,
          researchWithStudy({ ...study, [field]: value }, placement));
        expect(() => loadGeneratedHealthCommonsWebExperimentResearchTab(options))
          .toThrow(new Error(expectedError));
      }
    });
  });

  it.each([
    ["http://example.test/study", true], ["https://example.test/study?q=1#result", true],
    [undefined, true], [null, false], [3, false], ["", false],
    ["/study", false], ["//example.test/study", false], ["https://", false],
    ["javascript:alert(1)", false], ["data:text/plain,example", false],
    ["file:///example-study", false], ["ftp://example.test/study", false],
    ["https://user@example.test/study", false],
    ["https://:password@example.test/study", false],
  ] as const)("preserves URL acceptance for %s", (url, accepted) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, RESEARCH_PATH,
        researchWithStudy({ ...study, url }, placement));
      const load = () => loadGeneratedHealthCommonsWebExperimentResearchTab(options);
      if (accepted) {
        expect(load()).toStrictEqual(expected);
      } else {
        expect(load).toThrow(new Error(expectedError));
      }
    });
  });

  it("accepts overflowing JSON numbers without normalizing them to null", () => {
    withGeneratedWebRoot((options) => {
      const artifact = researchWithStudy({ ...study, year: 0, participants: 0 }, placement);
      writeJson(options.generatedWebRoot, RESEARCH_PATH, artifact);
      // Write a numeric token directly: JSON.stringify(Infinity) would test null instead.
      const raw = JSON.stringify(artifact).replace('"year":0', '"year":1e400')
        .replace('"participants":0', '"participants":-1e400');
      writeFileSync(path.join(options.generatedWebRoot, RESEARCH_PATH), raw, "utf8");
      const loaded = loadGeneratedHealthCommonsWebExperimentResearchTab(options);
      const studies = placement === "studies" ? loaded?.studies : loaded?.researchGroups?.[0]?.studies;
      expect(studies?.[0]?.year).toBe(Infinity);
      expect(studies?.[0]?.participants).toBe(-Infinity);
    });
  });
});

describe("generated research projection stages", () => {
  it.each([
    ["empty arrays and permissive extra fields", {
      ...researchTab, extra: "kept", revision: {}, researchGroups: [],
    }],
    ["populated arrays, groups and landscape", {
      ...researchTab, protocolKeepInMind: [""], researchStats: [{ label: "", value: -1.5 }],
      researchGroups: [{ ...researchGroup, defaultOpen: false, extra: 1, studies: [populatedStudy] }],
      researchLandscape: { bottomLine: "", confidenceLabel: "limited", mainCaveat: "", primaryClaim: "" },
    }],
  ] as const)("accepts %s", (_name, artifact) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, RESEARCH_PATH, artifact);
      expect(loadGeneratedHealthCommonsWebExperimentResearchTab(options)).toStrictEqual(expected);
    });
  });

  it.each([
    ["bad studies win over bad groups and landscape", { studies: [null], researchGroups: null, researchLandscape: null }, RESEARCH_ERROR],
    ["missing base array", { protocolKeepInMind: undefined, researchGroups: null }, RESEARCH_ERROR],
    ["bad string array element", { protocolKeepInMind: [false] }, RESEARCH_ERROR],
    ["bad stat element", { researchStats: [{ label: "", value: null }] }, RESEARCH_ERROR],
    ["non-array studies", { studies: {} }, RESEARCH_ERROR],
    ["null route", { route: null }, RESEARCH_ERROR],
    ["array route", { route: [] }, RESEARCH_ERROR],
    ["bad route aliases", { route: { ...ROUTE, aliases: [null] } }, RESEARCH_ERROR],
    ["bad groups win over landscape", { researchGroups: [null], researchLandscape: null }, GROUPS_ERROR],
    ["null groups", { researchGroups: null }, GROUPS_ERROR],
    ["non-array groups", { researchGroups: {} }, GROUPS_ERROR],
    ["bad nested study wins over landscape", { researchGroups: [{ ...researchGroup, studies: [{}] }], researchLandscape: null }, GROUPS_ERROR],
    ["null optional group boolean", { researchGroups: [{ ...researchGroup, defaultOpen: null }] }, GROUPS_ERROR],
    ["wrong optional group boolean", { researchGroups: [{ ...researchGroup, defaultOpen: "false" }] }, GROUPS_ERROR],
    ["missing group studies", { researchGroups: [{ ...researchGroup, studies: undefined }] }, GROUPS_ERROR],
    ["null landscape after valid groups", { researchGroups: [], researchLandscape: null }, LANDSCAPE_ERROR],
    ["bad landscape enum", { researchLandscape: { bottomLine: "", confidenceLabel: "unknown", mainCaveat: "", primaryClaim: "" } }, LANDSCAPE_ERROR],
  ] as const)("preserves diagnostics: %s", (_name, overrides, message) => {
    withGeneratedWebRoot((options) => {
      writeJson(options.generatedWebRoot, RESEARCH_PATH, { ...researchTab, ...overrides });
      expect(() => loadGeneratedHealthCommonsWebExperimentResearchTab(options))
        .toThrow(new Error(message));
    });
  });

  it.each([
    ["key", { key: "protocol_variant:other" }],
    ["id", { id: "other" }],
    ["route", { route: { ...ROUTE, routeId: "other" } }],
  ] as const)("preserves final %s mismatch diagnostics", (field, overrides) => {
    withGeneratedWebRoot((options) => {
      writeJson(options.generatedWebRoot, RESEARCH_PATH, { ...researchTab, id: ROUTE_ID, ...overrides });
      expect(() => loadGeneratedHealthCommonsWebExperimentResearchTab(options)).toThrow(new Error(
        `Health Commons generated web projection ${field} does not match route index: ${RESEARCH_PATH}.`,
      ));
    });
  });
});

const signal = {
  delta: "", direction: "neutral", expected: "", label: "Example signal", value: "",
} satisfies HealthCommonsWebExperimentSignal;
const protocolTab = {
  baselineDays: 1, catalogHash: CATALOG_HASH, durationDays: 2,
  expectedSignals: [], experts: [], id: ROUTE_ID, key: KEY, measurementPaths: [],
  mechanismChain: [], protocol: [], protocolFacts: [], protocolTips: [],
  revision: REVISION, route: ROUTE, safety: { cautionLevel: 0, precautions: [], whoShouldAvoid: [] },
  schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION,
  title: "Example protocol", whyItWorks: "",
} satisfies HealthCommonsWebExperimentProtocolTab;
const measurementPath = {
  isDefault: false, label: "", methodKeys: ["example-method"],
  methods: [{ key: "example-method", modalities: [""], shortName: "", tier: "default_home", title: "" }],
  notes: [""], outcomeLabels: [], pathId: "example-path", required: false,
  safetyOutcomeLabels: [], tier: "default_home",
} satisfies HealthCommonsWebExperimentProtocolTab["measurementPaths"][number];

describe("generated protocol signals and arrays", () => {
  it.each([
    ["minimal", signal],
    ["optional metadata", { ...signal, baseline: "", description: "", displayValue: "", biomarkerRouteId: "", protocolProminence: "context", unit: "", extra: "kept" }],
    ["mixed estimate without numeric fields", { ...signal, estimatedChange: { kind: "mixed_or_contextual" } }],
    ["mixed estimate with unchecked extra fields", { ...signal, estimatedChange: { kind: "mixed_or_contextual", low: null, high: "extra", unit: [], confidence: "mixed" } }],
    ["absolute estimate without confidence", { ...signal, estimatedChange: { kind: "absolute", low: 3, high: -1.5, unit: "" } }],
    ["relative estimate with metadata", { ...signal, estimatedChange: { kind: "relative_percent", low: -2, high: 4, unit: "", basis: "", window: "", confidence: "high" } }],
  ] as const)("accepts %s without stripping fields", (_name, value) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, PROTOCOL_PATH, { ...protocolTab, expectedSignals: [value] });
      expect(loadGeneratedHealthCommonsWebExperimentProtocolTab(options)).toStrictEqual(expected);
    });
  });

  it.each([
    ["null signal", null], ["array signal", []],
    ["missing required string", { ...signal, delta: undefined }],
    ["null optional string", { ...signal, baseline: null }],
    ["wrong optional route", { ...signal, biomarkerRouteId: 1 }],
    ["bad direction", { ...signal, direction: "sideways" }],
    ["bad prominence", { ...signal, protocolProminence: "other" }],
    ["null estimate", { ...signal, estimatedChange: null }],
    ["array estimate", { ...signal, estimatedChange: [] }],
    ["unknown estimate kind", { ...signal, estimatedChange: { kind: "unknown" } }],
    ["missing numeric bounds", { ...signal, estimatedChange: { kind: "absolute" } }],
    ["null numeric bound", { ...signal, estimatedChange: { kind: "absolute", low: null, high: 2, unit: "" } }],
    ["missing numeric unit", { ...signal, estimatedChange: { kind: "relative_percent", low: 0, high: 2 } }],
    ["null confidence", { ...signal, estimatedChange: { kind: "mixed_or_contextual", confidence: null } }],
    ["unknown confidence", { ...signal, estimatedChange: { kind: "mixed_or_contextual", confidence: "certain" } }],
    ["null optional basis", { ...signal, estimatedChange: { kind: "mixed_or_contextual", basis: null } }],
    ["wrong optional window", { ...signal, estimatedChange: { kind: "absolute", low: 0, high: 2, unit: "", window: 1 } }],
  ] as const)("rejects %s", (_name, value) => {
    withGeneratedWebRoot((options) => {
      writeJson(options.generatedWebRoot, PROTOCOL_PATH, { ...protocolTab, expectedSignals: [value] });
      expect(() => loadGeneratedHealthCommonsWebExperimentProtocolTab(options)).toThrow(new Error(PROTOCOL_ERROR));
    });
  });

  it.each(["absolute", "relative_percent", "mixed_or_contextual"] as const)(
    "keeps confidence optional and closed for %s estimates", (kind) => {
      withGeneratedWebRoot((options) => {
        for (const confidence of [undefined, "low", "moderate", "high", "mixed", null, "unknown"]) {
          const expected = writeJson(options.generatedWebRoot, PROTOCOL_PATH, {
            ...protocolTab,
            expectedSignals: [{ ...signal, estimatedChange: { kind, low: 0, high: 1, unit: "", confidence } }],
          });
          const load = () => loadGeneratedHealthCommonsWebExperimentProtocolTab(options);
          if (confidence === null || confidence === "unknown") {
            expect(load).toThrow(new Error(PROTOCOL_ERROR));
          } else {
            expect(load()).toStrictEqual(expected);
          }
        }
      });
    },
  );

  it("accepts empty arrays and populated nested elements", () => {
    withGeneratedWebRoot((options) => {
      for (const artifact of [protocolTab, {
        ...protocolTab,
        experts: [{ field: "", initials: "", name: "Example", quote: "", profileImageUrl: "" }],
        measurementPaths: [measurementPath], mechanismChain: [{ content: "", label: "" }],
        protocol: [{ detail: "", number: -1.5, title: "" }],
        protocolFacts: [{ label: "", value: "", detail: "" }], protocolTips: [""],
        sessionShape: { segments: [], summarySegments: [], ticks: ["", { label: "", offsetMinutes: 0 }] },
      }]) {
        const expected = writeJson(options.generatedWebRoot, PROTOCOL_PATH, artifact);
        expect(loadGeneratedHealthCommonsWebExperimentProtocolTab(options)).toStrictEqual(expected);
      }
    });
  });

  it.each([
    "expectedSignals", "experts", "measurementPaths", "mechanismChain", "protocol", "protocolFacts", "protocolTips",
  ] as const)("rejects absent, null, non-array and malformed %s", (field) => {
    withGeneratedWebRoot((options) => {
      for (const value of [undefined, null, {}, [null]]) {
        writeJson(options.generatedWebRoot, PROTOCOL_PATH, { ...protocolTab, [field]: value });
        expect(() => loadGeneratedHealthCommonsWebExperimentProtocolTab(options)).toThrow(new Error(PROTOCOL_ERROR));
      }
    });
  });

  it.each([
    ["empty privacy", { notes: [] }, true],
    ["boolean privacy", { notes: [""], containsIdentifiableImages: false, localOnlyRecommended: true }, true],
    ["null optional boolean", { notes: [], containsIdentifiableImages: null }, false],
    ["wrong optional boolean", { notes: [], localOnlyRecommended: "false" }, false],
    ["bad notes", { notes: [1] }, false],
  ] as const)("preserves nested measurement %s", (_name, privacy, accepted) => {
    withGeneratedWebRoot((options) => {
      const artifact = { ...protocolTab, measurementPaths: [{ ...measurementPath,
        methods: [{ ...measurementPath.methods[0], privacy }],
      }] };
      const expected = writeJson(options.generatedWebRoot, PROTOCOL_PATH, artifact);
      const load = () => loadGeneratedHealthCommonsWebExperimentProtocolTab(options);
      if (accepted) expect(load()).toStrictEqual(expected);
      else expect(load).toThrow(new Error(PROTOCOL_ERROR));
    });
  });

  it.each([
    { measurementPaths: [{ ...measurementPath, methodKeys: [1] }] },
    { measurementPaths: [{ ...measurementPath, methods: [null] }] },
    { safety: { ...protocolTab.safety, precautions: [null] } },
    { sessionShape: { segments: [null] } },
    { sessionShape: { segments: [], summarySegments: null } },
    { sessionShape: { segments: [], ticks: [{ label: "", offsetMinutes: 1, positionPercent: 50 }] } },
    { sessionShape: { segments: [], ticks: [{ label: "", positionPercent: 101 }] } },
  ] as const)("rejects malformed nested elements: %j", (overrides) => {
    withGeneratedWebRoot((options) => {
      writeJson(options.generatedWebRoot, PROTOCOL_PATH, { ...protocolTab, ...overrides });
      expect(() => loadGeneratedHealthCommonsWebExperimentProtocolTab(options)).toThrow(new Error(PROTOCOL_ERROR));
    });
  });
});

const experimentEntry = {
  aliases: [], baselineDays: -1.5, bundlePath: `bundles/protocol_variant/${ROUTE_ID}.json`,
  categories: [], category: "", description: "", durationDays: 2, evidenceLabel: "", evidenceLevel: 0,
  hidden: false, image: null, key: KEY, quality: null, revision: REVISION,
  routeId: ROUTE_ID, slug: ROUTE_ID, status: null, studyCount: 0, summary: null, title: "",
} satisfies HealthCommonsWebExperimentIndexEntry;
const biomarkerEntry = {
  aliases: [], bundlePath: "bundles/biomarker/example-marker.json", categories: [],
  desiredDirection: null, fallbackRanges: [], hidden: false, key: "biomarker:example-marker",
  published: false, quality: null, revision: REVISION, routeId: "example-marker", shortName: "",
  slug: "example-marker", status: null, summary: null, title: "", unit: null,
} satisfies HealthCommonsWebBiomarkerIndexEntry;

describe.each([
  { name: "experiment", entry: experimentEntry, field: "experiments", file: "browse/experiments.json",
    version: HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION, load: loadGeneratedHealthCommonsWebExperimentIndex },
  { name: "biomarker", entry: biomarkerEntry, field: "biomarkers", file: "browse/biomarkers.json",
    version: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION, load: loadGeneratedHealthCommonsWebBiomarkerIndex },
] as const)("generated $name index boundaries", ({ name, entry, field, file, version, load }) => {
  it.each([
    ["null required nullable fields", {}, true],
    ["empty strings and populated arrays", { summary: "", quality: "", status: "", aliases: [""], categories: [""], extra: "kept" }, true],
    ["missing required nullable field", { summary: undefined }, false],
    ["wrong required nullable primitive", { quality: 0 }, false],
    ["null array", { aliases: null }, false],
    ["non-array", { categories: {} }, false],
    ["bad nested string", { aliases: [null] }, false],
    ["array revision", { revision: [] }, false],
  ] as const)("preserves %s", (_name, overrides, accepted) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, file, {
        catalogHash: CATALOG_HASH, schemaVersion: version, [field]: [{ ...entry, ...overrides }],
      });
      if (accepted) expect(load(options)).toStrictEqual(expected);
      else expect(() => load(options)).toThrow(new Error(`Health Commons generated web ${name} index is invalid.`));
    });
  });

  it("accepts empty collections but rejects invalid collections and entries", () => {
    withGeneratedWebRoot((options) => {
      for (const entries of [[], null, {}, [null], [[]]]) {
        const expected = writeJson(options.generatedWebRoot, file, {
          catalogHash: CATALOG_HASH, schemaVersion: version, [field]: entries,
        });
        if (Array.isArray(entries) && entries.length === 0) expect(load(options)).toStrictEqual(expected);
        else expect(() => load(options)).toThrow(new Error(`Health Commons generated web ${name} index is invalid.`));
      }
    });
  });
});

describe("generated biomarker fallback arrays", () => {
  it("preserves finite bounds and nonempty specimen checks within checked arrays", () => {
    const range = { applicability: "", eligibleSpecimenKinds: ["serum"], label: "", unit: "",
      lowerBound: { inclusive: true, value: 1 }, upperBound: { inclusive: false, value: 2 } };
    withGeneratedWebRoot((options) => {
      for (const [fallbackRanges, accepted] of [
        [[range], true],
        [[{ ...range, upperBound: undefined }], true],
        [null, false], [undefined, false], [{}, false], [[null], false],
        [[{ ...range, eligibleSpecimenKinds: [] }], false],
        [[{ ...range, lowerBound: { inclusive: true, value: 2 } }], false],
        [[{ ...range, upperBound: { inclusive: false, value: "2" } }], false],
      ] as const) {
        const expected = writeJson(options.generatedWebRoot, "browse/biomarkers.json", {
          catalogHash: CATALOG_HASH, schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
          // These fields are not validated by the current reader; do not tighten it.
          biomarkers: [{ ...biomarkerEntry, shortName: undefined, sortRank: "unchecked", fallbackRanges }],
        });
        const load = () => loadGeneratedHealthCommonsWebBiomarkerIndex(options);
        if (accepted) expect(load()).toStrictEqual(expected);
        else expect(load).toThrow(new Error("Health Commons generated web biomarker index is invalid."));
      }
      const artifact = { catalogHash: CATALOG_HASH,
        schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
        biomarkers: [{ ...biomarkerEntry, fallbackRanges: [range] }] };
      const raw = JSON.stringify(artifact).replace('"value":2', '"value":1e400');
      writeFileSync(path.join(options.generatedWebRoot, "browse/biomarkers.json"), raw, "utf8");
      expect(() => loadGeneratedHealthCommonsWebBiomarkerIndex(options))
        .toThrow(new Error("Health Commons generated web biomarker index is invalid."));
    });
  });
});

describe("shared nullable values and compact protocol entries", () => {
  const shell = {
    ...experimentEntry, catalogHash: CATALOG_HASH, id: ROUTE_ID, route: ROUTE,
    schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_SHELL_SCHEMA_VERSION,
  } satisfies HealthCommonsWebExperimentShell;
  const results = {
    ...protocolTab, schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION,
    commons: { aliases: [], catalogHash: CATALOG_HASH, key: KEY, pageRevisionId: REVISION.pageRevisionId,
      recipeHash: null, routeId: ROUTE_ID, runSpecRevisionId: null, slug: ROUTE_ID },
  } satisfies HealthCommonsWebExperimentResultsPublic;

  it.each([null, "", undefined, 1] as const)("preserves required nullable shell image %s", (image) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, SHELL_PATH, {
        ...shell, image,
      });
      const load = () => loadGeneratedHealthCommonsWebExperimentShell(options);
      if (image === null || typeof image === "string") expect(load()).toStrictEqual(expected);
      else expect(load).toThrow(new Error(`Health Commons generated experiment shell is invalid: ${SHELL_PATH}.`));
    });
  });

  it.each([null, "", undefined, false] as const)("preserves required nullable results revision %s", (recipeHash) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, RESULTS_PATH, {
        ...results, commons: { ...results.commons, recipeHash },
      });
      const load = () => loadGeneratedHealthCommonsWebExperimentResultsPublic(options);
      if (recipeHash === null || typeof recipeHash === "string") expect(load()).toStrictEqual(expected);
      else expect(load).toThrow(new Error(`Health Commons generated experiment results public is invalid: ${RESULTS_PATH}.`));
    });
  });

  const compactEntry = {
    aliases: [], categories: [], entityType: "protocol_variant", key: KEY, relativePath: "example.md",
    revision: { ...REVISION, recipeHash: null, runSpecRevisionId: null }, routeId: ROUTE_ID,
    routeIds: [], slug: ROUTE_ID, status: null, summary: null, title: "",
    traits: { cautionLevel: null, externalProtocol: false, highCaution: false, murphCanonical: false, sourceAttributed: false },
  } satisfies HealthCommonsProtocolIndexEntry;

  it("distinguishes checked arrays from opaque arrays in compact run specs", () => {
    withGeneratedWebRoot(({ generatedWebRoot }) => {
      const runSpec = { ...compactEntry, expectedSignalDescriptions: [null], testPlans: [false],
        whyItWorks: [""], experimentOnboarding: null, protocol: null, safety: null };
      for (const [overrides, accepted] of [
        [{}, true],
        [{ whyItWorks: [null] }, false],
        [{ whyItWorks: undefined }, false],
        [{ protocol: undefined }, false],
        [{ protocol: [] }, false],
      ] as const) {
        const expected = writeJson(generatedWebRoot, "run-specs.json", {
          catalogHash: CATALOG_HASH, schemaVersion: HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION,
          protocols: [{ ...runSpec, ...overrides }],
        });
        const load = () => loadGeneratedHealthCommonsProtocolRunSpecs({
          protocolRunSpecsPath: path.join(generatedWebRoot, "run-specs.json"),
        });
        if (accepted) expect(load()).toStrictEqual(expected);
        else expect(load).toThrow(HealthCommonsProtocolArtifactError);
      }
    });
  });

  it("checks graph elements while retaining optional shared search text", () => {
    withGeneratedWebRoot(({ generatedWebRoot }) => {
      const family = { ...compactEntry, entityType: "experiment_family", key: "experiment_family:example" };
      const edge = { sourceKey: KEY, targetKey: family.key, type: "parent_family" };
      for (const [families, edges, accepted] of [
        [[family], [edge], true],
        [[null], [edge], false],
        [[family], [null], false],
        [[family], [{ ...edge, type: "unknown" }], false],
      ] as const) {
        const expected = writeJson(generatedWebRoot, "graph.json", {
          catalogHash: CATALOG_HASH, schemaVersion: HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION,
          protocols: [compactEntry], families, edges,
        });
        const load = () => loadGeneratedHealthCommonsProtocolFamilyGraph({
          protocolFamilyGraphPath: path.join(generatedWebRoot, "graph.json"),
        });
        if (accepted) expect(load()).toStrictEqual(expected);
        else expect(load).toThrow(HealthCommonsProtocolArtifactError);
      }
    });
  });

  it.each([
    ["omitted search text", {}, false, true],
    ["empty search text", { searchText: "" }, true, true],
    ["null search text", { searchText: null }, false, false],
    ["wrong search text", { searchText: 3 }, false, false],
    ["missing nullable summary", { searchText: "", summary: undefined }, false, false],
    ["bad alias element", { searchText: "", aliases: [null] }, false, false],
    ["non-array route ids", { searchText: "", routeIds: {} }, false, false],
  ] as const)("preserves %s across compact artifacts", (_name, overrides, indexAccepted, sharedAccepted) => {
    withGeneratedWebRoot(({ generatedWebRoot }) => {
      const entry = { ...compactEntry, ...overrides };
      for (const scenario of [
        { artifact: "protocol_index", schemaVersion: HEALTH_COMMONS_PROTOCOL_INDEX_SCHEMA_VERSION,
          accepted: indexAccepted, protocols: [entry],
          load: (file: string) => loadGeneratedHealthCommonsProtocolIndex({ protocolIndexPath: file }) },
        { artifact: "protocol_family_graph", schemaVersion: HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION,
          accepted: sharedAccepted, protocols: [entry],
          load: (file: string) => loadGeneratedHealthCommonsProtocolFamilyGraph({ protocolFamilyGraphPath: file }) },
        { artifact: "protocol_run_specs", schemaVersion: HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION,
          accepted: sharedAccepted, protocols: [{ ...entry, expectedSignalDescriptions: [], testPlans: [],
            whyItWorks: [""], experimentOnboarding: null, protocol: null, safety: null }],
          load: (file: string) => loadGeneratedHealthCommonsProtocolRunSpecs({ protocolRunSpecsPath: file }) },
      ]) {
        const relativePath = `${scenario.artifact}.json`;
        const expected = writeJson(generatedWebRoot, relativePath, {
          catalogHash: CATALOG_HASH, schemaVersion: scenario.schemaVersion,
          protocols: scenario.protocols, families: [], edges: [],
        });
        const load = () => scenario.load(path.join(generatedWebRoot, relativePath));
        if (scenario.accepted) {
          expect(load()).toStrictEqual(expected);
        } else {
          let failure: unknown;
          try {
            load();
          } catch (error) {
            failure = error;
          }
          expect(failure).toBeInstanceOf(HealthCommonsProtocolArtifactError);
          expect(failure).toMatchObject({
            artifact: scenario.artifact, category: "invalid", code: "HEALTH_COMMONS_PROTOCOL_ARTIFACT_FAILURE",
            message: "Health Commons protocol artifact is invalid.",
          });
        }
      }
    });
  });
});
