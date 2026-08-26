import {
  SCHEDULED_LOG_DOC_TYPE,
  SCHEDULED_LOG_SCHEMA_VERSION,
  scheduledLogFrontmatterSchema,
  VAULT_LAYOUT,
  type ExecutableScheduleIntent,
  type ScheduledLogAction,
  type ScheduledLogStatus,
} from "@murphai/contracts";

import { readMarkdownDocument, walkRelativeFiles } from "./health/loaders.ts";
import {
  applyLimit,
  compareNullableStrings,
  matchesLookup,
  matchesStatus,
  matchesText,
} from "./health/shared.ts";
import type { FrontmatterObject } from "./health/shared.ts";

const SCHEDULED_LOGS_DIRECTORY = VAULT_LAYOUT.scheduledLogsDirectory;

class ScheduledLogQueryError extends Error {
  readonly code = "VAULT_INVALID_SCHEDULED_LOG";
  readonly details: Record<string, unknown>;

  constructor(
    issues: readonly {
      code: string;
      path: readonly PropertyKey[];
    }[] = [],
  ) {
    super("Scheduled log registry document is invalid.");
    this.name = "VaultError";
    this.details = issues.length > 0
      ? {
          issues: issues.map((issue) => ({
            code: issue.code,
            path: issue.path.map((segment) =>
              typeof segment === "string" || typeof segment === "number"
                ? segment
                : "<field>"
            ),
          })),
        }
      : {};
  }
}

export type {
  ExecutableScheduleIntent,
  ScheduledLogAction,
  ScheduledLogStatus,
};

export interface ScheduledLogQueryRecord {
  schemaVersion: typeof SCHEDULED_LOG_SCHEMA_VERSION;
  docType: typeof SCHEDULED_LOG_DOC_TYPE;
  scheduledLogId: string;
  slug: string;
  title: string;
  status: ScheduledLogStatus;
  summary: string | null;
  schedule: ExecutableScheduleIntent;
  action: ScheduledLogAction;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  body: string;
  relativePath: string;
  markdown: string;
}

export interface ScheduledLogListOptions {
  status?: string | string[];
  text?: string;
  limit?: number;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseScheduledLogRecord(
  attributes: FrontmatterObject,
  body: string,
  relativePath: string,
  markdown: string,
): ScheduledLogQueryRecord {
  try {
    const parsedFrontmatter = scheduledLogFrontmatterSchema.safeParse(attributes);
    if (!parsedFrontmatter.success) {
      throw new ScheduledLogQueryError(parsedFrontmatter.error.issues);
    }
    const frontmatter = parsedFrontmatter.data;

    return {
      ...frontmatter,
      summary: frontmatter.summary ?? null,
      tags: [...new Set(frontmatter.tags ?? [])].sort((left, right) => left.localeCompare(right)),
      body: body.replace(/\s+$/u, ""),
      relativePath,
      markdown,
    };
  } catch (error) {
    if (error instanceof ScheduledLogQueryError) {
      throw error;
    }
    throw new ScheduledLogQueryError();
  }
}

async function loadScheduledLogRecords(vaultRoot: string): Promise<ScheduledLogQueryRecord[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, SCHEDULED_LOGS_DIRECTORY, ".md");
  const records: ScheduledLogQueryRecord[] = [];

  for (const relativePath of relativePaths) {
    try {
      const document = await readMarkdownDocument(vaultRoot, relativePath);
      const record = parseScheduledLogRecord(
        document.attributes,
        document.body,
        relativePath,
        document.markdown,
      );
      records.push(record);
    } catch (error) {
      if (
        error instanceof ScheduledLogQueryError ||
        (error instanceof Error &&
          "code" in error &&
          typeof error.code === "string" &&
          "syscall" in error &&
          typeof error.syscall === "string")
      ) {
        throw error;
      }
      throw new ScheduledLogQueryError();
    }
  }

  return records.sort((left, right) =>
    compareNullableStrings(left.title, right.title) ||
    compareNullableStrings(left.slug, right.slug) ||
    compareNullableStrings(left.scheduledLogId, right.scheduledLogId),
  );
}

function matchesScheduledLogText(record: ScheduledLogQueryRecord, text: string | undefined): boolean {
  if (!normalizeNullableString(text)) {
    return true;
  }

  return matchesText(
    [
      record.scheduledLogId,
      record.slug,
      record.title,
      record.summary,
      record.body,
      record.createdAt,
      record.updatedAt,
      record.status,
      JSON.stringify(record.schedule),
      JSON.stringify(record.action),
      record.tags,
    ],
    text,
  );
}

export async function listScheduledLogs(
  vaultRoot: string,
  options: ScheduledLogListOptions = {},
): Promise<ScheduledLogQueryRecord[]> {
  const records = await loadScheduledLogRecords(vaultRoot);
  const filtered = records.filter((record) =>
    matchesStatus(record.status, options.status) &&
    matchesScheduledLogText(record, options.text),
  );

  return applyLimit(filtered, options.limit);
}

export async function readScheduledLog(
  vaultRoot: string,
  scheduledLogId: string,
): Promise<ScheduledLogQueryRecord | null> {
  const records = await loadScheduledLogRecords(vaultRoot);
  return records.find((record) => record.scheduledLogId === scheduledLogId) ?? null;
}

export async function showScheduledLog(
  vaultRoot: string,
  lookup: string,
): Promise<ScheduledLogQueryRecord | null> {
  const records = await loadScheduledLogRecords(vaultRoot);
  const normalized = lookup.trim().toLowerCase();
  return (
    records.find((record) =>
      matchesLookup(normalized, record.scheduledLogId, record.slug, record.title)
    ) ?? null
  );
}
