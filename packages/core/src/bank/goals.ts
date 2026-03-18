import { VaultError } from "../errors.js";
import { stringifyFrontmatterDocument } from "../frontmatter.js";
import { generateRecordId } from "../ids.js";

import {
  GOAL_DOC_TYPE,
  GOAL_HORIZONS,
  GOALS_DIRECTORY,
  GOAL_SCHEMA_VERSION,
  GOAL_STATUSES,
} from "./types.js";
import {
  buildMarkdownBody,
  detailList,
  findRecordByIdOrSlug,
  listSection,
  loadMarkdownRegistry,
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
  selectRecordByIdOrSlug,
  stripUndefined,
  normalizeId,
  normalizeSlug,
} from "./shared.js";
import { writeBankRecordWithAudit } from "./write-audit.js";

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
          ["Parent goal", record.parentGoalId],
        ]),
      ),
      listSection("Related Goals", record.relatedGoalIds),
      listSection("Related Experiments", record.relatedExperimentIds),
      listSection("Domains", record.domains),
    ],
  );
}

function parseGoalRecord(attributes: FrontmatterObject, relativePath: string, markdown: string): GoalRecord {
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
    parentGoalId: record.parentGoalId,
    relatedGoalIds: record.relatedGoalIds,
    relatedExperimentIds: record.relatedExperimentIds,
    domains: record.domains,
  }) as FrontmatterObject;
}

async function loadGoals(vaultRoot: string): Promise<GoalRecord[]> {
  return loadMarkdownRegistry(
    vaultRoot,
    GOALS_DIRECTORY,
    parseGoalRecord,
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
  const existingRecords = await loadGoals(input.vaultRoot);
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = selectRecordByIdOrSlug(
    existingRecords,
    normalizedGoalId,
    requestedSlug,
    (record) => record.goalId,
    "Goal",
    "VAULT_GOAL_CONFLICT",
  );
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const slug = existingRecord?.slug ?? requestedSlug ?? normalizeSlug(undefined, "slug", title);
  const goalId = existingRecord?.goalId ?? normalizedGoalId ?? generateRecordId("goal");
  const existingWindow = existingRecord?.window;
  const record = ensureGoalLinks(
    stripUndefined({
      schemaVersion: GOAL_SCHEMA_VERSION,
      docType: GOAL_DOC_TYPE,
      goalId,
      slug: existingRecord?.slug ?? slug,
      title,
      status: resolveRequiredUpsertValue(input.status, existingRecord?.status, "active", (value) =>
        optionalEnum(value, GOAL_STATUSES, "status") ?? "active",
      ),
      horizon: resolveRequiredUpsertValue(input.horizon, existingRecord?.horizon, "ongoing", (value) =>
        optionalEnum(value, GOAL_HORIZONS, "horizon") ?? "ongoing",
      ),
      priority: resolveRequiredUpsertValue(input.priority, existingRecord?.priority, 5, normalizePriority),
      window: normalizeGoalWindow(
        {
          startAt: input.window?.startAt ?? existingWindow?.startAt ?? new Date(),
          targetAt:
            input.window?.targetAt === undefined ? existingWindow?.targetAt : input.window.targetAt,
        },
        "window",
      ),
      parentGoalId: resolveOptionalUpsertValue(
        input.parentGoalId,
        existingRecord?.parentGoalId,
        (value) => (value === null ? null : normalizeId(value, "parentGoalId", "goal")),
      ),
      relatedGoalIds: resolveOptionalUpsertValue(
        input.relatedGoalIds,
        existingRecord?.relatedGoalIds,
        (value) => normalizeRecordIdList(value, "relatedGoalIds", "goal"),
      ),
      relatedExperimentIds: resolveOptionalUpsertValue(
        input.relatedExperimentIds,
        existingRecord?.relatedExperimentIds,
        (value) => normalizeRecordIdList(value, "relatedExperimentIds", "exp"),
      ),
      domains: resolveOptionalUpsertValue(input.domains, existingRecord?.domains, (value) =>
        normalizeDomainList(value, "domains"),
      ),
      relativePath: existingRecord?.relativePath ?? `${GOALS_DIRECTORY}/${slug}.md`,
      markdown: existingRecord?.markdown ?? "",
    }) as GoalRecord,
  );
  const markdown = stringifyFrontmatterDocument({
    attributes: buildAttributes(record),
    body: buildBody(record),
  });

  const auditPath = await writeBankRecordWithAudit({
    vaultRoot: input.vaultRoot,
    operationType: "goal_upsert",
    batchSummary: `Upsert goal ${record.goalId}`,
    relativePath: record.relativePath,
    markdown,
    auditAction: "goal_upsert",
    auditCommandName: "core.upsertGoal",
    auditSummary: `Upserted goal ${record.goalId}.`,
    auditTargetIds: [record.goalId],
    auditChanges: [
      {
        path: record.relativePath,
        op: existingRecord ? "update" : "create",
      },
    ],
  });

  return {
    created: !existingRecord,
    auditPath,
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
  const match = findRecordByIdOrSlug(records, normalizedGoalId, normalizedSlug, (record) => record.goalId);

  if (!match) {
    throw new VaultError("VAULT_GOAL_MISSING", "Goal was not found.");
  }

  return match;
}
