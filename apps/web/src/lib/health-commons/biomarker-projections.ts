import { getGeneratedHealthCommonsWebBiomarkerIndex } from "@murphai/health-commons/runtime";
import type {
  HealthCommonsWebBiomarkerOverview,
  HealthCommonsWebBiomarkerResearch,
  HealthCommonsWebBiomarkerShell,
} from "@murphai/health-commons/runtime";
import type { HealthCommonsBiomarkerDesiredDirection } from "@murphai/contracts";

import {
  cleanHealthCommonsUserFacingCopy,
  cleanHealthCommonsUserFacingCopyList,
  cleanOptionalHealthCommonsUserFacingCopy,
} from "./user-facing-copy";
import {
  loadGeneratedBiomarkerOverview,
  loadGeneratedBiomarkerResearch,
  loadGeneratedBiomarkerShell,
} from "./generated-biomarker-artifacts";

export type BiomarkerShellProjection = HealthCommonsWebBiomarkerShell;
export type BiomarkerOverviewProjection = HealthCommonsWebBiomarkerOverview;
export type BiomarkerResearchProjection = HealthCommonsWebBiomarkerResearch;
export type BiomarkerAboutItemModel = HealthCommonsWebBiomarkerShell["about"][number];
export type BiomarkerProtocolRankingModel =
  HealthCommonsWebBiomarkerOverview["protocolRankings"][number];
export type BiomarkerSourceModel = HealthCommonsWebBiomarkerResearch["sourceHighlights"][number];
export type BiomarkerClaimModel = HealthCommonsWebBiomarkerResearch["claims"][number];

export function listHealthCommonsBiomarkerRoutes(): string[] {
  return getGeneratedHealthCommonsWebBiomarkerIndex()
    .biomarkers
    .filter((entry) => entry.published && !entry.hidden)
    .map((entry) => entry.routeId)
    .sort();
}

let biomarkerDesiredDirectionByKey: Map<
  string,
  HealthCommonsBiomarkerDesiredDirection
> | null = null;

export function resolveBiomarkerDesiredDirection(
  biomarkerKey: string,
): HealthCommonsBiomarkerDesiredDirection | null {
  if (biomarkerDesiredDirectionByKey === null) {
    const map = new Map<string, HealthCommonsBiomarkerDesiredDirection>();
    for (const entry of getGeneratedHealthCommonsWebBiomarkerIndex().biomarkers) {
      if (entry.desiredDirection) {
        map.set(entry.key, entry.desiredDirection);
      }
    }
    biomarkerDesiredDirectionByKey = map;
  }
  return biomarkerDesiredDirectionByKey.get(biomarkerKey) ?? null;
}

export function resolveHealthCommonsBiomarkerShell(
  biomarkerId: string,
): BiomarkerShellProjection | null {
  const shell = loadGeneratedBiomarkerShell(biomarkerId);

  return shell ? cleanBiomarkerShell(shell) : null;
}

export function resolveHealthCommonsBiomarkerOverview(
  biomarkerId: string,
): BiomarkerOverviewProjection | null {
  const overview = loadGeneratedBiomarkerOverview(biomarkerId);

  return overview ? cleanBiomarkerOverview(overview) : null;
}

export function resolveHealthCommonsBiomarkerResearch(
  biomarkerId: string,
): BiomarkerResearchProjection | null {
  const research = loadGeneratedBiomarkerResearch(biomarkerId);

  return research ? cleanBiomarkerResearch(research) : null;
}

function cleanBiomarkerShell(shell: HealthCommonsWebBiomarkerShell): BiomarkerShellProjection {
  return {
    ...shell,
    about: shell.about.map((item) => ({
      ...item,
      body: cleanHealthCommonsUserFacingCopy(item.body),
      title: cleanHealthCommonsUserFacingCopy(item.title),
    })),
    shortName: cleanHealthCommonsUserFacingCopy(shell.shortName),
    summary: cleanHealthCommonsUserFacingCopy(shell.summary),
    title: cleanHealthCommonsUserFacingCopy(shell.title),
    unit: cleanHealthCommonsUserFacingCopy(shell.unit),
  };
}

function cleanBiomarkerOverview(
  overview: HealthCommonsWebBiomarkerOverview,
): BiomarkerOverviewProjection {
  const placeholder = cleanOptionalHealthCommonsUserFacingCopy(
    overview.communityOutcomeSummary.placeholder,
  );

  return {
    ...overview,
    communityOutcomeSummary: {
      ...overview.communityOutcomeSummary,
      ...(placeholder ? { placeholder } : {}),
    },
    privateMetricBindings: overview.privateMetricBindings,
    protocolRankingFormula: cleanHealthCommonsUserFacingCopy(overview.protocolRankingFormula),
    protocolRankings: overview.protocolRankings.map(cleanBiomarkerProtocolRanking),
    shortName: cleanHealthCommonsUserFacingCopy(overview.shortName),
    summary: cleanHealthCommonsUserFacingCopy(overview.summary),
    title: cleanHealthCommonsUserFacingCopy(overview.title),
    unit: cleanHealthCommonsUserFacingCopy(overview.unit),
  };
}

function cleanBiomarkerResearch(
  research: HealthCommonsWebBiomarkerResearch,
): BiomarkerResearchProjection {
  return {
    ...research,
    body: cleanHealthCommonsUserFacingCopy(research.body),
    claims: research.claims.map((claim) => ({
      ...claim,
      caveats: cleanHealthCommonsUserFacingCopyList(claim.caveats),
      sources: claim.sources.map(cleanBiomarkerSource),
      text: cleanHealthCommonsUserFacingCopy(claim.text),
    })),
    shortName: cleanHealthCommonsUserFacingCopy(research.shortName),
    sourceHighlights: research.sourceHighlights.map(cleanBiomarkerSource),
    title: cleanHealthCommonsUserFacingCopy(research.title),
  };
}

function cleanBiomarkerProtocolRanking(
  ranking: BiomarkerProtocolRankingModel,
): BiomarkerProtocolRankingModel {
  return {
    ...ranking,
    burdenLabel: cleanHealthCommonsUserFacingCopy(ranking.burdenLabel),
    category: cleanHealthCommonsUserFacingCopy(ranking.category),
    cautionLabel: cleanHealthCommonsUserFacingCopy(ranking.cautionLabel),
    description: cleanHealthCommonsUserFacingCopy(ranking.description),
    durationLabel: cleanHealthCommonsUserFacingCopy(ranking.durationLabel),
    evidenceLabel: cleanHealthCommonsUserFacingCopy(ranking.evidenceLabel),
    expectedSignalLabel: cleanHealthCommonsUserFacingCopy(ranking.expectedSignalLabel),
    fitLabel: ranking.fitLabel,
    mechanism: cleanHealthCommonsUserFacingCopy(ranking.mechanism),
    title: cleanHealthCommonsUserFacingCopy(ranking.title),
  };
}

function cleanBiomarkerSource(source: BiomarkerSourceModel): BiomarkerSourceModel {
  const cleanCitation = cleanOptionalHealthCommonsUserFacingCopy(source.citation);

  return {
    ...source,
    citation: cleanCitation ?? null,
    evidenceLabel: cleanHealthCommonsUserFacingCopy(source.evidenceLabel),
    summary: cleanHealthCommonsUserFacingCopy(source.summary),
    title: cleanHealthCommonsUserFacingCopy(source.title),
    typeLabel: cleanHealthCommonsUserFacingCopy(source.typeLabel),
  };
}
