import {
  extractHealthEntityRegistryLinks,
  goalRegistryEntityDefinition,
  type GoalFrontmatter,
} from "@murphai/contracts";

import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  GOAL_DOC_TYPE,
  GOAL_HORIZONS,
  GOALS_DIRECTORY,
  GOAL_SCHEMA_VERSION,
  GOAL_STATUSES,
} from "./types.ts";
import {
  buildMarkdownBody,
  detailList,
  listSection,
  normalizeDateOnly,
  normalizeDomainList,
  normalizePriority,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUpsertSelectorSlug,
  optionalDateOnly,
  optionalEnum,
  resolveOptionalUpsertValue,
  resolveRequiredUpsertValue,
  requireMatchingDocType,
  requireObject,
  requireString,
  section,
  stripUndefined,
  normalizeId,
} from "./shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  GoalEntity,
  GoalLink,
  GoalLinkType,
  GoalStoredDocument,
  GoalWindow,
  ReadGoalInput,
  UpsertGoalInput,
  UpsertGoalResult,
} from "./types.ts";

function normalizeGoalWindow(value: unknown, fieldName: string): GoalWindow {
  const candidate = requireObject(value, fieldName);
  const startAt = normalizeDateOnly(candidate.startAt as string, `${fieldName}.startAt`);
  const targetAt = optionalDateOnly(candidate.targetAt as string | undefined, `${fieldName}.targetAt`);

  if (targetAt && targetAt < startAt) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName}.targetAt must be on or after startAt.`);
  }

  return stripUndefined({
    startAt,
    targetAt,
  });
}

function parseGoalFrontmatter(attributes: FrontmatterObject): GoalFrontmatter {
  const schema = goalRegistryEntityDefinition.registry.frontmatterSchema;

  if (!schema) {
    throw new Error("Goal registry definition is missing a frontmatter schema.");
  }

  const result = schema.safeParse(attributes);

  if (!result.success) {
    throw new VaultError("VAULT_INVALID_GOAL", "Goal registry document has an unexpected shape.");
  }

  return result.data as GoalFrontmatter;
}

function normalizeGoalLinkType(value: string): GoalLinkType | null {
  switch (value) {
    case "parent_goal":
    case "related_goal":
    case "related_experiment":
      return value;
    default:
      return null;
  }
}

function compareGoalLinks(left: GoalLink, right: GoalLink): number {
  const order: Record<GoalLinkType, number> = {
    parent_goal: 0,
    related_goal: 1,
    related_experiment: 2,
  };

  return order[left.type] - order[right.type] || left.targetId.localeCompare(right.targetId);
}

function buildGoalLinksFromFields(input: {
  parentGoalId?: string | null;
  relatedGoalIds?: string[];
  relatedExperimentIds?: string[];
}): GoalLink[] {
  return [
    ...(input.parentGoalId ? [{ type: "parent_goal", targetId: input.parentGoalId } satisfies GoalLink] : []),
    ...(input.relatedGoalIds ?? []).map((targetId) => ({ type: "related_goal", targetId }) satisfies GoalLink),
    ...(input.relatedExperimentIds ?? []).map((targetId) => ({
      type: "related_experiment",
      targetId,
    }) satisfies GoalLink),
  ];
}

function normalizeGoalLinks(rawLinks: readonly GoalLink[], goalId: string): GoalLink[] {
  const sortedLinks = [...rawLinks].sort(compareGoalLinks);
  const links: GoalLink[] = [];
  let parentGoalId: string | null = null;
  const seen = new Set<string>();

  for (const link of sortedLinks) {
    if (link.type === "parent_goal" && link.targetId === goalId) {
      throw new VaultError("VAULT_INVALID_INPUT", "parentGoalId may not equal goalId.");
    }

    if (link.type === "related_goal" && link.targetId === goalId) {
      throw new VaultError("VAULT_INVALID_INPUT", "relatedGoalIds may not include goalId.");
    }

    if (link.type === "parent_goal") {
      if (parentGoalId && parentGoalId !== link.targetId) {
        throw new VaultError("VAULT_INVALID_INPUT", "Goal may not reference multiple parentGoalId values.");
      }

      parentGoalId = link.targetId;
    }

    const dedupeKey = `${link.type}:${link.targetId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    links.push(link);
  }

  return links;
}

function parseGoalLinks(attributes: FrontmatterObject, goalId: string): GoalLink[] {
  const rawLinks = extractHealthEntityRegistryLinks("goal", attributes)
    .flatMap((link) => {
      const type = normalizeGoalLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies GoalLink] : [];
    });

  return normalizeGoalLinks(rawLinks, goalId);
}

function goalRelationsFromLinks(
  links: readonly GoalLink[],
  options: { parentGoalFallback?: string | null } = {},
): Pick<GoalEntity, "parentGoalId" | "relatedGoalIds" | "relatedExperimentIds" | "links"> {
  const parentGoalId =
    links.find((link) => link.type === "parent_goal")?.targetId ?? options.parentGoalFallback;
  const relatedGoalIds = links
    .filter((link) => link.type === "related_goal")
    .map((link) => link.targetId);
  const relatedExperimentIds = links
    .filter((link) => link.type === "related_experiment")
    .map((link) => link.targetId);

  return {
    parentGoalId,
    relatedGoalIds: relatedGoalIds.length > 0 ? relatedGoalIds : undefined,
    relatedExperimentIds: relatedExperimentIds.length > 0 ? relatedExperimentIds : undefined,
    links: [...links],
  };
}

function canonicalizeGoalRelations(input: {
  goalId: string;
  links?: readonly GoalLink[];
  parentGoalId?: string | null;
  relatedGoalIds?: string[];
  relatedExperimentIds?: string[];
}): Pick<GoalEntity, "parentGoalId" | "relatedGoalIds" | "relatedExperimentIds" | "links"> {
  const links = normalizeGoalLinks(
    (input.links?.length ?? 0) > 0
      ? [...(input.links ?? [])]
      : buildGoalLinksFromFields({
          parentGoalId: input.parentGoalId,
          relatedGoalIds: input.relatedGoalIds,
          relatedExperimentIds: input.relatedExperimentIds,
        }),
    input.goalId,
  );

  return goalRelationsFromLinks(links, {
    parentGoalFallback: input.parentGoalId === null ? null : undefined,
  });
}

function buildBody(record: GoalEntity): string {
  const relations = canonicalizeGoalRelations(record);

  return buildMarkdownBody(
    record.title,
    detailList([
      ["Status", record.status],
      ["Horizon", record.horizon],
      ["Priority", record.priority],
    ]),
    [
      section(
        "Window",
        detailList([
          ["Start", record.window.startAt],
          ["Target", record.window.targetAt],
        ]),
      ),
      section(
        "Relationships",
        detailList([
          ["Parent goal", relations.parentGoalId],
        ]),
      ),
      listSection("Related Goals", relations.relatedGoalIds),
      listSection("Related Experiments", relations.relatedExperimentIds),
      listSection("Domains", record.domains),
    ],
  );
}

function parseGoalStoredDocument(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): GoalStoredDocument {
  const parsed = parseGoalFrontmatter(attributes);
  requireMatchingDocType(
    parsed as unknown as FrontmatterObject,
    GOAL_SCHEMA_VERSION,
    GOAL_DOC_TYPE,
    "VAULT_INVALID_GOAL",
    "Goal registry document has an unexpected shape.",
  );
  const links = parseGoalLinks(attributes, parsed.goalId);
  const relations = canonicalizeGoalRelations({
    goalId: parsed.goalId,
    links,
    parentGoalId: parsed.parentGoalId === null ? null : undefined,
  });

  const entity = stripUndefined({
    schemaVersion: GOAL_SCHEMA_VERSION,
    docType: GOAL_DOC_TYPE,
    goalId: requireString(parsed.goalId, "goalId", 64),
    slug: requireString(parsed.slug, "slug", 160),
    title: requireString(parsed.title, "title", 160),
    status: optionalEnum(parsed.status, GOAL_STATUSES, "status") ?? "active",
    horizon: optionalEnum(parsed.horizon, GOAL_HORIZONS, "horizon") ?? "ongoing",
    priority: normalizePriority(parsed.priority),
    window: normalizeGoalWindow(parsed.window, "window"),
    ...relations,
    domains: normalizeDomainList(parsed.domains, "domains"),
  }) as GoalEntity;

  return {
    entity,
    document: {
      relativePath,
      markdown,
    },
  };
}

function buildAttributes(record: GoalEntity): FrontmatterObject {
  const relations = canonicalizeGoalRelations(record);

  return stripUndefined({
    schemaVersion: GOAL_SCHEMA_VERSION,
    docType: GOAL_DOC_TYPE,
    goalId: record.goalId,
    slug: record.slug,
    title: record.title,
    status: record.status,
    horizon: record.horizon,
    priority: record.priority,
    window: stripUndefined({
      startAt: record.window.startAt,
      targetAt: record.window.targetAt,
    }) as FrontmatterObject,
    parentGoalId: relations.parentGoalId,
    relatedGoalIds: relations.relatedGoalIds,
    relatedExperimentIds: relations.relatedExperimentIds,
    domains: record.domains,
  }) as FrontmatterObject;
}

const goalRegistryApi = createMarkdownRegistryApi<GoalStoredDocument>({
  directory: GOALS_DIRECTORY,
  recordFromParts: parseGoalStoredDocument,
  isExpectedRecord: (record) =>
    record.entity.docType === GOAL_DOC_TYPE && record.entity.schemaVersion === GOAL_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_GOAL",
  invalidMessage: "Goal registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) =>
        right.entity.priority - left.entity.priority ||
        left.entity.window.startAt.localeCompare(right.entity.window.startAt) ||
        left.entity.title.localeCompare(right.entity.title) ||
        left.entity.goalId.localeCompare(right.entity.goalId),
    ),
  getRecordId: (record) => record.entity.goalId,
  getRecordSlug: (record) => record.entity.slug,
  getRecordRelativePath: (record) => record.document.relativePath,
  conflictCode: "VAULT_GOAL_CONFLICT",
  conflictMessage: "Goal id and slug resolve to different records.",
  readMissingCode: "VAULT_GOAL_MISSING",
  readMissingMessage: "Goal was not found.",
  createRecordId: () => generateRecordId("goal"),
  operationType: "goal_upsert",
  summary: (recordId) => `Upsert goal ${recordId}`,
  audit: {
    action: "goal_upsert",
    commandName: "core.upsertGoal",
    summary: (_created, recordId) => `Upserted goal ${recordId}.`,
  },
});

function ensureGoalLinks(record: GoalEntity): GoalEntity {
  return {
    ...record,
    ...canonicalizeGoalRelations(record),
  };
}

export async function upsertGoal(input: UpsertGoalInput): Promise<UpsertGoalResult> {
  const normalizedGoalId = normalizeId(input.goalId, "goalId", "goal");
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = await goalRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedGoalId,
    slug: requestedSlug,
  });
  const existingEntity = existingRecord?.entity;
  const title = requireString(input.title ?? existingEntity?.title, "title", 160);
  const existingWindow = existingEntity?.window;
  return goalRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedGoalId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    buildDocument: (target) => {
      const parentGoalId = resolveOptionalUpsertValue(
        input.parentGoalId,
        existingEntity?.parentGoalId,
        (value) => (value === null ? null : normalizeId(value, "parentGoalId", "goal")),
      );
      const relatedGoalIds = resolveOptionalUpsertValue(
        input.relatedGoalIds,
        existingEntity?.relatedGoalIds,
        (value) => normalizeRecordIdList(value, "relatedGoalIds", "goal"),
      );
      const relatedExperimentIds = resolveOptionalUpsertValue(
        input.relatedExperimentIds,
        existingEntity?.relatedExperimentIds,
        (value) => normalizeRecordIdList(value, "relatedExperimentIds", "exp"),
      );
      const entity = ensureGoalLinks(
        stripUndefined({
          schemaVersion: GOAL_SCHEMA_VERSION,
          docType: GOAL_DOC_TYPE,
          goalId: target.recordId,
          slug: target.slug,
          title,
          status: resolveRequiredUpsertValue(input.status, existingEntity?.status, "active", (value) =>
            optionalEnum(value, GOAL_STATUSES, "status") ?? "active",
          ),
          horizon: resolveRequiredUpsertValue(input.horizon, existingEntity?.horizon, "ongoing", (value) =>
            optionalEnum(value, GOAL_HORIZONS, "horizon") ?? "ongoing",
          ),
          priority: resolveRequiredUpsertValue(input.priority, existingEntity?.priority, 5, normalizePriority),
          window: normalizeGoalWindow(
            {
              startAt: input.window?.startAt ?? existingWindow?.startAt ?? new Date(),
              targetAt:
                input.window?.targetAt === undefined ? existingWindow?.targetAt : input.window.targetAt,
            },
            "window",
          ),
          parentGoalId,
          relatedGoalIds,
          relatedExperimentIds,
          domains: resolveOptionalUpsertValue(input.domains, existingEntity?.domains, (value) =>
            normalizeDomainList(value, "domains"),
          ),
          links: [],
        }) as GoalEntity,
      );
      const attributes = buildAttributes(entity);

      return {
        attributes,
        body: buildBody(entity),
      };
    },
  });
}

export async function listGoals(vaultRoot: string): Promise<GoalStoredDocument[]> {
  return goalRegistryApi.listRecords(vaultRoot);
}

export async function readGoal({
  vaultRoot,
  goalId,
  slug,
}: ReadGoalInput): Promise<GoalStoredDocument> {
  const normalizedGoalId = normalizeId(goalId, "goalId", "goal");
  const normalizedSlug = normalizeSelectorSlug(slug);
  return goalRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedGoalId,
    slug: normalizedSlug,
  });
}
