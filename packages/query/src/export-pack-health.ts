import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parseFrontmatterDocument } from "./health/shared.js";

import type {
  ExportPackAssessmentRecord,
  ExportPackBankPage,
  ExportPackCurrentProfile,
  ExportPackFilters,
  ExportPackHistoryRecord,
  ExportPackProfileSnapshotRecord,
} from "./export-pack.js";

export function readAssessmentRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackAssessmentRecord[] {
  return readJsonlDirectory(vaultRoot, "ledger/assessments")
    .map(({ relativePath, value }) => {
      const source = asObject(value);
      const id = firstString(source, ["id"]);
      if (!source || !id?.startsWith("asmt_")) {
        return null;
      }

      return {
        id,
        title: firstString(source, ["title"]),
        assessmentType: firstString(source, ["assessmentType"]),
        recordedAt: firstString(source, ["recordedAt", "occurredAt", "importedAt"]),
        importedAt: firstString(source, ["importedAt"]),
        source: firstString(source, ["source"]),
        sourcePath: firstString(source, ["rawPath", "sourcePath"]),
        questionnaireSlug: firstString(source, ["questionnaireSlug"]),
        relatedIds: firstStringArray(source, ["relatedIds"]),
        responses: firstObject(source, ["responses", "response"]),
        relativePath,
      };
    })
    .filter((entry): entry is ExportPackAssessmentRecord => entry !== null)
    .filter((entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters))
    .sort((left, right) =>
      (right.recordedAt ?? right.importedAt ?? "").localeCompare(left.recordedAt ?? left.importedAt ?? "") ||
      left.id.localeCompare(right.id),
    );
}

export function readProfileSnapshotRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackProfileSnapshotRecord[] {
  return readJsonlDirectory(vaultRoot, "ledger/profile-snapshots")
    .map(({ relativePath, value }) => {
      const source = asObject(value);
      const id = firstString(source, ["id"]);
      if (!source || !id?.startsWith("psnap_")) {
        return null;
      }

      const sourceObject = firstObject(source, ["source"]);
      const fallbackAssessmentId = firstString(sourceObject, ["assessmentId"]);

      return {
        id,
        recordedAt: firstString(source, ["recordedAt", "capturedAt"]),
        source:
          firstString(source, ["source"]) ??
          firstString(sourceObject, ["kind", "source", "importedFrom"]),
        sourceAssessmentIds:
          firstStringArray(source, ["sourceAssessmentIds"]).length > 0
            ? firstStringArray(source, ["sourceAssessmentIds"])
            : fallbackAssessmentId
              ? [fallbackAssessmentId]
              : [],
        sourceEventIds: firstStringArray(source, ["sourceEventIds"]),
        profile: firstObject(source, ["profile"]),
        relativePath,
      };
    })
    .filter((entry): entry is ExportPackProfileSnapshotRecord => entry !== null)
    .filter((entry) => matchesDateWindow(entry.recordedAt, filters))
    .sort((left, right) =>
      (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") || left.id.localeCompare(right.id),
    );
}

export function readHistoryRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHistoryRecord[] {
  const healthKinds = new Set(["encounter", "procedure", "test", "adverse_effect", "exposure"]);

  return readJsonlDirectory(vaultRoot, "ledger/events")
    .map(({ relativePath, value }) => {
      const source = asObject(value);
      const id = firstString(source, ["id"]);
      const kind = firstString(source, ["kind"]);
      const occurredAt = firstString(source, ["occurredAt"]);
      const title = firstString(source, ["title"]);

      if (!source || !id?.startsWith("evt_") || !kind || !healthKinds.has(kind) || !occurredAt || !title) {
        return null;
      }

      return {
        id,
        kind,
        occurredAt,
        recordedAt: firstString(source, ["recordedAt"]),
        source: firstString(source, ["source"]),
        title,
        status: firstString(source, ["status"]),
        tags: firstStringArray(source, ["tags"]),
        relatedIds: firstStringArray(source, ["relatedIds"]),
        relativePath,
        data: source,
      };
    })
    .filter((entry): entry is ExportPackHistoryRecord => entry !== null)
    .filter((entry) => matchesDateWindow(entry.occurredAt, filters))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
}

export function readCurrentProfileRecord(
  vaultRoot: string,
  profileSnapshots: ExportPackProfileSnapshotRecord[],
): ExportPackCurrentProfile | null {
  const latestSnapshot = profileSnapshots[0] ?? null;
  if (!latestSnapshot) {
    return null;
  }

  const relativePath = "bank/profile/current.md";
  const absolutePath = path.join(vaultRoot, relativePath);
  const markdown = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : null;

  if (markdown) {
    const parsed = parseFrontmatterDocument(markdown);
    const snapshotId =
      firstString(parsed.attributes, ["snapshotId"]) ??
      markdown.match(/Snapshot ID:\s+`([^`]+)`/u)?.[1] ??
      null;

    if (snapshotId === latestSnapshot.id) {
      return {
        snapshotId,
        updatedAt:
          firstString(parsed.attributes, ["updatedAt"]) ??
          markdown.match(/Recorded At:\s+([^\n]+)/u)?.[1]?.trim() ??
          latestSnapshot.recordedAt,
        sourceAssessmentIds: firstStringArray(parsed.attributes, ["sourceAssessmentIds"]),
        sourceEventIds: firstStringArray(parsed.attributes, ["sourceEventIds"]),
        topGoalIds: firstStringArray(parsed.attributes, ["topGoalIds"]),
        relativePath,
        markdown,
        body: parsed.body,
      };
    }
  }

  return {
    snapshotId: latestSnapshot.id,
    updatedAt: latestSnapshot.recordedAt,
    sourceAssessmentIds: latestSnapshot.sourceAssessmentIds,
    sourceEventIds: latestSnapshot.sourceEventIds,
    topGoalIds: firstStringArray(latestSnapshot.profile, ["topGoalIds"]),
    relativePath,
    markdown: null,
    body: null,
  };
}

export function readBankPages(
  vaultRoot: string,
  relativeRoot: string,
  idKeys: readonly string[],
): ExportPackBankPage[] {
  return walkRelativeMarkdownFiles(vaultRoot, relativeRoot)
    .map((relativePath) => {
      const markdown = readFileSync(path.join(vaultRoot, relativePath), "utf8");
      const parsed = parseFrontmatterDocument(markdown);
      const id = firstString(parsed.attributes, idKeys);
      if (!id) {
        return null;
      }

      return {
        id,
        slug: firstString(parsed.attributes, ["slug"]) ?? path.basename(relativePath, ".md"),
        title: firstString(parsed.attributes, ["title", "name", "label"]),
        status: firstString(parsed.attributes, ["status", "clinicalStatus", "significance"]),
        relativePath,
        markdown,
        body: parsed.body,
        attributes: parsed.attributes,
      };
    })
    .filter((entry): entry is ExportPackBankPage => entry !== null)
    .sort((left, right) => (left.title ?? left.slug).localeCompare(right.title ?? right.slug));
}

function walkRelativeMarkdownFiles(vaultRoot: string, relativeRoot: string): string[] {
  const absoluteRoot = path.join(vaultRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  return walkRelativeFilesByExtension(vaultRoot, relativeRoot, ".md");
}

function readJsonlDirectory(
  vaultRoot: string,
  relativeRoot: string,
): Array<{ relativePath: string; value: unknown }> {
  const absoluteRoot = path.join(vaultRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const files = walkRelativeFilesByExtension(vaultRoot, relativeRoot, ".jsonl");
  const results: Array<{ relativePath: string; value: unknown }> = [];

  for (const relativePath of files) {
    const contents = readFileSync(path.join(vaultRoot, relativePath), "utf8");
    for (const line of contents.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      results.push({
        relativePath,
        value: JSON.parse(trimmed),
      });
    }
  }

  return results;
}

function walkRelativeFilesByExtension(
  vaultRoot: string,
  relativeRoot: string,
  extension: string,
): string[] {
  const results: string[] = [];
  const stack = [relativeRoot];

  while (stack.length > 0) {
    const currentRelative = stack.pop() as string;
    const absoluteCurrent = path.join(vaultRoot, currentRelative);
    const entries = readdirSync(absoluteCurrent, { withFileTypes: true });

    for (const entry of entries) {
      const childRelative = path.join(currentRelative, entry.name);
      if (entry.isDirectory()) {
        stack.push(childRelative);
        continue;
      }

      if (entry.isFile() && childRelative.endsWith(extension)) {
        results.push(childRelative);
      }
    }
  }

  return results.sort();
}

function matchesDateWindow(
  value: string | null,
  filters: ExportPackFilters,
): boolean {
  if (!value) {
    return false;
  }

  const comparable = value.slice(0, 10);
  if (filters.from && comparable < filters.from) {
    return false;
  }

  if (filters.to && comparable > filters.to) {
    return false;
  }

  return true;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstObject(
  value: Record<string, unknown> | null,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  for (const key of keys) {
    const candidate = asObject(value[key]);
    if (candidate) {
      return candidate;
    }
  }

  return {};
}

function firstString(
  value: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function firstStringArray(
  value: Record<string, unknown> | null,
  keys: readonly string[],
): string[] {
  if (!value) {
    return [];
  }

  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return [];
}
