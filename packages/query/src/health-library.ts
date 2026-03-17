import {
  readMarkdownDocument,
  walkRelativeFiles,
} from "./health/loaders.js";
import {
  asObject,
  firstNumber,
  firstString,
  firstStringArray,
  type FrontmatterObject,
} from "./health/shared.js";
import {
  readVaultTolerant,
  type VaultReadModel,
  type VaultRecord,
} from "./model.js";

export type HealthLibraryEntityType =
  | "mission"
  | "domain"
  | "biomarker"
  | "goal_template"
  | "experiment_family"
  | "protocol_variant"
  | "source_person"
  | "source_artifact";

export interface HealthLibraryNode {
  attributes: FrontmatterObject;
  body: string;
  entityType: HealthLibraryEntityType;
  relativePath: string;
  slug: string;
  status: string | null;
  summary: string | null;
  title: string;
}

export interface HealthLibraryGraph {
  bySlug: ReadonlyMap<string, HealthLibraryNode>;
  nodes: HealthLibraryNode[];
}

export interface HealthLibraryResolvedLink {
  entityType: HealthLibraryEntityType | null;
  slug: string;
  subtitle: string | null;
  title: string;
  url: string | null;
}

export interface BiomarkerMeasurementContext {
  label: string;
  slug: string;
  summary: string | null;
  unit: string | null;
}

export interface BiomarkerHeroStat {
  context: string | null;
  label: string;
  sourceLinks: HealthLibraryResolvedLink[];
  value: string;
}

export interface BiomarkerReferenceSet {
  benchmark: string;
  kind: string | null;
  label: string;
  measurementContextLabel: string | null;
  note: string | null;
  population: string | null;
  sourceLinks: HealthLibraryResolvedLink[];
}

export interface BiomarkerInsight {
  body: string;
  sourceLinks: HealthLibraryResolvedLink[];
  stat: string | null;
  title: string;
}

export interface BiomarkerProtocolEffect {
  confidence: number | null;
  evidenceLevel: string | null;
  expectedDirection: string | null;
  latency: string | null;
  role: string | null;
  sourceMode: string | null;
}

export interface BiomarkerProtocolCard {
  contraindications: string[];
  effect: BiomarkerProtocolEffect;
  family: HealthLibraryResolvedLink | null;
  instructions: string[];
  sourceLinks: HealthLibraryResolvedLink[];
  sourcePeople: HealthLibraryResolvedLink[];
  slug: string;
  summary: string | null;
  title: string;
}

export interface BiomarkerUserGoal {
  id: string;
  measurementContextLabel: string | null;
  status: string | null;
  target: string | null;
  title: string;
}

export interface BiomarkerExperimentRun {
  hypothesis: string | null;
  protocol: HealthLibraryResolvedLink | null;
  slug: string;
  startedOn: string | null;
  status: string | null;
  title: string;
}

export interface BiomarkerPersonalStats {
  baseline28: number | null;
  baseline7: number | null;
  baseline56: number | null;
  defaultMeasurementContext: string | null;
  deltaFrom28: number | null;
  latestOccurredAt: string | null;
  latestValue: number | null;
  samples: Array<{ date: string | null; occurredAt: string | null; value: number }>;
}

export interface BiomarkerLibraryPage {
  activeExperiments: BiomarkerExperimentRun[];
  activeGoals: BiomarkerUserGoal[];
  baselineInsights: BiomarkerInsight[];
  body: string;
  defaultMeasurementContext: BiomarkerMeasurementContext | null;
  domainLinks: HealthLibraryResolvedLink[];
  goalTemplateLinks: HealthLibraryResolvedLink[];
  guardrails: BiomarkerInsight[];
  healthspanEvidence: BiomarkerInsight[];
  heroStats: BiomarkerHeroStat[];
  introParagraphs: string[];
  measurementContexts: BiomarkerMeasurementContext[];
  mechanisms: BiomarkerInsight[];
  mission: HealthLibraryResolvedLink | null;
  personalStats: BiomarkerPersonalStats;
  protocols: BiomarkerProtocolCard[];
  referenceSets: BiomarkerReferenceSet[];
  relatedBiomarkerLinks: HealthLibraryResolvedLink[];
  signalInsights: BiomarkerInsight[];
  sourceLinks: HealthLibraryResolvedLink[];
  status: string | null;
  summary: string | null;
  title: string;
}

const HEALTH_LIBRARY_ROOT = "bank/library";
const HEALTH_LIBRARY_ENTITY_TYPES = new Set<HealthLibraryEntityType>([
  "mission",
  "domain",
  "biomarker",
  "goal_template",
  "experiment_family",
  "protocol_variant",
  "source_person",
  "source_artifact",
]);

export async function readHealthLibraryGraph(
  vaultRoot: string,
): Promise<HealthLibraryGraph> {
  const relativePaths = await walkRelativeFiles(vaultRoot, HEALTH_LIBRARY_ROOT, ".md");
  const nodes: HealthLibraryNode[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const node = toHealthLibraryNode(document.relativePath, document.body, document.attributes);
    if (node) {
      nodes.push(node);
    }
  }

  nodes.sort((left, right) => left.slug.localeCompare(right.slug));

  return {
    bySlug: new Map(nodes.map((node) => [node.slug, node])),
    nodes,
  };
}

export async function readBiomarkerLibraryPage(
  vaultRoot: string,
  slug: string,
): Promise<BiomarkerLibraryPage | null> {
  const [graph, vault] = await Promise.all([
    readHealthLibraryGraph(vaultRoot),
    readVaultTolerant(vaultRoot),
  ]);

  const node = graph.bySlug.get(slug);
  if (!node || node.entityType !== "biomarker") {
    return null;
  }

  const measurementContexts = readMeasurementContexts(node.attributes);
  const measurementContextMap = new Map(
    measurementContexts.map((context) => [context.slug, context]),
  );
  const defaultMeasurementContextSlug =
    firstString(node.attributes, [
      "defaultMeasurementContextSlug",
      "defaultMeasurementContext",
      "default_product_context",
    ]) ?? null;

  const heroStats = readObjectArray(node.attributes, "heroStats").map((entry) => ({
    context: firstString(entry, ["context"]),
    label: firstString(entry, ["label"]) ?? "Unknown stat",
    sourceLinks: resolveLinks(graph, firstStringArray(entry, ["sourceSlugs"])),
    value: firstString(entry, ["value"]) ?? "Unknown",
  }));

  const referenceSets = readObjectArray(node.attributes, "referenceSets").map((entry) => {
    const measurementContextSlug = firstString(entry, [
      "measurementContextSlug",
      "measurementContext",
    ]);

    return {
      benchmark: firstString(entry, ["benchmark", "value"]) ?? "Unknown",
      kind: firstString(entry, ["kind"]),
      label: firstString(entry, ["label"]) ?? "Reference set",
      measurementContextLabel:
        measurementContextSlug
          ? measurementContextMap.get(measurementContextSlug)?.label ??
            humanizeSlug(measurementContextSlug)
          : null,
      note: firstString(entry, ["note", "summary"]),
      population: firstString(entry, ["population"]),
      sourceLinks: resolveLinks(graph, firstStringArray(entry, ["sourceSlugs"])),
    };
  });

  const protocolCards = graph.nodes
    .filter((candidate) => candidate.entityType === "protocol_variant")
    .map((candidate) => toProtocolCard(candidate, slug, graph))
    .filter((candidate): candidate is BiomarkerProtocolCard => candidate !== null)
    .sort(compareProtocolCards);

  const goalTemplateSlugs = firstStringArray(node.attributes, [
    "goalTemplateSlugs",
    "linkedGoals",
    "linked_goals",
  ]);

  return {
    activeExperiments: readActiveExperiments(vault, slug, protocolCards),
    activeGoals: readActiveGoals(vault, slug, goalTemplateSlugs, measurementContextMap),
    baselineInsights: readInsightList(graph, node.attributes, "baselineInsights"),
    body: node.body,
    defaultMeasurementContext:
      defaultMeasurementContextSlug
        ? measurementContextMap.get(defaultMeasurementContextSlug) ?? null
        : null,
    domainLinks: resolveLinks(
      graph,
      firstStringArray(node.attributes, ["domainSlugs", "domains"]),
    ),
    goalTemplateLinks: resolveLinks(graph, goalTemplateSlugs),
    guardrails: readInsightList(graph, node.attributes, "guardrails"),
    healthspanEvidence: readInsightList(graph, node.attributes, "healthspanEvidence"),
    heroStats,
    introParagraphs: extractIntroParagraphs(node.body, 2),
    measurementContexts,
    mechanisms: readInsightList(graph, node.attributes, "mechanisms"),
    mission: resolveLink(
      graph,
      firstString(node.attributes, ["missionSlug", "mission"]),
    ),
    personalStats: summarizePersonalStats(vault, slug, defaultMeasurementContextSlug),
    protocols: protocolCards,
    referenceSets,
    relatedBiomarkerLinks: resolveLinks(
      graph,
      firstStringArray(node.attributes, [
        "relatedBiomarkerSlugs",
        "linkedBiomarkers",
        "linked_biomarkers",
      ]),
    ),
    signalInsights: readInsightList(graph, node.attributes, "signalInsights"),
    sourceLinks: resolveLinks(
      graph,
      firstStringArray(node.attributes, ["sourceSlugs"]),
    ),
    status: node.status,
    summary: node.summary,
    title: node.title,
  };
}

function toHealthLibraryNode(
  relativePath: string,
  body: string,
  attributes: FrontmatterObject,
): HealthLibraryNode | null {
  const source = asObject(attributes);
  if (!source) {
    return null;
  }

  const slug = firstString(source, ["slug"]);
  const entityType = parseHealthLibraryEntityType(
    firstString(source, ["entityType", "entity_type"]),
  );

  if (!slug || !entityType) {
    return null;
  }

  return {
    attributes,
    body,
    entityType,
    relativePath,
    slug,
    status: firstString(source, ["status"]),
    summary: firstString(source, ["summary"]) ?? summarizeBody(body),
    title: firstString(source, ["title"]) ?? humanizeSlug(slug),
  };
}

function parseHealthLibraryEntityType(
  value: string | null,
): HealthLibraryEntityType | null {
  if (!value || !HEALTH_LIBRARY_ENTITY_TYPES.has(value as HealthLibraryEntityType)) {
    return null;
  }

  return value as HealthLibraryEntityType;
}

function readMeasurementContexts(
  attributes: FrontmatterObject,
): BiomarkerMeasurementContext[] {
  return readObjectArray(attributes, "measurementContexts")
    .map((entry) => {
      const slug = firstString(entry, ["slug", "id"]);
      if (!slug) {
        return null;
      }

      return {
        label: firstString(entry, ["label", "title"]) ?? humanizeSlug(slug),
        slug,
        summary: firstString(entry, ["summary", "description"]),
        unit: firstString(entry, ["unit"]),
      };
    })
    .filter((entry): entry is BiomarkerMeasurementContext => entry !== null);
}

function readInsightList(
  graph: HealthLibraryGraph,
  attributes: FrontmatterObject,
  key: string,
): BiomarkerInsight[] {
  return readObjectArray(attributes, key)
    .map((entry) => {
      const title = firstString(entry, ["title", "label"]);
      const body = firstString(entry, ["body", "summary", "note"]);
      if (!title || !body) {
        return null;
      }

      return {
        body,
        sourceLinks: resolveLinks(graph, firstStringArray(entry, ["sourceSlugs"])),
        stat: firstString(entry, ["stat", "value"]),
        title,
      };
    })
    .filter((entry): entry is BiomarkerInsight => entry !== null);
}

function readObjectArray(
  attributes: FrontmatterObject,
  key: string,
): Record<string, unknown>[] {
  const value = attributes[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function resolveLinks(
  graph: HealthLibraryGraph,
  slugs: readonly string[],
): HealthLibraryResolvedLink[] {
  return slugs.map((slug) => buildResolvedLink(graph.bySlug.get(slug) ?? null, slug));
}

function resolveLink(
  graph: HealthLibraryGraph,
  slug: string | null,
): HealthLibraryResolvedLink | null {
  if (!slug) {
    return null;
  }

  return buildResolvedLink(graph.bySlug.get(slug) ?? null, slug);
}

function buildResolvedLink(
  node: HealthLibraryNode | null,
  slug: string,
): HealthLibraryResolvedLink {
  if (!node) {
    return {
      entityType: null,
      slug,
      subtitle: null,
      title: humanizeSlug(slug),
      url: null,
    };
  }

  const url =
    node.entityType === "source_artifact"
      ? firstString(node.attributes, ["url", "href"])
      : null;

  const subtitle =
    node.entityType === "source_artifact"
      ? firstString(node.attributes, ["publisher", "sourceKind"])
      : node.entityType === "source_person"
        ? firstString(node.attributes, ["role"])
        : node.summary;

  return {
    entityType: node.entityType,
    slug: node.slug,
    subtitle,
    title: node.title,
    url,
  };
}

function toProtocolCard(
  node: HealthLibraryNode,
  biomarkerSlug: string,
  graph: HealthLibraryGraph,
): BiomarkerProtocolCard | null {
  const biomarkerLinks = readObjectArray(node.attributes, "biomarkerLinks");
  const matchedLink = biomarkerLinks.find(
    (entry) => firstString(entry, ["biomarkerSlug"]) === biomarkerSlug,
  );

  if (!matchedLink) {
    return null;
  }

  return {
    contraindications: firstStringArray(node.attributes, ["contraindications", "warnings"]),
    effect: {
      confidence: firstNumber(matchedLink, ["confidence"]),
      evidenceLevel: firstString(matchedLink, ["evidenceLevel", "evidence_level"]),
      expectedDirection: firstString(matchedLink, [
        "expectedDirection",
        "expected_direction",
      ]),
      latency: firstString(matchedLink, ["latency", "latencyDays", "latency_days"]),
      role: firstString(matchedLink, ["role"]),
      sourceMode: firstString(matchedLink, ["sourceMode", "source_mode"]),
    },
    family: resolveLink(graph, firstString(node.attributes, ["familySlug", "experimentFamilySlug"])),
    instructions: firstStringArray(node.attributes, ["instructions", "steps"]),
    sourceLinks: resolveLinks(graph, firstStringArray(node.attributes, ["sourceSlugs"])),
    sourcePeople: resolveLinks(
      graph,
      firstStringArray(node.attributes, ["sourcePersonSlugs", "sourcePeople"]),
    ),
    slug: node.slug,
    summary: node.summary,
    title: node.title,
  };
}

function compareProtocolCards(
  left: BiomarkerProtocolCard,
  right: BiomarkerProtocolCard,
): number {
  const confidenceDelta = (right.effect.confidence ?? -1) - (left.effect.confidence ?? -1);
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  return left.title.localeCompare(right.title);
}

function readActiveGoals(
  vault: VaultReadModel,
  biomarkerSlug: string,
  goalTemplateSlugs: readonly string[],
  measurementContextMap: ReadonlyMap<string, BiomarkerMeasurementContext>,
): BiomarkerUserGoal[] {
  const goalTemplateSet = new Set(goalTemplateSlugs);

  return vault.goals
    .filter((goal) => goal.status === "active")
    .map((goal) => toBiomarkerUserGoal(goal, biomarkerSlug, goalTemplateSet, measurementContextMap))
    .filter((goal): goal is BiomarkerUserGoal => goal !== null);
}

function readActiveExperiments(
  vault: VaultReadModel,
  biomarkerSlug: string,
  protocols: readonly BiomarkerProtocolCard[],
): BiomarkerExperimentRun[] {
  const protocolSlugSet = new Set(protocols.map((protocol) => protocol.slug));
  const protocolMap = new Map(protocols.map((protocol) => [protocol.slug, protocol]));

  return vault.experiments
    .filter((experiment) =>
      experiment.status === "active" ||
      experiment.status === "planned" ||
      experiment.status === "paused",
    )
    .map((experiment) =>
      toBiomarkerExperimentRun(experiment, biomarkerSlug, protocolSlugSet, protocolMap),
    )
    .filter((experiment): experiment is BiomarkerExperimentRun => experiment !== null)
    .sort((left, right) => (right.startedOn ?? "").localeCompare(left.startedOn ?? ""));
}

function toBiomarkerExperimentRun(
  experiment: VaultRecord,
  biomarkerSlug: string,
  protocolSlugSet: ReadonlySet<string>,
  protocolMap: ReadonlyMap<string, BiomarkerProtocolCard>,
): BiomarkerExperimentRun | null {
  const data = asObject(experiment.data);
  if (!data) {
    return null;
  }

  const primaryBiomarkerSlug = firstString(data, ["primaryBiomarkerSlug"]);
  const biomarkerSlugs = firstStringArray(data, ["biomarkerSlugs"]);
  const protocolSlug = firstString(data, ["protocolSlug"]);

  if (
    primaryBiomarkerSlug !== biomarkerSlug &&
    !biomarkerSlugs.includes(biomarkerSlug) &&
    (!protocolSlug || !protocolSlugSet.has(protocolSlug))
  ) {
    return null;
  }

  return {
    hypothesis: firstString(data, ["hypothesis"]),
    protocol: protocolSlug
      ? {
          entityType: "protocol_variant",
          slug: protocolSlug,
          subtitle: protocolMap.get(protocolSlug)?.family?.title ?? null,
          title: protocolMap.get(protocolSlug)?.title ?? humanizeSlug(protocolSlug),
          url: null,
        }
      : null,
    slug: firstString(data, ["slug", "experimentSlug", "experiment_slug"]) ?? experiment.displayId,
    startedOn: firstString(data, ["startedOn"]),
    status: experiment.status ?? null,
    title: experiment.title ?? experiment.displayId,
  };
}

function toBiomarkerUserGoal(
  goal: VaultRecord,
  biomarkerSlug: string,
  goalTemplateSet: ReadonlySet<string>,
  measurementContextMap: ReadonlyMap<string, BiomarkerMeasurementContext>,
): BiomarkerUserGoal | null {
  const data = asObject(goal.data);
  if (!data) {
    return null;
  }

  const primaryBiomarkerSlug = firstString(data, ["primaryBiomarkerSlug"]);
  const biomarkerSlugs = firstStringArray(data, ["biomarkerSlugs"]);
  const goalTemplateSlug = firstString(data, ["goalTemplateSlug"]);

  if (
    primaryBiomarkerSlug !== biomarkerSlug &&
    !biomarkerSlugs.includes(biomarkerSlug) &&
    (!goalTemplateSlug || !goalTemplateSet.has(goalTemplateSlug))
  ) {
    return null;
  }

  const target = asObject(data.target);
  const targetValue = target ? firstNumber(target, ["value"]) : null;
  const targetUnit = target ? firstString(target, ["unit"]) : null;
  const targetComparator = target ? firstString(target, ["comparator"]) : null;
  const measurementContextSlug = firstString(data, [
    "measurementContextSlug",
    "measurementContext",
  ]);

  return {
    id: goal.displayId,
    measurementContextLabel:
      measurementContextSlug
        ? measurementContextMap.get(measurementContextSlug)?.label ??
          humanizeSlug(measurementContextSlug)
        : null,
    status: goal.status ?? null,
    target:
      targetValue !== null
        ? `${targetComparator ?? "target"} ${targetValue}${targetUnit ? ` ${targetUnit}` : ""}`
        : null,
    title: goal.title ?? goal.displayId,
  };
}

function summarizePersonalStats(
  vault: VaultReadModel,
  biomarkerSlug: string,
  defaultMeasurementContextSlug: string | null,
): BiomarkerPersonalStats {
  const samples = vault.samples
    .map((sample) => toBiomarkerSample(sample, biomarkerSlug))
    .filter((sample): sample is { date: string | null; occurredAt: string | null; measurementContext: string | null; value: number } => sample !== null)
    .filter((sample) =>
      defaultMeasurementContextSlug
        ? sample.measurementContext === defaultMeasurementContextSlug
        : true,
    )
    .sort((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""));

  const latest = samples.at(-1) ?? null;
  const latestSeven = samples.slice(-7).map((sample) => sample.value);
  const latestTwentyEight = samples.slice(-28).map((sample) => sample.value);
  const latestFiftySix = samples.slice(-56).map((sample) => sample.value);
  const baseline28 = average(latestTwentyEight);

  return {
    baseline28,
    baseline7: average(latestSeven),
    baseline56: average(latestFiftySix),
    defaultMeasurementContext: defaultMeasurementContextSlug,
    deltaFrom28:
      latest && baseline28 !== null
        ? Number((latest.value - baseline28).toFixed(1))
        : null,
    latestOccurredAt: latest?.occurredAt ?? null,
    latestValue: latest?.value ?? null,
    samples: samples.map((sample) => ({
      date: sample.date,
      occurredAt: sample.occurredAt,
      value: sample.value,
    })),
  };
}

function toBiomarkerSample(
  sample: VaultRecord,
  biomarkerSlug: string,
): { date: string | null; occurredAt: string | null; measurementContext: string | null; value: number } | null {
  if (sample.stream !== "heart_rate") {
    return null;
  }

  const data = asObject(sample.data);
  const sampleBiomarkerSlug = data
    ? firstString(data, ["biomarkerSlug"])
    : null;

  if (sampleBiomarkerSlug && sampleBiomarkerSlug !== biomarkerSlug) {
    return null;
  }

  const value = typeof sample.data.value === "number" ? sample.data.value : null;
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return {
    date: sample.date,
    occurredAt: sample.occurredAt,
    measurementContext: data ? firstString(data, ["measurementContext"]) : null,
    value,
  };
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(1));
}

function summarizeBody(body: string): string | null {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  if (!normalized) {
    return null;
  }

  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function extractIntroParagraphs(body: string, limit: number): string[] {
  return body
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"))
    .slice(0, limit);
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
