import type { CanonicalEntity, CanonicalEntityFamily } from "../canonical-entities.ts";
import {
  buildOverviewMetrics,
  type OverviewExperiment,
  type OverviewExperimentSummary,
  summarizeRecentOverviewJournals,
} from "../overview.ts";
import type { VaultReadModel } from "../read-model.ts";
import { emptyPersonalPatternReport } from "../personal-patterns.ts";
import {
  selectBrowserVaultExperimentSummary as selectExperimentSummaryFromReplica,
  selectBrowserVaultTrackedExperiments as selectTrackedExperimentsFromReplica,
} from "./tracked-experiments.ts";
import {
  RECENT_JOURNAL_LIMIT,
  TIMELINE_LIMIT,
  type BrowserVaultEntity,
  type BrowserVaultOverviewView,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
  type BrowserVaultTimelineRow,
} from "./shared.ts";

export function selectBrowserVaultOverview(client: BrowserVaultQueryClient): BrowserVaultOverviewView {
  const vault = vaultViewFromReplica(client.replica);
  return {
    experimentSummary: selectExperimentSummaryFromReplica(client),
    metrics: buildOverviewMetrics(vault),
    personalPatterns: client.replica.personalPatterns
      ?? emptyPersonalPatternReport(client.replica.generatedAt.slice(0, 10)),
    recentJournals: summarizeRecentOverviewJournals(vault, RECENT_JOURNAL_LIMIT),
    trackedExperiments: selectTrackedExperimentsFromReplica(client),
    weeklySampleSummaries: client.replica.weeklySampleSummaries.slice(),
  };
}

export function selectBrowserVaultHistory(client: BrowserVaultQueryClient): { timeline: BrowserVaultTimelineRow[] } {
  return { timeline: client.timeline.list().slice(0, TIMELINE_LIMIT) };
}

export function selectBrowserVaultTrackedExperiments(client: BrowserVaultQueryClient): OverviewExperiment[] {
  return selectTrackedExperimentsFromReplica(client);
}

export function selectBrowserVaultExperimentSummary(client: BrowserVaultQueryClient): OverviewExperimentSummary {
  return selectExperimentSummaryFromReplica(client);
}

function vaultViewFromReplica(replica: BrowserVaultReplica): VaultReadModel {
  const byFamily: Partial<Record<CanonicalEntityFamily, CanonicalEntity[]>> = {};
  const entities = replica.entities.map(entityFromBrowserEntity);
  for (const entity of entities) {
    byFamily[entity.family] = byFamily[entity.family] ?? [];
    byFamily[entity.family]?.push(entity);
  }
  return {
    allergies: byFamily.allergy ?? [],
    assessments: byFamily.assessment ?? [],
    audits: [],
    byFamily,
    conditions: byFamily.condition ?? [],
    coreDocument: null,
    entities,
    events: byFamily.event ?? [],
    experiments: byFamily.experiment ?? [],
    familyMembers: byFamily.family ?? [],
    foods: [],
    format: "murph.query.v1",
    geneticVariants: byFamily.genetics ?? [],
    goals: byFamily.goal ?? [],
    habitatAspects: byFamily.habitat ?? [],
    journalEntries: byFamily.journal ?? [],
    metadata: null,
    protocols: byFamily.protocol ?? [],
    providers: byFamily.provider ?? [],
    regimens: byFamily.regimen ?? [],
    recipes: [],
    samples: byFamily.sample ?? [],
    vaultRoot: "browser-vault-replica",
    workoutFormats: byFamily.workout_format ?? [],
  };
}

function entityFromBrowserEntity(entity: BrowserVaultEntity): CanonicalEntity {
  return {
    attributes: cloneRecord(entity.attributes),
    body: entity.bodyPreview,
    date: entity.date,
    entityId: entity.id,
    experimentSlug: entity.experimentSlug,
    family: entity.family as CanonicalEntityFamily,
    frontmatter: cloneRecord(entity.attributes),
    kind: entity.kind,
    links: entity.links.map((link) => ({ targetId: link.targetId, type: link.type as CanonicalEntity["links"][number]["type"] })),
    lookupIds: entity.lookupIds.slice(),
    occurredAt: entity.occurredAt,
    path: `browser://${entity.id}`,
    primaryLookupId: entity.lookupIds[0] ?? entity.id,
    recordClass: entity.recordClass,
    relatedIds: entity.links.map((link) => link.targetId),
    status: entity.status,
    stream: entity.stream,
    tags: entity.tags.slice(),
    title: entity.title,
  };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isBrowserSafeJson(entry)) output[key] = JSON.parse(JSON.stringify(entry));
  }
  return output;
}

function isBrowserSafeJson(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isBrowserSafeJson);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isBrowserSafeJson);
  return false;
}
