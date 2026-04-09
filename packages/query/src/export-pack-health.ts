import {
  HEALTH_HISTORY_EVENT_KINDS,
  extractIsoDatePrefix,
} from "@murphai/contracts";

import { type CanonicalEntity } from "./canonical-entities.ts";
import type { ParseFailure } from "./health/loaders.ts";
import { collectCanonicalEntities } from "./health/canonical-collector.ts";
import type { CanonicalHealthEntityCollection } from "./health/canonical-collector.ts";
import {
  compareByOccurredAtDescThenId,
  compareByRecordedOrImportedAtDescThenId,
} from "./health/comparators.ts";
import { assessmentRecordFromEntity } from "./health/projections.ts";
import type { FrontmatterObject } from "./health/shared.ts";
import type {
  ExportPackAssessmentRecord,
  ExportPackBankPage,
  ExportPackFilters,
  ExportPackHealthContext,
  ExportPackHealthEventRecord,
} from "./export-pack-health-types.ts";
import type { VaultReadModel } from "./model.ts";

const HEALTH_EVENT_KIND_SET = new Set<string>(HEALTH_HISTORY_EVENT_KINDS);

export interface ExportPackHealthReadResult {
  health: ExportPackHealthContext;
  failures: ParseFailure[];
}

function exportPackHealthEventRecordFromEntity(
  entity: CanonicalEntity,
): ExportPackHealthEventRecord | null {
  if (
    entity.family !== "event" ||
    !entity.occurredAt ||
    !HEALTH_EVENT_KIND_SET.has(entity.kind)
  ) {
    return null;
  }

  return {
    id: entity.entityId,
    kind: entity.kind,
    occurredAt: entity.occurredAt,
    recordedAt:
      typeof entity.attributes.recordedAt === "string"
        ? entity.attributes.recordedAt
        : null,
    source:
      typeof entity.attributes.source === "string"
        ? entity.attributes.source
        : null,
    title: entity.title ?? entity.entityId,
    status: entity.status,
    tags: entity.tags,
    relatedIds: entity.relatedIds,
    relativePath: entity.path,
    data: entity.attributes,
  };
}

function bankPageFromEntity(
  entity: CanonicalEntity,
  markdown: string,
): ExportPackBankPage {
  return {
    id: entity.entityId,
    slug: entity.lookupIds.find((lookupId) => lookupId !== entity.entityId) ?? entity.entityId,
    title: entity.title,
    status: entity.status,
    relativePath: entity.path,
    markdown,
    body: entity.body ?? "",
    attributes: entity.attributes as FrontmatterObject,
  };
}

function mapBankPages(
  entities: CanonicalEntity[],
  markdownByPath: ReadonlyMap<string, string>,
): ExportPackBankPage[] {
  return entities.map((entity) =>
    bankPageFromEntity(entity, markdownByPath.get(entity.path) ?? ""),
  );
}

function buildHealthContext(
  input: {
    assessments: readonly CanonicalEntity[];
    healthEvents: readonly CanonicalEntity[];
    goals: readonly CanonicalEntity[];
    conditions: readonly CanonicalEntity[];
    allergies: readonly CanonicalEntity[];
    protocols: readonly CanonicalEntity[];
    familyMembers: readonly CanonicalEntity[];
    geneticVariants: readonly CanonicalEntity[];
    markdownByPath?: ReadonlyMap<string, string>;
  },
  filters: ExportPackFilters,
): ExportPackHealthContext {
  const markdownByPath = input.markdownByPath ?? new Map<string, string>();

  return {
    assessments: input.assessments
      .map(assessmentRecordFromEntity)
      .filter((entry): entry is ExportPackAssessmentRecord => entry !== null)
      .filter((entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters))
      .sort(compareByRecordedOrImportedAtDescThenId),
    healthEvents: input.healthEvents
      .map(exportPackHealthEventRecordFromEntity)
      .filter((entry): entry is ExportPackHealthEventRecord => entry !== null)
      .filter((entry) => matchesDateWindow(entry.occurredAt, filters))
      .sort(compareByOccurredAtDescThenId),
    goals: mapBankPages([...input.goals], markdownByPath),
    conditions: mapBankPages([...input.conditions], markdownByPath),
    allergies: mapBankPages([...input.allergies], markdownByPath),
    protocols: mapBankPages([...input.protocols], markdownByPath),
    familyMembers: mapBankPages([...input.familyMembers], markdownByPath),
    geneticVariants: mapBankPages([...input.geneticVariants], markdownByPath),
  };
}

export function readHealthContext(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthReadResult {
  const collected = collectCanonicalEntities(vaultRoot, { mode: "strict-sync" });

  return {
    health: buildHealthContext(
      {
        assessments: collected.assessments,
        healthEvents: collected.entities.filter(
          (entity) => entity.family === "event",
        ),
        goals: collected.goals,
        conditions: collected.conditions,
        allergies: collected.allergies,
        protocols: collected.protocols,
        familyMembers: collected.familyMembers,
        geneticVariants: collected.geneticVariants,
        markdownByPath: collected.markdownByPath,
      },
      filters,
    ),
    failures: collected.failures,
  };
}

export function readHealthContextTolerant(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthContext {
  const collected = collectCanonicalEntities(vaultRoot, { mode: "tolerant-sync" });

  return buildHealthContext(
    {
      assessments: collected.assessments,
      healthEvents: collected.entities.filter(
        (entity) => entity.family === "event",
      ),
      goals: collected.goals,
      conditions: collected.conditions,
      allergies: collected.allergies,
      protocols: collected.protocols,
      familyMembers: collected.familyMembers,
      geneticVariants: collected.geneticVariants,
      markdownByPath: collected.markdownByPath,
    },
    filters,
  );
}

export function buildHealthContextFromVault(
  vault: VaultReadModel,
  filters: ExportPackFilters,
): ExportPackHealthContext {
  return buildHealthContext(
    {
      assessments: vault.assessments,
      healthEvents: vault.events,
      goals: vault.goals,
      conditions: vault.conditions,
      allergies: vault.allergies,
      protocols: vault.protocols,
      familyMembers: vault.familyMembers,
      geneticVariants: vault.geneticVariants,
    },
    filters,
  );
}

function matchesDateWindow(
  value: string | null,
  filters: ExportPackFilters,
): boolean {
  if (!value) {
    return false;
  }

  const comparable = extractIsoDatePrefix(value);
  if (!comparable) {
    return false;
  }
  if (filters.from && comparable < filters.from) {
    return false;
  }

  if (filters.to && comparable > filters.to) {
    return false;
  }

  return true;
}
