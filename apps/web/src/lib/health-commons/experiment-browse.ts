import { isRunnableProtocolStatus } from "@murphai/health-commons/runtime";

import {
  CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
} from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";
import { resolveExperimentRouteImage } from "./experiment-images";
import {
  getGeneratedExperimentIndex,
  type GeneratedExperimentIndexEntry,
} from "./generated-experiment-artifacts";
import { cleanHealthCommonsUserFacingCopy } from "./user-facing-copy";

export function listHealthCommonsExperimentBrowseProtocols(): ExperimentProtocol[] {
  return getGeneratedExperimentIndex()
    .experiments
    .filter(isPublicExperimentIndexEntry)
    .sort(compareExperimentIndexEntries)
    .map(toExperimentProtocolIndexEntry);
}

export function listHealthCommonsExperimentRouteParams(): { experimentId: string }[] {
  return getGeneratedExperimentIndex()
    .experiments
    .filter(isPublicExperimentIndexEntry)
    .map((entry) => ({ experimentId: entry.routeId }))
    .sort((left, right) => left.experimentId.localeCompare(right.experimentId));
}

function isPublicExperimentIndexEntry(entry: GeneratedExperimentIndexEntry): boolean {
  return isRunnableProtocolStatus(entry.status) && entry.hidden !== true;
}

function toExperimentProtocolIndexEntry(entry: GeneratedExperimentIndexEntry): ExperimentProtocol {
  const description = cleanHealthCommonsUserFacingCopy(entry.description);

  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    id: entry.routeId,
    title: cleanHealthCommonsUserFacingCopy(entry.title),
    category: cleanHealthCommonsUserFacingCopy(entry.category),
    image: resolveExperimentRouteImage(entry.routeId, entry.image),
    durationDays: entry.durationDays,
    baselineDays: entry.baselineDays,
    studyCount: entry.studyCount,
    researchSummaryLabel: formatIndexResearchSummaryLabel(entry.studyCount),
    evidenceLevel: entry.evidenceLevel,
    evidenceLabel: entry.evidenceLabel,
    description,
    expectedSignals: [],
    measurementPaths: [],
    protocolFacts: [],
    protocol: [],
    protocolTips: [],
    protocolKeepInMind: [],
    protocolLogFields: [],
    mechanismChain: [],
    whyItWorks: description,
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

function compareExperimentIndexEntries(
  left: GeneratedExperimentIndexEntry,
  right: GeneratedExperimentIndexEntry,
): number {
  const leftOrder = left.sortRank ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sortRank ?? Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.title.localeCompare(right.title);
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    if (!value) continue;
    seen.add(value);
  }

  return [...seen];
}
