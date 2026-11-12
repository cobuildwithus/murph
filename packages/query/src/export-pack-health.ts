import {
  HEALTH_HISTORY_EVENT_KINDS,
  extractIsoDatePrefix,
} from "@murphai/contracts";

import { type CanonicalEntity } from "./canonical-entities.ts";
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
): ExportPackBankPage {
  return {
    id: entity.entityId,
    slug: entity.lookupIds.find((lookupId) => lookupId !== entity.entityId) ?? entity.entityId,
    title: entity.title,
    status: entity.status,
    relativePath: entity.path,
    markdown: "",
    body: entity.body ?? "",
    attributes: entity.attributes as FrontmatterObject,
  };
}

export function buildHealthContextFromVault(
  vault: VaultReadModel,
  filters: ExportPackFilters,
): ExportPackHealthContext {
  return {
    assessments: vault.assessments
      .map(assessmentRecordFromEntity)
      .filter((entry): entry is ExportPackAssessmentRecord => entry !== null)
      .filter((entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters))
      .sort(compareByRecordedOrImportedAtDescThenId),
    healthEvents: vault.events
      .map(exportPackHealthEventRecordFromEntity)
      .filter((entry): entry is ExportPackHealthEventRecord => entry !== null)
      .filter((entry) => matchesDateWindow(entry.occurredAt, filters))
      .sort(compareByOccurredAtDescThenId),
    goals: vault.goals.map(bankPageFromEntity),
    conditions: vault.conditions.map(bankPageFromEntity),
    allergies: vault.allergies.map(bankPageFromEntity),
    regimens: vault.regimens.map(bankPageFromEntity),
    familyMembers: vault.familyMembers.map(bankPageFromEntity),
    geneticVariants: vault.geneticVariants.map(bankPageFromEntity),
  };
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
