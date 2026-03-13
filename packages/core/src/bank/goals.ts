import { VaultError } from "../errors.js";
import { stringifyFrontmatterDocument } from "../frontmatter.js";
import { writeVaultTextFile } from "../fs.js";
import { generateRecordId } from "../ids.js";

import {
  GOAL_DOC_TYPE,
  GOAL_HORIZONS,
  GOALS_DIRECTORY,
  GOAL_SCHEMA_VERSION,
  GOAL_STATUSES,
} from "./types.js";
import {
  detailList,
  loadMarkdownRegistry,
  normalizeDateOnly,
  normalizeDomainList,
  normalizePriority,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  optionalDateOnly,
  optionalEnum,
  requireMatchingDocType,
  requireObject,
  requireString,
  section,
  selectRecordByIdOrSlug,
  stripUndefined,
  normalizeId,
  normalizeSlug,
} from "./shared.js";

import type { FrontmatterObject } from "../types.js";
import type { GoalRecord, GoalWindow, ReadGoalInput, UpsertGoalInput, UpsertGoalResult } from "./types.js";

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

function buildBody(record: GoalRecord): string {
  return [
    `# ${record.title}`,
    "",
    detailList([
      ["Status", record.status],
      ["Horizon", record.horizon],
      ["Priority", record.priority],
    ]),
    "",
    section(
      "Window",
      detailList([
        ["Start", record.window.startAt],
        ["Target", record.window.targetAt],
      ]),
    ),
    "",
    section(
      "Relationships",
      detailList([
        ["Parent goal", record.parentGoalId],
      ]),
    ),
    "",
    section("Related Goals", record.relatedGoalIds ? record.relatedGoalIds.map((value) => `- ${value}`).join("\n") : "- none"),
    "",
    section(
      "Related Experiments",
      record.relatedExperimentIds ? record.relatedExperimentIds.map((value) => `- ${value}`).join("\n") : "- none",
    ),
    "",
    section("Domains", record.domains ? record.domains.map((value) => `- ${value}`).join("\n") : "- none"),
    "",
  ].join("\n");
}

function recordFromParts(attributes: FrontmatterObject, relativePath: string, markdown: string): GoalRecord {
  requireMatchingDocType(
    attributes,
    GOAL_SCHEMA_VERSION,
    GOAL_DOC_TYPE,
    "VAULT_INVALID_GOAL",
    "Goal registry document has an unexpected shape.",
  );

  return stripUndefined({
    schemaVersion: GOAL_SCHEMA_VERSION,
    docType: GOAL_DOC_TYPE,
    goalId: requireString(attributes.goalId, "goalId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", 160),
    status: optionalEnum(attributes.status, GOAL_STATUSES, "status") ?? "active",
    horizon: optionalEnum(attributes.horizon, GOAL_HORIZONS, "horizon") ?? "ongoing",
    priority: normalizePriority(attributes.priority),
    window: normalizeGoalWindow(attributes.window, "window"),
    parentGoalId:
      attributes.parentGoalId === null
        ? null
        : normalizeId(attributes.parentGoalId, "parentGoalId", "goal"),
    relatedGoalIds: normalizeRecordIdList(attributes.relatedGoalIds, "relatedGoalIds", "goal"),
    relatedExperimentIds: normalizeRecordIdList(attributes.relatedExperimentIds, "relatedExperimentIds", "exp"),
    domains: normalizeDomainList(attributes.domains, "domains"),
    relativePath,
    markdown,
  });
}

function buildAttributes(record: GoalRecord): FrontmatterObject {
  const windowAttributes: FrontmatterObject = {
    startAt: record.window.startAt,
  };

  if (record.window.targetAt !== undefined) {
    windowAttributes.targetAt = record.window.targetAt;
  }

  const attributes: FrontmatterObject = {
    schemaVersion: GOAL_SCHEMA_VERSION,
    docType: GOAL_DOC_TYPE,
    goalId: record.goalId,
    slug: record.slug,
    title: record.title,
    status: record.status,
    horizon: record.horizon,
    priority: record.priority,
    window: windowAttributes,
  };

  if (record.parentGoalId !== undefined) {
    attributes.parentGoalId = record.parentGoalId;
  }

  if (record.relatedGoalIds !== undefined) {
    attributes.relatedGoalIds = record.relatedGoalIds;
  }

  if (record.relatedExperimentIds !== undefined) {
    attributes.relatedExperimentIds = record.relatedExperimentIds;
  }

  if (record.domains !== undefined) {
    attributes.domains = record.domains;
  }

  return attributes;
}

async function loadGoals(vaultRoot: string): Promise<GoalRecord[]> {
  return loadMarkdownRegistry(
    vaultRoot,
    GOALS_DIRECTORY,
    recordFromParts,
    (left, right) =>
      right.priority - left.priority ||
      left.window.startAt.localeCompare(right.window.startAt) ||
      left.title.localeCompare(right.title) ||
      left.goalId.localeCompare(right.goalId),
  );
}

function ensureGoalLinks(record: GoalRecord): GoalRecord {
  if (record.parentGoalId && record.parentGoalId === record.goalId) {
    throw new VaultError("VAULT_INVALID_INPUT", "parentGoalId may not equal goalId.");
  }

  if (record.relatedGoalIds?.includes(record.goalId)) {
    throw new VaultError("VAULT_INVALID_INPUT", "relatedGoalIds may not include goalId.");
  }

  return record;
}

export async function upsertGoal(input: UpsertGoalInput): Promise<UpsertGoalResult> {
  const normalizedGoalId = normalizeId(input.goalId, "goalId", "goal");
  const title = requireString(input.title, "title", 160);
  const slug = normalizeSlug(input.slug, "slug", title);
  const existingRecords = await loadGoals(input.vaultRoot);
  const existingRecord = selectRecordByIdOrSlug(
    existingRecords,
    normalizedGoalId,
    slug,
    (record) => record.goalId,
    "Goal",
    "VAULT_GOAL_CONFLICT",
  );
  const goalId = existingRecord?.goalId ?? normalizedGoalId ?? generateRecordId("goal");
  const record: GoalRecord = {
    schemaVersion: GOAL_SCHEMA_VERSION,
    docType: GOAL_DOC_TYPE,
    goalId,
    slug: existingRecord?.slug ?? slug,
    title,
    status: optionalEnum(input.status ?? "active", GOAL_STATUSES, "status") ?? "active",
    horizon: optionalEnum(input.horizon ?? "ongoing", GOAL_HORIZONS, "horizon") ?? "ongoing",
    priority: normalizePriority(input.priority),
    window: normalizeGoalWindow(
      {
        startAt: input.window?.startAt ?? new Date(),
        targetAt: input.window?.targetAt,
      },
      "window",
    ),
    relativePath: existingRecord?.relativePath ?? `${GOALS_DIRECTORY}/${slug}.md`,
    markdown: existingRecord?.markdown ?? "",
  };

  if (input.parentGoalId !== undefined) {
    record.parentGoalId =
      input.parentGoalId === null
        ? null
        : normalizeId(input.parentGoalId, "parentGoalId", "goal");
  }

  const relatedGoalIds = normalizeRecordIdList(input.relatedGoalIds, "relatedGoalIds", "goal");
  if (relatedGoalIds !== undefined) {
    record.relatedGoalIds = relatedGoalIds;
  }

  const relatedExperimentIds = normalizeRecordIdList(
    input.relatedExperimentIds,
    "relatedExperimentIds",
    "exp",
  );
  if (relatedExperimentIds !== undefined) {
    record.relatedExperimentIds = relatedExperimentIds;
  }

  const domains = normalizeDomainList(input.domains, "domains");
  if (domains !== undefined) {
    record.domains = domains;
  }

  ensureGoalLinks(record);
  const markdown = stringifyFrontmatterDocument({
    attributes: buildAttributes(record),
    body: buildBody(record),
  });

  await writeVaultTextFile(input.vaultRoot, record.relativePath, markdown);

  return {
    created: !existingRecord,
    record: {
      ...record,
      markdown,
    },
  };
}

export async function listGoals(vaultRoot: string): Promise<GoalRecord[]> {
  return loadGoals(vaultRoot);
}

export async function readGoal({ vaultRoot, goalId, slug }: ReadGoalInput): Promise<GoalRecord> {
  const normalizedGoalId = normalizeId(goalId, "goalId", "goal");
  const normalizedSlug = normalizeSelectorSlug(slug);
  const records = await loadGoals(vaultRoot);
  const match = records.find((record) => {
    if (normalizedGoalId && record.goalId === normalizedGoalId) {
      return true;
    }

    return normalizedSlug ? record.slug === normalizedSlug : false;
  });

  if (!match) {
    throw new VaultError("VAULT_GOAL_MISSING", "Goal was not found.");
  }

  return match;
}
