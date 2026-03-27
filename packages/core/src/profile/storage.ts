import {
  jsonObjectSchema,
  profileCurrentFrontmatterSchema,
  profileSnapshotSchema,
  safeParseContract,
} from "@healthybob/contracts";

import { buildAuditRecord, resolveAuditShardPath } from "../audit.ts";
import { stringifyFrontmatterDocument } from "../frontmatter.ts";
import { pathExists, readUtf8File, walkVaultFiles } from "../fs.ts";
import { generateRecordId } from "../ids.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.ts";
import { WriteBatch } from "../operations/write-batch.ts";
import { resolveVaultPath } from "../path-safety.ts";
import { toIsoTimestamp } from "../time.ts";
import { VaultError } from "../errors.ts";
import { isPlainRecord } from "../types.ts";

import type { FrontmatterObject, UnknownRecord } from "../types.ts";
import type {
  AppendProfileSnapshotInput,
  CurrentProfileState,
  ProfileSnapshotRecord,
  RebuiltCurrentProfile,
} from "./types.ts";
import {
  PROFILE_CURRENT_DOC_TYPE,
  PROFILE_CURRENT_DOCUMENT_PATH,
  PROFILE_CURRENT_SCHEMA_VERSION,
  PROFILE_SNAPSHOT_LEDGER_DIRECTORY,
  PROFILE_SNAPSHOT_SCHEMA_VERSION,
} from "./types.ts";

interface ListProfileSnapshotsInput {
  vaultRoot: string;
}

interface ReadCurrentProfileInput {
  vaultRoot: string;
}

interface RebuildCurrentProfileInput {
  vaultRoot: string;
}

function assertProfile(value: unknown): asserts value is UnknownRecord {
  const result = safeParseContract(jsonObjectSchema, value);

  if (!result.success) {
    throw new VaultError("PROFILE_INVALID", "Profile snapshots require a plain-object profile payload.");
  }
}

function isProfileSnapshotSource(value: unknown): value is ProfileSnapshotRecord["source"] {
  return profileSnapshotSchema.shape.source.safeParse(value).success;
}

function toProfileSnapshotRecord(value: unknown): ProfileSnapshotRecord {
  const result = safeParseContract(profileSnapshotSchema, value);

  if (!result.success) {
    throw new VaultError("PROFILE_SNAPSHOT_INVALID", "Profile snapshot record failed contract validation.", {
      errors: result.errors,
    });
  }

  return result.data;
}

function sortProfileSnapshots(records: readonly ProfileSnapshotRecord[]): ProfileSnapshotRecord[] {
  return [...records].sort((left, right) => {
    if (left.recordedAt !== right.recordedAt) {
      return left.recordedAt.localeCompare(right.recordedAt);
    }

    return left.id.localeCompare(right.id);
  });
}

function findLatestAcceptedProfileSnapshot(
  records: readonly ProfileSnapshotRecord[],
): ProfileSnapshotRecord | null {
  return records.length === 0 ? null : records.at(-1) ?? null;
}

function renderProfileValue(
  value: unknown,
  depth = 0,
): string[] {
  const indent = "  ".repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indent}[]`];
    }

    return value.flatMap((entry) => {
      if (isPlainRecord(entry) || Array.isArray(entry)) {
        return [`${indent}-`, ...renderProfileValue(entry, depth + 1)];
      }

      return [`${indent}- ${String(entry)}`];
    });
  }

  if (isPlainRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));

    if (entries.length === 0) {
      return [`${indent}{}`];
    }

    return entries.flatMap(([key, entry]) => {
      if (isPlainRecord(entry) || Array.isArray(entry)) {
        return [`${indent}- ${key}:`, ...renderProfileValue(entry, depth + 1)];
      }

      return [`${indent}- ${key}: ${String(entry)}`];
    });
  }

  return [`${indent}${String(value)}`];
}

export function buildCurrentProfileMarkdown(snapshot: ProfileSnapshotRecord): string {
  const topGoalIdsResult = profileCurrentFrontmatterSchema.shape.topGoalIds.safeParse(
    snapshot.profile.topGoalIds,
  );
  const attributesResult = safeParseContract(profileCurrentFrontmatterSchema, {
    schemaVersion: PROFILE_CURRENT_SCHEMA_VERSION,
    docType: PROFILE_CURRENT_DOC_TYPE,
    snapshotId: snapshot.id,
    updatedAt: snapshot.recordedAt,
    sourceAssessmentIds: snapshot.sourceAssessmentIds,
    sourceEventIds: snapshot.sourceEventIds,
    topGoalIds: topGoalIdsResult.success ? topGoalIdsResult.data : undefined,
  });

  if (!attributesResult.success) {
    throw new VaultError("PROFILE_INVALID", "Current profile attributes failed contract validation.", {
      errors: attributesResult.errors,
    });
  }

  return stringifyFrontmatterDocument({
    attributes: Object.fromEntries(
      Object.entries(attributesResult.data).filter(([, value]) => value !== undefined),
    ) as FrontmatterObject,
    body: [
      "# Current Profile",
      "",
      `Snapshot ID: \`${snapshot.id}\``,
      `Recorded At: ${snapshot.recordedAt}`,
      `Source: ${snapshot.source}`,
      "",
      "## Structured Profile",
      "",
      ...renderProfileValue(snapshot.profile),
      "",
      "## JSON",
      "",
      "```json",
      JSON.stringify(snapshot.profile, null, 2),
      "```",
      "",
    ].join("\n"),
  });
}

async function readCurrentProfileMarkdown(
  vaultRoot: string,
): Promise<{ exists: boolean; markdown: string | null }> {
  const resolved = resolveVaultPath(vaultRoot, PROFILE_CURRENT_DOCUMENT_PATH);
  const exists = await pathExists(resolved.absolutePath);

  return {
    exists,
    markdown: exists ? await readUtf8File(vaultRoot, PROFILE_CURRENT_DOCUMENT_PATH) : null,
  };
}

async function stageAuditRecord(
  batch: WriteBatch,
  input: Parameters<typeof buildAuditRecord>[0],
): Promise<{ auditPath: string; record: ReturnType<typeof buildAuditRecord> }> {
  const record = buildAuditRecord(input);
  const auditPath = resolveAuditShardPath(record.occurredAt);
  await batch.stageJsonlAppend(auditPath, `${JSON.stringify(record)}\n`);
  return { auditPath, record };
}

type StoredCurrentProfileMarkdown = Awaited<ReturnType<typeof readCurrentProfileMarkdown>>;
type CurrentProfileRebuildAudit = Pick<
  Parameters<typeof buildAuditRecord>[0],
  "summary" | "occurredAt" | "targetIds" | "changes"
>;

interface StagedCurrentProfileMaterialization {
  updated: boolean;
  markdown: string | null;
  rebuildAudit: CurrentProfileRebuildAudit;
}

async function stageCurrentProfileMaterialization(
  batch: WriteBatch,
  currentState: StoredCurrentProfileMarkdown,
  snapshot: ProfileSnapshotRecord | null,
): Promise<StagedCurrentProfileMaterialization> {
  if (!snapshot) {
    if (currentState.exists) {
      await batch.stageDelete(PROFILE_CURRENT_DOCUMENT_PATH);
    }

    return {
      updated: currentState.exists,
      markdown: null,
      rebuildAudit: {
        summary: currentState.exists
          ? "Removed stale current profile because no snapshots remain."
          : "Profile current rebuild found no snapshots to materialize.",
        targetIds: [],
        changes: currentState.exists
          ? [
              {
                path: PROFILE_CURRENT_DOCUMENT_PATH,
                op: "update",
              },
            ]
          : [],
      },
    };
  }

  const markdown = buildCurrentProfileMarkdown(snapshot);
  const updated = currentState.markdown !== markdown;

  if (updated) {
    await batch.stageTextWrite(PROFILE_CURRENT_DOCUMENT_PATH, markdown, { overwrite: true });
  }

  return {
    updated,
    markdown,
    rebuildAudit: {
      summary: `Rebuilt current profile from snapshot ${snapshot.id}.`,
      occurredAt: snapshot.recordedAt,
      targetIds: [snapshot.id],
      changes: updated
        ? [
            {
              path: PROFILE_CURRENT_DOCUMENT_PATH,
              op: currentState.exists ? "update" : "create",
            },
          ]
        : [],
    },
  };
}

function buildCurrentProfileResult(
  snapshot: ProfileSnapshotRecord | null,
  markdown: string | null,
  auditPath: string,
  updated: boolean,
): RebuiltCurrentProfile {
  return {
    auditPath,
    relativePath: PROFILE_CURRENT_DOCUMENT_PATH,
    exists: snapshot !== null,
    markdown,
    snapshot,
    profile: snapshot?.profile ?? null,
    updated,
  };
}

export async function appendProfileSnapshot({
  vaultRoot,
  recordedAt = new Date(),
  source = "manual",
  sourceAssessmentIds,
  sourceEventIds,
  profile,
}: AppendProfileSnapshotInput): Promise<{
  auditPath: string;
  snapshot: ProfileSnapshotRecord;
  ledgerPath: string;
  currentProfile: RebuiltCurrentProfile;
}> {
  assertProfile(profile);

  const recordedTimestamp = toIsoTimestamp(recordedAt, "recordedAt");
  const snapshot = toProfileSnapshotRecord({
    schemaVersion: PROFILE_SNAPSHOT_SCHEMA_VERSION,
    id: generateRecordId("psnap"),
    recordedAt: recordedTimestamp,
    source: isProfileSnapshotSource(source) ? source : "manual",
    sourceAssessmentIds:
      sourceAssessmentIds && sourceAssessmentIds.length > 0 ? [...new Set(sourceAssessmentIds)] : undefined,
    sourceEventIds:
      sourceEventIds && sourceEventIds.length > 0 ? [...new Set(sourceEventIds)] : undefined,
    profile,
  });

  const ledgerPath = toMonthlyShardRelativePath(
    PROFILE_SNAPSHOT_LEDGER_DIRECTORY,
    recordedTimestamp,
    "recordedAt",
  );
  const existingSnapshots = await listProfileSnapshots({ vaultRoot });
  const latestSnapshot = findLatestAcceptedProfileSnapshot(sortProfileSnapshots([...existingSnapshots, snapshot]));
  const currentState = await readCurrentProfileMarkdown(vaultRoot);
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "profile_snapshot_append",
    summary: `Append profile snapshot ${snapshot.id}`,
    occurredAt: snapshot.recordedAt,
  });

  await batch.stageJsonlAppend(ledgerPath, `${JSON.stringify(snapshot)}\n`);
  const currentProfile = await stageCurrentProfileMaterialization(batch, currentState, latestSnapshot);

  const rebuildAudit = await stageAuditRecord(batch, {
    action: "profile_current_rebuild",
    commandName: "core.rebuildCurrentProfile",
    ...currentProfile.rebuildAudit,
  });
  const audit = await stageAuditRecord(batch, {
    action: "profile_snapshot_add",
    commandName: "core.appendProfileSnapshot",
    summary: `Appended profile snapshot ${snapshot.id}.`,
    occurredAt: snapshot.recordedAt,
    targetIds: [snapshot.id],
    changes: [
      {
        path: ledgerPath,
        op: "append",
      },
    ],
  });
  await batch.commit();

  return {
    auditPath: audit.auditPath,
    snapshot,
    ledgerPath,
    currentProfile: buildCurrentProfileResult(
      latestSnapshot,
      currentProfile.markdown,
      rebuildAudit.auditPath,
      currentProfile.updated,
    ),
  };
}

export async function listProfileSnapshots({
  vaultRoot,
}: ListProfileSnapshotsInput): Promise<ProfileSnapshotRecord[]> {
  const shardPaths = await walkVaultFiles(vaultRoot, PROFILE_SNAPSHOT_LEDGER_DIRECTORY, {
    extension: ".jsonl",
  });

  const records: ProfileSnapshotRecord[] = [];

  for (const shardPath of shardPaths) {
    const shardRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: shardPath,
    });

    records.push(...shardRecords.map((record) => toProfileSnapshotRecord(record)));
  }

  return sortProfileSnapshots(records);
}

export async function readCurrentProfile({
  vaultRoot,
}: ReadCurrentProfileInput): Promise<CurrentProfileState> {
  const snapshots = await listProfileSnapshots({ vaultRoot });
  const snapshot = findLatestAcceptedProfileSnapshot(snapshots);
  const currentPath = resolveVaultPath(vaultRoot, PROFILE_CURRENT_DOCUMENT_PATH);
  const exists = await pathExists(currentPath.absolutePath);

  return {
    relativePath: PROFILE_CURRENT_DOCUMENT_PATH,
    exists,
    markdown: exists ? await readUtf8File(vaultRoot, PROFILE_CURRENT_DOCUMENT_PATH) : null,
    snapshot,
    profile: snapshot?.profile ?? null,
  };
}

export async function rebuildCurrentProfile({
  vaultRoot,
}: RebuildCurrentProfileInput): Promise<RebuiltCurrentProfile> {
  const snapshots = await listProfileSnapshots({ vaultRoot });
  const snapshot = findLatestAcceptedProfileSnapshot(snapshots);
  const currentState = await readCurrentProfileMarkdown(vaultRoot);
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "profile_current_rebuild",
    summary: snapshot
      ? `Rebuild current profile from snapshot ${snapshot.id}`
      : "Rebuild current profile without snapshots",
    occurredAt: snapshot?.recordedAt,
  });
  const currentProfile = await stageCurrentProfileMaterialization(batch, currentState, snapshot);

  const audit = await stageAuditRecord(batch, {
    action: "profile_current_rebuild",
    commandName: "core.rebuildCurrentProfile",
    ...currentProfile.rebuildAudit,
  });
  await batch.commit();

  return buildCurrentProfileResult(snapshot, currentProfile.markdown, audit.auditPath, currentProfile.updated);
}
