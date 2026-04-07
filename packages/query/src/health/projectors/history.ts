import {
  HEALTH_HISTORY_EVENT_KINDS,
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
import {
  asObject,
  firstString,
  firstStringArray,
} from "../shared.ts";

interface CanonicalEventLifecycle {
  revision: number;
  state?: "deleted";
}

type CanonicalEventLifecycleParseResult =
  | {
      state: "missing";
    }
  | {
      state: "invalid";
    }
  | {
      state: "valid";
      lifecycle: CanonicalEventLifecycle;
    };

export const HEALTH_HISTORY_KINDS = new Set(HEALTH_HISTORY_EVENT_KINDS);

function parseCanonicalEventLifecycle(
  value: unknown,
): CanonicalEventLifecycleParseResult {
  if (value === undefined) {
    return { state: "missing" };
  }

  const lifecycle = asObject(value);
  if (!lifecycle) {
    return { state: "invalid" };
  }

  const revision = lifecycle.revision;
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    return { state: "invalid" };
  }

  const state = firstString(lifecycle, ["state"]);
  if (state && state !== "deleted") {
    return { state: "invalid" };
  }

  return {
    state: "valid",
    lifecycle: {
      revision,
      state: state as "deleted" | undefined,
    },
  };
}

function canonicalEventRevision(entity: Pick<CanonicalEntity, "attributes">): number {
  const lifecycle = parseCanonicalEventLifecycle(
    asObject(entity.attributes)?.lifecycle,
  );
  return lifecycle.state === "valid" ? lifecycle.lifecycle.revision : 1;
}

function isCanonicalEntityDeleted(entity: Pick<CanonicalEntity, "attributes">): boolean {
  const lifecycle = parseCanonicalEventLifecycle(
    asObject(entity.attributes)?.lifecycle,
  );
  return lifecycle.state === "valid" && lifecycle.lifecycle.state === "deleted";
}

function hasInvalidCanonicalEntityLifecycle(
  entity: Pick<CanonicalEntity, "attributes">,
): boolean {
  return (
    parseCanonicalEventLifecycle(asObject(entity.attributes)?.lifecycle).state === "invalid"
  );
}

function compareEventLedgerEntityPriority(
  left: CanonicalEntity,
  right: CanonicalEntity,
): number {
  const revisionComparison = canonicalEventRevision(left) - canonicalEventRevision(right);
  if (revisionComparison !== 0) {
    return revisionComparison;
  }

  const leftAttributes = asObject(left.attributes);
  const rightAttributes = asObject(right.attributes);
  const leftRecordedAt = leftAttributes
    ? firstString(leftAttributes, ["recordedAt"]) ?? ""
    : "";
  const rightRecordedAt = rightAttributes
    ? firstString(rightAttributes, ["recordedAt"]) ?? ""
    : "";
  const recordedAtComparison = leftRecordedAt.localeCompare(rightRecordedAt);
  if (recordedAtComparison !== 0) {
    return recordedAtComparison;
  }

  const occurredAtComparison = (left.occurredAt ?? "").localeCompare(right.occurredAt ?? "");
  if (occurredAtComparison !== 0) {
    return occurredAtComparison;
  }

  return left.path.localeCompare(right.path);
}

export function collapseEventLedgerEntities(
  entities: readonly CanonicalEntity[],
): CanonicalEntity[] {
  const latestByEventId = new Map<string, CanonicalEntity>();

  for (const entity of entities) {
    if (hasInvalidCanonicalEntityLifecycle(entity)) {
      continue;
    }

    const current = latestByEventId.get(entity.primaryLookupId);
    if (!current || compareEventLedgerEntityPriority(current, entity) < 0) {
      latestByEventId.set(entity.primaryLookupId, entity);
    }
  }

  return [...latestByEventId.values()]
    .filter((entity) => !isCanonicalEntityDeleted(entity))
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
    family: "history",
    recordClass: resolveCanonicalRecordClass("history"),
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
