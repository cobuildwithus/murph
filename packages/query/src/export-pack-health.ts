import { extractIsoDatePrefix } from "@murphai/contracts";

import { type CanonicalEntity } from "./canonical-entities.ts";
import type { ParseFailure } from "./health/loaders.ts";
import { collectCanonicalEntities } from "./health/canonical-collector.ts";
import {
  compareByOccurredAtDescThenId,
  compareByRecordedOrImportedAtDescThenId,
} from "./health/comparators.ts";
import {
  assessmentRecordFromEntity,
  historyRecordFromEntity,
} from "./health/projections.ts";

import type { FrontmatterObject } from "./health/shared.ts";
import type {
  ExportPackAssessmentRecord,
  ExportPackBankPage,
  ExportPackFilters,
  ExportPackHealthContext,
  ExportPackHistoryRecord,
} from "./export-pack-health-types.ts";

export interface ExportPackHealthReadResult {
  health: ExportPackHealthContext;
  failures: ParseFailure[];
}

function exportPackHistoryRecordFromEntity(
  entity: CanonicalEntity,
): ExportPackHistoryRecord | null {
  const record = historyRecordFromEntity(entity);
  if (!record) {
    return null;
  }

  return {
    ...record,
    kind: record.kind,
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

export function readHealthContext(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthReadResult {
  const collected = collectCanonicalEntities(vaultRoot, { mode: "tolerant-sync" });

  return {
    health: {
      assessments: collected.assessments
        .map(assessmentRecordFromEntity)
        .filter((entry): entry is ExportPackAssessmentRecord => entry !== null)
        .filter((entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters))
        .sort(compareByRecordedOrImportedAtDescThenId),
      historyEvents: collected.history
        .map(exportPackHistoryRecordFromEntity)
        .filter((entry): entry is ExportPackHistoryRecord => entry !== null)
        .filter((entry) => matchesDateWindow(entry.occurredAt, filters))
        .sort(compareByOccurredAtDescThenId),
      goals: mapBankPages(collected.goals, collected.markdownByPath),
      conditions: mapBankPages(collected.conditions, collected.markdownByPath),
      allergies: mapBankPages(collected.allergies, collected.markdownByPath),
      protocols: mapBankPages(collected.protocols, collected.markdownByPath),
      familyMembers: mapBankPages(collected.familyMembers, collected.markdownByPath),
      geneticVariants: mapBankPages(collected.geneticVariants, collected.markdownByPath),
    },
    failures: collected.failures,
  };
}

export function readHealthContextTolerant(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthContext {
  return readHealthContext(vaultRoot, filters).health;
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
