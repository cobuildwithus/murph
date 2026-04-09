import {
  HEALTH_HISTORY_EVENT_KINDS,
  collapseEventRevisions,
  type EventRevisionCollapseFields,
} from "@murphai/contracts";

import {
  compareCanonicalEntities,
  isCanonicalEntityLinkType,
  linkTargetIds,
  normalizeCanonicalDate,
  normalizeCanonicalLinks,
  resolveCanonicalRecordClass,
  uniqueStrings,
  type CanonicalEntity,
} from "../../canonical-entities.ts";
import { asObject, firstString, firstStringArray } from "../shared.ts";

export const HEALTH_HISTORY_KINDS = new Set(HEALTH_HISTORY_EVENT_KINDS);

function eventLedgerEntityRevisionFields(
  entity: CanonicalEntity,
): EventRevisionCollapseFields {
  const attributes = asObject(entity.attributes);
  return {
    eventId: entity.primaryLookupId,
    lifecycle: attributes?.lifecycle,
    recordedAt: attributes ? firstString(attributes, ["recordedAt"]) ?? "" : "",
    occurredAt: entity.occurredAt ?? "",
    relativePath: entity.path,
  };
}

export function collapseEventLedgerEntities(
  entities: readonly CanonicalEntity[],
): CanonicalEntity[] {
  return collapseEventRevisions(entities, eventLedgerEntityRevisionFields)
    .sort(compareCanonicalEntities);
}

export function projectHistoryEntity(
  value: unknown,
  relativePath: string,
): CanonicalEntity | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const id = firstString(source, ["id"]);
  const kind = firstString(source, ["kind"]);
  const occurredAt = firstString(source, ["occurredAt"]);
  const title = firstString(source, ["title"]);

  if (
    !id?.startsWith("evt_") ||
    !kind ||
    !HEALTH_HISTORY_KINDS.has(
      kind as (typeof HEALTH_HISTORY_KINDS extends Set<infer TValue> ? TValue : never),
    ) ||
    !occurredAt ||
    !title
  ) {
    return null;
  }

  const explicitLinks = source.links;
  const links =
    Array.isArray(explicitLinks)
      ? normalizeCanonicalLinks(
          explicitLinks.flatMap((entry) => {
            const link = asObject(entry);
            const type = link ? firstString(link, ["type"]) : null;
            const targetId = link ? firstString(link, ["targetId"]) : null;

            if (!type || !targetId || !isCanonicalEntityLinkType(type)) {
              return [];
            }

            return [{ type, targetId }];
          }),
        )
      : normalizeCanonicalLinks(
          firstStringArray(source, ["relatedIds"]).map((targetId) => ({
            type: "related_to" as const,
            targetId,
          })),
        );
  const tags = firstStringArray(source, ["tags"]);
  const status =
    kind === "test"
      ? firstString(source, ["resultStatus", "status"])
      : firstString(source, ["status", "severity"]);

  return {
    entityId: id,
    primaryLookupId: id,
    lookupIds: uniqueStrings([id]),
    family: "event",
    recordClass: resolveCanonicalRecordClass("event"),
    kind,
    status,
    occurredAt,
    date: firstString(source, ["dayKey"]) ?? normalizeCanonicalDate(occurredAt),
    path: relativePath,
    title,
    body: firstString(source, ["note", "summary"]),
    attributes: source,
    frontmatter: null,
    links,
    relatedIds: linkTargetIds(links),
    stream: null,
    experimentSlug: null,
    tags,
  };
}
