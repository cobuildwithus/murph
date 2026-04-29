import {
  CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
} from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";
import { resolveExperimentRouteImage } from "./experiment-images";
import {
  getGeneratedExperimentIndex,
  type GeneratedExperimentIndexEntry,
} from "./generated-experiment-artifacts";

const FINNISH_SAUNA_ROUTE_ID = "finnish-sauna";
const NORWEGIAN_4X4_ROUTE_ID = "norwegian-4x4";
const RED_LIGHT_GLASSES_ROUTE_ID = "red-light-glasses-before-bed";
const BRYAN_JOHNSON_SAUNA_ROUTE_ID = "bryan-johnson-blueprint";

const PROTOCOL_LIBRARY_ORDER = [
  FINNISH_SAUNA_ROUTE_ID,
  NORWEGIAN_4X4_ROUTE_ID,
  RED_LIGHT_GLASSES_ROUTE_ID,
  BRYAN_JOHNSON_SAUNA_ROUTE_ID,
] as const;

export function listHealthCommonsExperimentBrowseProtocols(): ExperimentProtocol[] {
  return getGeneratedExperimentIndex()
    .experiments
    .filter(isPublicExperimentIndexEntry)
    .map(toExperimentProtocolIndexEntry)
    .sort(compareExperimentProtocolOrder);
}

export function listHealthCommonsExperimentRouteParams(): { experimentId: string }[] {
  return getGeneratedExperimentIndex()
    .experiments
    .filter(isPublicExperimentIndexEntry)
    .map((entry) => ({ experimentId: entry.routeId }))
    .sort((left, right) => left.experimentId.localeCompare(right.experimentId));
}

function isPublicExperimentIndexEntry(entry: GeneratedExperimentIndexEntry): boolean {
  return entry.status !== "deprecated" && entry.hidden !== true;
}

function toExperimentProtocolIndexEntry(entry: GeneratedExperimentIndexEntry): ExperimentProtocol {
  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    id: entry.routeId,
    title: entry.title,
    category: entry.category,
    image: resolveExperimentRouteImage(entry.routeId, entry.image),
    durationDays: entry.durationDays,
    baselineDays: entry.baselineDays,
    studyCount: entry.studyCount,
    researchSummaryLabel: formatIndexResearchSummaryLabel(entry.studyCount),
    evidenceLevel: entry.evidenceLevel,
    evidenceLabel: entry.evidenceLabel,
    description: entry.description,
    expectedSignals: [],
    measurementPaths: [],
    protocolFacts: [],
    protocol: [],
    protocolTips: [],
    protocolKeepInMind: [],
    protocolLogFields: [],
    whyItWorks: entry.description,
    experts: [],
    researchStats: [],
    studies: [],
    safety: {
      cautionLevel: 1,
      precautions: [],
      whoShouldAvoid: [],
    },
    commons: {
      aliases: uniqueStrings([
        entry.routeId,
        entry.key,
        entry.key.replace(/^protocol_variant:/u, ""),
        entry.slug,
        entry.slug.split("/").at(-1) ?? null,
        ...entry.aliases,
      ]),
      catalogHash: getGeneratedExperimentIndex().catalogHash,
      key: entry.key,
      pageRevisionId: entry.revision.pageRevisionId,
      recipeHash: entry.revision.recipeHash ?? null,
      routeId: entry.routeId,
      runSpecRevisionId: entry.revision.runSpecRevisionId ?? null,
      slug: entry.slug,
    },
  };
}

function formatIndexResearchSummaryLabel(studyCount: number): string {
  if (studyCount === 0) {
    return "Research mapped";
  }

  return studyCount === 1 ? "1 study" : `${studyCount} studies`;
}

function compareExperimentProtocolOrder(
  left: ExperimentProtocol,
  right: ExperimentProtocol,
): number {
  const leftOrder = protocolLibraryOrder(left.id);
  const rightOrder = protocolLibraryOrder(right.id);

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.title.localeCompare(right.title);
}

function protocolLibraryOrder(protocolId: string): number {
  const order = PROTOCOL_LIBRARY_ORDER.findIndex((knownProtocolId) =>
    knownProtocolId === protocolId
  );

  return order === -1 ? Number.MAX_SAFE_INTEGER : order;
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    if (!value) continue;
    seen.add(value);
  }

  return [...seen];
}
