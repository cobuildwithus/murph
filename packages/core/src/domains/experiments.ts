import type {
  ExperimentFrontmatter,
  ExperimentStatus,
} from "@murphai/contracts";
import {
  EXPERIMENT_STATUSES,
  experimentFrontmatterSchema,
  safeParseContract,
} from "@murphai/contracts";

import { FRONTMATTER_SCHEMA_VERSIONS, ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import { emitAuditRecord } from "../audit.ts";
import { VaultError } from "../errors.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "../frontmatter.ts";
import { stageMarkdownDocumentWrite } from "../markdown-documents.ts";
import { readUtf8File } from "../fs.ts";
import { generateRecordId } from "../ids.ts";
import { toMonthlyShardRelativePath } from "../jsonl.ts";
import { sanitizePathSegment } from "../path-safety.ts";
import { defaultTimeZone, toIsoTimestamp, toLocalDayKey } from "../time.ts";
import { loadVault } from "../vault.ts";

import { buildExperimentEventRecord } from "./events.ts";
import {
  compactObject,
  normalizeOptionalText,
  normalizeTimestampInput,
  readValidatedFrontmatterDocument,
  runLoadedCanonicalWrite,
  uniqueTrimmedStringList,
  validateContract,
} from "./shared.ts";

import type { ExperimentEventRecord } from "@murphai/contracts";
import type { DateInput, FrontmatterObject, UnknownRecord } from "../types.ts";

export interface CreateExperimentInput {
  vaultRoot: string;
  slug: string;
  title?: string;
  hypothesis?: string;
  startedOn?: DateInput;
  status?: string;
}

export interface CreateExperimentResult {
  created: boolean;
  experiment: {
    id: string;
    slug: string;
    relativePath: string;
  };
  event: ExperimentEventRecord | null;
  auditPath: string | null;
}

export interface UpdateExperimentInput {
  vaultRoot: string;
  relativePath: string;
  title?: string;
  hypothesis?: string;
  startedOn?: string;
  status?: string;
  body?: string;
  tags?: string[];
}

export interface UpdateExperimentResult {
  experimentId: string;
  slug: string;
  relativePath: string;
  status: ExperimentStatus;
  updated: true;
}

interface AppendExperimentLifecycleEventInput {
  vaultRoot: string;
  relativePath: string;
  phase: "checkpoint" | "stop";
  occurredAt?: string;
  title: string;
  note?: string;
  nextStatus?: ExperimentStatus;
  endedOn?: string;
}

export interface AppendExperimentLifecycleEventResult extends UpdateExperimentResult {
  eventId: string;
  ledgerFile: string;
}

const EXPERIMENT_STATUS_SET = new Set<ExperimentStatus>(EXPERIMENT_STATUSES);

function normalizeExperimentHypothesis(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireExperimentStatus(value: unknown): ExperimentStatus {
  if (typeof value !== "string" || !EXPERIMENT_STATUS_SET.has(value as ExperimentStatus)) {
    throw new VaultError("EXPERIMENT_STATUS_INVALID", "Experiment status is invalid.");
  }

  return value as ExperimentStatus;
}

function frontmatterString(value: FrontmatterObject, key: string): string {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : "";
}

function toExperimentComparableAttributes(
  attributes:
    | Pick<ExperimentFrontmatter, "slug" | "status" | "title" | "startedOn" | "hypothesis">
    | FrontmatterObject,
): UnknownRecord {
  return compactObject({
    slug: frontmatterString(attributes as FrontmatterObject, "slug").trim(),
    status: requireExperimentStatus((attributes as FrontmatterObject).status),
    title: frontmatterString(attributes as FrontmatterObject, "title").trim(),
    startedOn: frontmatterString(attributes as FrontmatterObject, "startedOn").trim(),
    hypothesis: normalizeExperimentHypothesis((attributes as FrontmatterObject).hypothesis),
  }) as UnknownRecord;
}

function validateExperimentFrontmatter(
  value: unknown,
  relativePath = "experiment",
): ExperimentFrontmatter {
  return validateContract(
    experimentFrontmatterSchema,
    value,
    "EXPERIMENT_FRONTMATTER_INVALID",
    `Experiment frontmatter for "${relativePath}" is invalid.`,
    {
      relativePath,
    },
  );
}

export async function readExperimentFrontmatterDocument(
  vaultRoot: string,
  relativePath: string,
): Promise<{
  rawDocument: string;
  document: {
    attributes: ExperimentFrontmatter;
    body: string;
  };
}> {
  return readValidatedFrontmatterDocument(
    vaultRoot,
    relativePath,
    experimentFrontmatterSchema,
    "EXPERIMENT_FRONTMATTER_INVALID",
    `Experiment frontmatter for "${relativePath}" is invalid.`,
  );
}

function appendExperimentNoteBlock(
  body: string,
  input: {
    occurredAt: string;
    title: string;
    note?: string;
  },
): string {
  const trimmedBody = body.trimEnd();
  const lines = [`### ${input.title} (${input.occurredAt})`];
  const note = normalizeOptionalText(input.note);

  if (note) {
    lines.push("", note);
  }

  const block = `${lines.join("\n")}\n`;
  if (trimmedBody.length === 0) {
    return `## Notes\n\n${block}`;
  }

  if (trimmedBody.includes("\n## Notes\n")) {
    return `${trimmedBody}\n\n${block}`;
  }

  return `${trimmedBody}\n\n## Notes\n\n${block}`;
}

export async function createExperiment({
  vaultRoot,
  slug,
  title,
  hypothesis,
  startedOn = new Date(),
  status = "active",
}: CreateExperimentInput): Promise<CreateExperimentResult> {
  const vault = await loadVault({ vaultRoot });
  const safeSlug = sanitizePathSegment(slug, "experiment");
  const startedTimestamp = toIsoTimestamp(startedOn, "startedOn");
  const startedDay = toLocalDayKey(startedOn, vault.metadata.timezone ?? defaultTimeZone(), "startedOn");
  const relativePath = `${VAULT_LAYOUT.experimentsDirectory}/${safeSlug}.md`;
  const normalizedTitle = String(title ?? safeSlug).trim();
  const normalizedStatus = requireExperimentStatus(status);
  const normalizedHypothesis = normalizeExperimentHypothesis(hypothesis);
  const comparableAttributes = toExperimentComparableAttributes({
    slug: safeSlug,
    status: normalizedStatus,
    title: normalizedTitle,
    startedOn: startedDay,
    hypothesis: normalizedHypothesis,
  });

  try {
    const existingDocument = parseFrontmatterDocument(await readUtf8File(vaultRoot, relativePath));
    const existingResult = safeParseContract(
      experimentFrontmatterSchema,
      existingDocument.attributes,
    );

    if (!existingResult.success) {
      throw new VaultError(
        "FRONTMATTER_INVALID",
        `Existing experiment "${safeSlug}" failed contract validation.`,
        {
          relativePath,
          errors: existingResult.errors,
        },
      );
    }
    const existingAttributes = existingResult.data;

    if (
      JSON.stringify(toExperimentComparableAttributes(existingAttributes)) !==
      JSON.stringify(comparableAttributes)
    ) {
      throw new VaultError(
        "VAULT_EXPERIMENT_CONFLICT",
        `Experiment "${safeSlug}" already exists with different frontmatter.`,
        {
          relativePath,
          experimentId: existingAttributes.experimentId,
        },
      );
    }

    return {
      created: false,
      experiment: {
        id: existingAttributes.experimentId,
        slug: existingAttributes.slug,
        relativePath,
      },
      event: null,
      auditPath: null,
    };
  } catch (error) {
    if (!(error instanceof VaultError) || error.code !== "VAULT_FILE_MISSING") {
      throw error;
    }
  }

  const experimentId = generateRecordId(ID_PREFIXES.experiment);
  const attributes = validateContract(
    experimentFrontmatterSchema,
    compactObject({
      schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.experiment,
      docType: "experiment",
      experimentId,
      slug: safeSlug,
      status: normalizedStatus,
      title: normalizedTitle,
      startedOn: startedDay,
      hypothesis: normalizedHypothesis,
    }),
    "FRONTMATTER_INVALID",
    "Experiment frontmatter failed contract validation before write.",
  );
  const markdown = stringifyFrontmatterDocument({
    attributes: { ...attributes },
    body: `# ${normalizedTitle}\n\n## Plan\n\n## Notes\n\n`,
  });
  const event = buildExperimentEventRecord({
    occurredAt: startedTimestamp,
    title: normalizedTitle,
    experimentId,
    experimentSlug: safeSlug,
    phase: "start",
  });
  const ledgerFile = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    startedTimestamp,
    "occurredAt",
  );

  return runLoadedCanonicalWrite<CreateExperimentResult>({
    vaultRoot,
    operationType: "experiment_create",
    summary: `Create experiment ${safeSlug}`,
    occurredAt: startedTimestamp,
    mutate: async ({ batch }) => {
      await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath,
          created: true,
        },
        markdown,
        {
          overwrite: false,
        },
      );
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(event)}\n`);
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "experiment_create",
        commandName: "core.createExperiment",
        summary: `Created experiment ${safeSlug}.`,
        occurredAt: startedTimestamp,
        files: [relativePath, ledgerFile],
        targetIds: [experimentId, event.id],
      });

      return {
        created: true,
        experiment: {
          id: experimentId,
          slug: safeSlug,
          relativePath,
        },
        event,
        auditPath: audit.relativePath,
      };
    },
  });
}

export async function updateExperiment(
  input: UpdateExperimentInput,
): Promise<UpdateExperimentResult> {
  const { document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
  );
  const nextAttributes = validateExperimentFrontmatter(
    compactObject({
      ...document.attributes,
      title: normalizeOptionalText(input.title) ?? document.attributes.title,
      hypothesis:
        input.hypothesis === undefined
          ? document.attributes.hypothesis
          : normalizeOptionalText(input.hypothesis) ?? undefined,
      startedOn: input.startedOn ?? document.attributes.startedOn,
      status:
        input.status === undefined
          ? document.attributes.status
          : requireExperimentStatus(input.status),
      tags:
        input.tags === undefined
          ? document.attributes.tags
          : uniqueTrimmedStringList(input.tags) ?? undefined,
    }),
    input.relativePath,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: nextAttributes,
    body: input.body ?? document.body,
  });

  return runLoadedCanonicalWrite<UpdateExperimentResult>({
    vaultRoot: input.vaultRoot,
    operationType: "experiment_update",
    summary: `Update experiment ${nextAttributes.experimentId}`,
    occurredAt: new Date(),
    mutate: async ({ batch }) => {
      await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath: input.relativePath,
          created: false,
        },
        nextMarkdown,
        {
          overwrite: true,
        },
      );

      return {
        experimentId: nextAttributes.experimentId,
        slug: nextAttributes.slug,
        relativePath: input.relativePath,
        status: nextAttributes.status,
        updated: true,
      };
    },
  });
}

async function appendExperimentLifecycleEvent(
  input: AppendExperimentLifecycleEventInput,
): Promise<AppendExperimentLifecycleEventResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const { document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
  );
  const occurredAt = normalizeTimestampInput(input.occurredAt ?? new Date());
  if (!occurredAt) {
    throw new VaultError("INVALID_TIMESTAMP", "Experiment lifecycle event requires occurredAt.");
  }

  const nextAttributes = validateExperimentFrontmatter(
    compactObject({
      ...document.attributes,
      endedOn: input.endedOn ?? document.attributes.endedOn,
      status: input.nextStatus ?? document.attributes.status,
    }),
    input.relativePath,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: nextAttributes,
    body: appendExperimentNoteBlock(document.body, {
      occurredAt,
      title: input.title,
      note: input.note,
    }),
  });
  const eventRecord = buildExperimentEventRecord({
    occurredAt,
    title: `${document.attributes.title} ${input.title}`.trim(),
    note: input.note,
    experimentId: document.attributes.experimentId,
    experimentSlug: document.attributes.slug,
    phase: input.phase,
    timeZone: vault.metadata.timezone,
  });
  const ledgerFile = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    occurredAt,
    "occurredAt",
  );

  return runLoadedCanonicalWrite<AppendExperimentLifecycleEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "experiment_lifecycle_event",
    summary: `Append ${input.phase} lifecycle event for ${document.attributes.experimentId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath: input.relativePath,
          created: false,
        },
        nextMarkdown,
        {
          overwrite: true,
        },
      );
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(eventRecord)}\n`);

      return {
        experimentId: document.attributes.experimentId,
        slug: document.attributes.slug,
        relativePath: input.relativePath,
        status: nextAttributes.status,
        eventId: eventRecord.id,
        ledgerFile,
        updated: true,
      };
    },
  });
}

export async function checkpointExperiment(
  input: Omit<AppendExperimentLifecycleEventInput, "phase" | "nextStatus" | "endedOn">,
): Promise<AppendExperimentLifecycleEventResult> {
  return appendExperimentLifecycleEvent({
    ...input,
    phase: "checkpoint",
  });
}

export async function stopExperiment(
  input: {
    vaultRoot: string;
    relativePath: string;
    occurredAt?: string;
    title: string;
    note?: string;
  },
): Promise<AppendExperimentLifecycleEventResult> {
  const occurredAt = normalizeTimestampInput(input.occurredAt ?? new Date());
  if (!occurredAt) {
    throw new VaultError("INVALID_TIMESTAMP", "Experiment lifecycle event requires occurredAt.");
  }
  const vault = await loadVault({ vaultRoot: input.vaultRoot });

  return appendExperimentLifecycleEvent({
    ...input,
    phase: "stop",
    occurredAt,
    nextStatus: "completed",
    endedOn: toLocalDayKey(occurredAt, vault.metadata.timezone ?? defaultTimeZone(), "occurredAt"),
  });
}
