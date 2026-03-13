import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  applyLimit,
  asObject,
  firstObject,
  firstString,
  firstStringArray,
  matchesDateRange,
  matchesLookup,
  matchesText,
  maybeString,
  parseFrontmatterDocument,
  readJsonlRecords,
} from "./shared.js";

export interface ProfileSnapshotQueryRecord {
  id: string;
  capturedAt: string | null;
  recordedAt: string | null;
  status: string;
  summary: string | null;
  source: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  profile: Record<string, unknown>;
  relativePath: string;
}

export interface CurrentProfileQueryRecord {
  id: "current";
  snapshotId: string | null;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  relativePath: string;
  markdown: string | null;
  body: string | null;
}

export interface ProfileSnapshotListOptions {
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

function buildCurrentProfileRecord(input: {
  snapshotId: string;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  markdown: string | null;
  body: string | null;
}): CurrentProfileQueryRecord {
  return {
    id: "current",
    snapshotId: input.snapshotId,
    updatedAt: input.updatedAt,
    sourceAssessmentIds: input.sourceAssessmentIds,
    sourceEventIds: input.sourceEventIds,
    topGoalIds: input.topGoalIds,
    relativePath: "bank/profile/current.md",
    markdown: input.markdown,
    body: input.body,
  };
}

async function readOptionalUtf8(absolutePath: string): Promise<string | null> {
  try {
    await access(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  return readFile(absolutePath, "utf8");
}

function toProfileSnapshotRecord(
  value: unknown,
  relativePath: string,
): ProfileSnapshotQueryRecord | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const id = firstString(source, ["id"]);
  if (!id?.startsWith("psnap_")) {
    return null;
  }

  const sourceObject = firstObject(source, ["source"]);
  const sourceAssessmentIds = firstStringArray(source, ["sourceAssessmentIds"]);

  return {
    id,
    capturedAt: firstString(source, ["capturedAt", "recordedAt"]),
    recordedAt: firstString(source, ["recordedAt", "capturedAt"]),
    status: firstString(source, ["status"]) ?? "accepted",
    summary: firstString(source, ["summary"]),
    source:
      firstString(source, ["source"]) ??
      firstString(sourceObject ?? {}, ["kind", "source", "importedFrom"]),
    sourceAssessmentIds:
      sourceAssessmentIds.length > 0
        ? sourceAssessmentIds
        : (firstString(sourceObject ?? {}, ["assessmentId"])
            ? [firstString(sourceObject ?? {}, ["assessmentId"]) as string]
            : []),
    sourceEventIds: firstStringArray(source, ["sourceEventIds"]),
    profile: firstObject(source, ["profile"]) ?? {},
    relativePath,
  };
}

function compareSnapshots(
  left: ProfileSnapshotQueryRecord,
  right: ProfileSnapshotQueryRecord,
): number {
  const leftTimestamp = left.recordedAt ?? left.capturedAt ?? "";
  const rightTimestamp = right.recordedAt ?? right.capturedAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }

  return left.id.localeCompare(right.id);
}

function parseCurrentProfileMarkdown(markdown: string): CurrentProfileQueryRecord {
  const parsed = parseFrontmatterDocument(markdown);
  const attributes = parsed.attributes;
  const body = parsed.body || markdown.trim();
  const snapshotId =
    maybeString(attributes.snapshotId) ??
    body.match(/Snapshot ID:\s+`([^`]+)`/u)?.[1] ??
    null;
  const updatedAt =
    maybeString(attributes.updatedAt) ??
    body.match(/Recorded At:\s+([^\n]+)/u)?.[1]?.trim() ??
    null;

  return {
    id: "current",
    snapshotId,
    updatedAt,
    sourceAssessmentIds: firstStringArray(attributes, ["sourceAssessmentIds"]),
    sourceEventIds: firstStringArray(attributes, ["sourceEventIds"]),
    topGoalIds: firstStringArray(attributes, ["topGoalIds"]),
    relativePath: "bank/profile/current.md",
    markdown,
    body,
  };
}

export async function listProfileSnapshots(
  vaultRoot: string,
  options: ProfileSnapshotListOptions = {},
): Promise<ProfileSnapshotQueryRecord[]> {
  const entries = await readJsonlRecords(vaultRoot, "ledger/profile-snapshots");
  const records = entries
    .map((entry) => toProfileSnapshotRecord(entry.value, entry.relativePath))
    .filter((entry): entry is ProfileSnapshotQueryRecord => entry !== null)
    .filter(
      (entry) =>
        matchesDateRange(entry.recordedAt ?? entry.capturedAt, options.from, options.to) &&
        matchesText(
          [entry.id, entry.summary, entry.source, entry.profile, entry.sourceAssessmentIds, entry.sourceEventIds],
          options.text,
        ),
    )
    .sort(compareSnapshots);

  return applyLimit(records, options.limit);
}

export async function readProfileSnapshot(
  vaultRoot: string,
  snapshotId: string,
): Promise<ProfileSnapshotQueryRecord | null> {
  const snapshots = await listProfileSnapshots(vaultRoot);
  return snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
}

export async function readCurrentProfile(
  vaultRoot: string,
): Promise<CurrentProfileQueryRecord | null> {
  const snapshots = await listProfileSnapshots(vaultRoot);
  const latestSnapshot = snapshots[0] ?? null;

  if (!latestSnapshot) {
    return null;
  }

  const absolutePath = path.join(vaultRoot, "bank/profile/current.md");
  const markdown = await readOptionalUtf8(absolutePath);

  if (!markdown) {
    return buildCurrentProfileRecord({
      snapshotId: latestSnapshot.id,
      updatedAt: latestSnapshot.recordedAt ?? latestSnapshot.capturedAt,
      sourceAssessmentIds: latestSnapshot.sourceAssessmentIds,
      sourceEventIds: latestSnapshot.sourceEventIds,
      topGoalIds: firstStringArray(latestSnapshot.profile, ["topGoalIds"]),
      markdown: null,
      body: null,
    });
  }

  const parsed = parseCurrentProfileMarkdown(markdown);
  if (parsed.snapshotId === latestSnapshot.id) {
    return parsed;
  }

  return buildCurrentProfileRecord({
    snapshotId: latestSnapshot.id,
    updatedAt: latestSnapshot.recordedAt ?? latestSnapshot.capturedAt,
    sourceAssessmentIds: latestSnapshot.sourceAssessmentIds,
    sourceEventIds: latestSnapshot.sourceEventIds,
    topGoalIds: firstStringArray(latestSnapshot.profile, ["topGoalIds"]),
    markdown: null,
    body: null,
  });
}

export async function showProfile(
  vaultRoot: string,
  lookup: string,
): Promise<ProfileSnapshotQueryRecord | CurrentProfileQueryRecord | null> {
  if (matchesLookup(lookup, "current")) {
    return readCurrentProfile(vaultRoot);
  }

  const snapshots = await listProfileSnapshots(vaultRoot);
  return snapshots.find((snapshot) => matchesLookup(lookup, snapshot.id, snapshot.summary)) ?? null;
}
