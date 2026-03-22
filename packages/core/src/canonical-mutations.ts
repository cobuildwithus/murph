import type {
  ContractSchema,
  CoreFrontmatter,
  EventRecord,
  ExperimentFrontmatter,
  ExperimentStatus,
  JournalDayFrontmatter,
  ProviderFrontmatter,
  VaultMetadata,
} from "@healthybob/contracts";
import {
  CONTRACT_SCHEMA_VERSION,
  EXPERIMENT_STATUSES,
  coreFrontmatterSchema,
  eventRecordSchema,
  experimentFrontmatterSchema,
  journalDayFrontmatterSchema,
  providerFrontmatterSchema,
  safeParseContract,
  vaultMetadataSchema,
} from "@healthybob/contracts";

import { FRONTMATTER_SCHEMA_VERSIONS, ID_PREFIXES, VAULT_LAYOUT } from "./constants.js";
import { VaultError } from "./errors.js";
import { readJsonFile, readUtf8File, walkVaultFiles } from "./fs.js";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.js";
import { generateRecordId } from "./ids.js";
import { readJsonlRecords, toMonthlyShardRelativePath } from "./jsonl.js";
import { ensureJournalDay as ensureJournalDayInternal } from "./mutations.js";
import { runCanonicalWrite } from "./operations/write-batch.js";
import { loadVault } from "./vault.js";

type JsonObject = Record<string, unknown>;
type JournalMutationKey = "eventIds" | "sampleStreams";
type JournalMutationOperation = "link" | "unlink";
type EventWriteKind =
  | "symptom"
  | "note"
  | "observation"
  | "medication_intake"
  | "supplement_intake"
  | "activity_session"
  | "sleep_session";

interface UpdateExperimentInput {
  vaultRoot: string;
  relativePath: string;
  title?: string;
  hypothesis?: string;
  startedOn?: string;
  status?: string;
  body?: string;
  tags?: string[];
}

interface UpdateExperimentResult {
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

interface AppendExperimentLifecycleEventResult extends UpdateExperimentResult {
  eventId: string;
  ledgerFile: string;
}

interface AppendJournalInput {
  vaultRoot: string;
  date: string;
  text: string;
}

interface AppendJournalResult {
  relativePath: string;
  created: boolean;
  updated: true;
}

interface MutateJournalLinksInput {
  vaultRoot: string;
  date: string;
  key: JournalMutationKey;
  values: string[];
  operation: JournalMutationOperation;
}

interface MutateJournalLinksResult {
  relativePath: string;
  created: boolean;
  changed: number;
  eventIds: string[];
  sampleStreams: string[];
}

interface UpdateVaultSummaryInput {
  vaultRoot: string;
  title?: string;
  timezone?: string;
}

interface UpdateVaultSummaryResult {
  metadataFile: string;
  corePath: string;
  title: string;
  timezone: string;
  updatedAt: string;
  updated: true;
}

interface UpsertProviderInput {
  vaultRoot: string;
  providerId?: string;
  slug?: string;
  title: string;
  status?: string;
  specialty?: string;
  organization?: string;
  location?: string;
  website?: string;
  phone?: string;
  note?: string;
  aliases?: string[];
  body?: string;
}

interface UpsertProviderResult {
  providerId: string;
  relativePath: string;
  created: boolean;
}

interface UpsertEventInput {
  vaultRoot: string;
  payload: JsonObject;
}

interface UpsertEventResult {
  eventId: string;
  ledgerFile: string;
  created: boolean;
}

interface InboxPromotionCaptureAttachment {
  attachmentId?: string | null;
  ordinal: number;
  externalId?: string | null;
  kind: "image" | "audio" | "video" | "document" | "other";
  originalPath?: string | null;
  storedPath?: string | null;
  fileName?: string | null;
}

interface InboxPromotionCapture {
  captureId: string;
  eventId: string;
  source: string;
  occurredAt: string;
  text: string | null;
  thread: {
    id: string;
    title?: string | null;
  };
  actor: {
    id?: string | null;
    displayName?: string | null;
  };
  attachments: InboxPromotionCaptureAttachment[];
}

interface PromoteInboxJournalInput {
  vaultRoot: string;
  date: string;
  capture: InboxPromotionCapture;
}

interface PromoteInboxJournalResult {
  lookupId: string;
  relatedId: string;
  journalPath: string;
  created: boolean;
  appended: boolean;
  linked: boolean;
}

interface PromoteInboxExperimentNoteInput {
  vaultRoot: string;
  relativePath: string;
  capture: InboxPromotionCapture;
}

interface PromoteInboxExperimentNoteResult {
  experimentId: string;
  relatedId: string;
  experimentPath: string;
  experimentSlug: string;
  appended: boolean;
}

interface PromotionMarkdownTargetSpec<TContext> {
  sectionHeading: string;
  sectionStartMarker: string;
  sectionEndMarker: string;
  blockHeading(capture: InboxPromotionCapture, context: TContext): string;
  blockExtraLines?(capture: InboxPromotionCapture, context: TContext): string[];
}

interface ProviderEntry {
  relativePath: string;
  markdown: string;
  body: string;
  attributes: ProviderFrontmatter;
}

const EXPERIMENT_STATUS_SET = new Set<ExperimentStatus>(EXPERIMENT_STATUSES);
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EVENT_WRITE_KIND_SET = new Set<EventWriteKind>([
  "symptom",
  "note",
  "observation",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "sleep_session",
]);
const RESERVED_EVENT_KEYS = new Set([
  "schemaVersion",
  "id",
  "eventId",
  "kind",
  "occurredAt",
  "recordedAt",
  "dayKey",
  "source",
  "title",
  "note",
  "tags",
  "relatedIds",
  "rawRefs",
]);
const JOURNAL_PROMOTION_SECTION_START = "<!-- inbox-journal-captures:start -->";
const JOURNAL_PROMOTION_SECTION_END = "<!-- inbox-journal-captures:end -->";
const EXPERIMENT_NOTE_SECTION_START = "<!-- inbox-experiment-notes:start -->";
const EXPERIMENT_NOTE_SECTION_END = "<!-- inbox-experiment-notes:end -->";
const JOURNAL_PROMOTION_MARKDOWN_SPEC = {
  sectionHeading: "## Inbox Captures",
  sectionStartMarker: JOURNAL_PROMOTION_SECTION_START,
  sectionEndMarker: JOURNAL_PROMOTION_SECTION_END,
  blockHeading(capture: InboxPromotionCapture): string {
    return `### Inbox Capture ${capture.captureId}`;
  },
} satisfies PromotionMarkdownTargetSpec<undefined>;
const EXPERIMENT_PROMOTION_MARKDOWN_SPEC = {
  sectionHeading: "## Inbox Experiment Notes",
  sectionStartMarker: EXPERIMENT_NOTE_SECTION_START,
  sectionEndMarker: EXPERIMENT_NOTE_SECTION_END,
  blockHeading(capture: InboxPromotionCapture): string {
    return `### Inbox Note ${capture.captureId}`;
  },
  blockExtraLines(
    _capture: InboxPromotionCapture,
    context: {
      experimentSlug: string;
    },
  ): string[] {
    return [`Experiment: ${context.experimentSlug}`];
  },
} satisfies PromotionMarkdownTargetSpec<{
  experimentSlug: string;
}>;

function compactObject<TRecord extends Record<string, unknown>>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as TRecord;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueTrimmedStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? uniqueStrings(normalized) : undefined;
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function safeParseDocument<T>(
  schema: ContractSchema<T>,
  markdown: string,
  relativePath: string,
  code: string,
  message: string,
): {
  attributes: T;
  body: string;
} {
  const document = parseFrontmatterDocument(markdown);
  const result = safeParseContract(schema, document.attributes);

  if (!result.success) {
    throw new VaultError(code, message, {
      relativePath,
      errors: result.errors,
    });
  }

  return {
    attributes: result.data,
    body: document.body,
  };
}

function validateVaultMetadata(value: unknown): VaultMetadata {
  const result = safeParseContract(vaultMetadataSchema, value);
  if (!result.success) {
    throw new VaultError("HB_VAULT_METADATA_INVALID", "Vault metadata is invalid.", {
      errors: result.errors,
    });
  }

  return result.data;
}

function validateCoreFrontmatter(
  value: unknown,
  relativePath = VAULT_LAYOUT.coreDocument,
): CoreFrontmatter {
  const result = safeParseContract(coreFrontmatterSchema, value);
  if (!result.success) {
    throw new VaultError(
      "HB_CORE_FRONTMATTER_INVALID",
      `CORE frontmatter for "${relativePath}" is invalid.`,
      {
        relativePath,
        errors: result.errors,
      },
    );
  }

  return result.data;
}

function validateExperimentFrontmatter(
  value: unknown,
  relativePath = "experiment",
): ExperimentFrontmatter {
  const result = safeParseContract(experimentFrontmatterSchema, value);
  if (!result.success) {
    throw new VaultError(
      "HB_EXPERIMENT_FRONTMATTER_INVALID",
      `Experiment frontmatter for "${relativePath}" is invalid.`,
      {
        relativePath,
        errors: result.errors,
      },
    );
  }

  return result.data;
}

function validateJournalFrontmatter(
  value: unknown,
  relativePath = "journal",
): JournalDayFrontmatter {
  const result = safeParseContract(journalDayFrontmatterSchema, value);
  if (!result.success) {
    throw new VaultError(
      "HB_JOURNAL_FRONTMATTER_INVALID",
      `Journal frontmatter for "${relativePath}" is invalid.`,
      {
        relativePath,
        errors: result.errors,
      },
    );
  }

  return result.data;
}

function validateProviderFrontmatter(value: unknown, relativePath: string): ProviderFrontmatter {
  const result = safeParseContract(providerFrontmatterSchema, value);
  if (!result.success) {
    throw new VaultError("HB_PROVIDER_FRONTMATTER_INVALID", "Provider frontmatter is invalid.", {
      relativePath,
      errors: result.errors,
    });
  }

  return result.data;
}

function appendMarkdownParagraph(body: string, text: string): string {
  const trimmedBody = body.trimEnd();
  const trimmedText = text.trim();

  if (trimmedBody.length === 0) {
    return `${trimmedText}\n`;
  }

  return `${trimmedBody}\n\n${trimmedText}\n`;
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

function replaceMarkdownTitle(body: string, title: string): string {
  const trimmedBody = body.trimStart();
  if (trimmedBody.startsWith("# ")) {
    return body.replace(/^# .*(?:\r?\n)?/u, `# ${title}\n`);
  }

  return `# ${title}\n\n${body.trimStart()}`;
}

function requireExperimentStatus(value: unknown): ExperimentStatus {
  if (typeof value !== "string" || !EXPERIMENT_STATUS_SET.has(value as ExperimentStatus)) {
    throw new VaultError("HB_EXPERIMENT_STATUS_INVALID", "Experiment status is invalid.");
  }

  return value as ExperimentStatus;
}

function normalizeProviderSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (!SLUG_PATTERN.test(normalized)) {
    throw new VaultError(
      "HB_PROVIDER_SLUG_INVALID",
      "Provider payload requires a valid slug or title-derived slug.",
    );
  }

  return normalized;
}

function normalizeProviderBody(
  nextBody: string | undefined,
  existingBody: string | null,
  title: string,
  note: string | undefined,
): string {
  if (typeof nextBody === "string" && nextBody.trim().length > 0) {
    return ensureMarkdownHeading(nextBody, title);
  }

  if (typeof existingBody === "string" && existingBody.trim().length > 0) {
    return ensureMarkdownHeading(existingBody, title);
  }

  const noteBlock = note ? `${note}\n` : "";
  return `# ${title}\n\n## Notes\n\n${noteBlock}`;
}

function ensureMarkdownHeading(body: string, title: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("# ")) {
    return body.replace(/^# .*(?:\r?\n)?/u, `# ${title}\n`);
  }

  return `# ${title}\n\n${body.trimStart()}`;
}

function providerRelativePath(slug: string): string {
  return `${VAULT_LAYOUT.providersDirectory}/${slug}.md`;
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requireText(value: unknown, message: string): string {
  const normalized = normalizeOptionalText(valueAsString(value));
  if (!normalized) {
    throw new VaultError("HB_INVALID_INPUT", message);
  }

  return normalized;
}

function normalizeTimestampInput(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new VaultError("HB_INVALID_TIMESTAMP", `Invalid timestamp "${String(value)}".`);
  }

  return date.toISOString();
}

function normalizeLocalDate(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return LOCAL_DATE_PATTERN.test(value) ? value : undefined;
}

function eventSpecificFields(payload: JsonObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key, value]) => !RESERVED_EVENT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function buildManualEventRecord(payload: JsonObject): EventRecord {
  const kind = valueAsString(payload.kind);
  if (!kind || !EVENT_WRITE_KIND_SET.has(kind as EventWriteKind)) {
    throw new VaultError("HB_EVENT_KIND_INVALID", "Event payload requires a supported kind.");
  }

  const occurredAt = normalizeTimestampInput(payload.occurredAt);
  if (!occurredAt) {
    throw new VaultError("HB_EVENT_OCCURRED_AT_MISSING", "Event payload requires occurredAt.");
  }

  const title = requireText(payload.title, "Event payload requires a title.");
  const eventId = normalizeOptionalText(
    typeof payload.id === "string" ? payload.id : valueAsString(payload.eventId),
  );
  const source = normalizeOptionalText(valueAsString(payload.source)) ?? "manual";
  const record = compactObject({
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: eventId ?? generateRecordId(ID_PREFIXES.event),
    kind,
    occurredAt,
    recordedAt: normalizeTimestampInput(payload.recordedAt) ?? new Date().toISOString(),
    dayKey: normalizeLocalDate(valueAsString(payload.dayKey)) ?? occurredAt.slice(0, 10),
    source,
    title,
    note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
    tags: uniqueTrimmedStringList(payload.tags) ?? undefined,
    relatedIds: uniqueTrimmedStringList(payload.relatedIds) ?? undefined,
    rawRefs: uniqueTrimmedStringList(payload.rawRefs) ?? undefined,
    ...eventSpecificFields(payload),
  });
  const result = safeParseContract(eventRecordSchema, record);

  if (!result.success) {
    throw new VaultError(
      "HB_EVENT_CONTRACT_INVALID",
      `Event payload for kind "${kind}" is invalid.`,
      { errors: result.errors },
    );
  }

  return result.data;
}

function buildExperimentLifecycleEventRecord(input: {
  occurredAt: string;
  title: string;
  note?: string;
  experimentId: string;
  experimentSlug: string;
  phase: "checkpoint" | "stop";
}): EventRecord {
  const record = compactObject({
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: generateRecordId(ID_PREFIXES.event),
    kind: "experiment_event",
    occurredAt: input.occurredAt,
    recordedAt: new Date().toISOString(),
    dayKey: input.occurredAt.slice(0, 10),
    source: "manual",
    title: input.title.trim(),
    note: normalizeOptionalText(input.note) ?? undefined,
    relatedIds: [input.experimentId],
    experimentId: input.experimentId,
    experimentSlug: input.experimentSlug,
    phase: input.phase,
  });
  const result = safeParseContract(eventRecordSchema, record);

  if (!result.success) {
    throw new VaultError(
      "HB_EVENT_CONTRACT_INVALID",
      'Event payload for kind "experiment_event" is invalid.',
      { errors: result.errors },
    );
  }

  return result.data;
}

async function findEventLedgerFileById(
  vaultRoot: string,
  eventId: string,
): Promise<string | null> {
  const relativePaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({
      vaultRoot,
      relativePath,
    });
    if (
      records.some(
        (record) =>
          typeof (record as { id?: unknown }).id === "string" &&
          (record as { id: string }).id === eventId,
      )
    ) {
      return relativePath;
    }
  }

  return null;
}

async function readProviderEntries(vaultRoot: string): Promise<ProviderEntry[]> {
  const relativePaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.providersDirectory, {
    extension: ".md",
  });
  const entries: ProviderEntry[] = [];

  for (const relativePath of relativePaths) {
    const markdown = await readUtf8File(vaultRoot, relativePath);
    const document = parseFrontmatterDocument(markdown);
    entries.push({
      relativePath,
      markdown,
      body: document.body,
      attributes: validateProviderFrontmatter(document.attributes, relativePath),
    });
  }

  return entries;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildCapturePromotionBlock<TContext>(input: {
  capture: InboxPromotionCapture;
  marker: string;
  context: TContext;
  spec: PromotionMarkdownTargetSpec<TContext>;
}): string {
  const { capture, marker, context, spec } = input;
  const lines = [
    marker,
    spec.blockHeading(capture, context),
    ...(spec.blockExtraLines?.(capture, context) ?? []),
    `Occurred at: ${capture.occurredAt}`,
    `Source: ${capture.source}`,
    `Thread: ${capture.thread.title ?? capture.thread.id}`,
    `Event: ${capture.eventId}`,
  ];

  const actorName = normalizeNullableString(capture.actor.displayName);
  const actorId = normalizeNullableString(capture.actor.id);
  if (actorName || actorId) {
    lines.push(`Actor: ${actorName ?? actorId ?? "unknown"}`);
  }

  if (capture.attachments.length > 0) {
    lines.push("Attachments:");
    for (const attachment of capture.attachments) {
      const attachmentLabel =
        attachment.fileName ??
        attachment.storedPath ??
        attachment.originalPath ??
        attachment.externalId ??
        `attachment-${attachment.ordinal}`;
      lines.push(
        `- ${attachment.attachmentId ?? `attachment-${attachment.ordinal}`} | ${attachment.kind} | ${attachmentLabel}`,
      );
    }
  }

  const text = normalizeNullableString(capture.text);
  if (text) {
    lines.push("", text);
  }

  return lines.join("\n");
}

function upsertMarkdownSectionBlock<TContext>(
  body: string,
  block: string,
  spec: PromotionMarkdownTargetSpec<TContext>,
): {
  body: string;
  appended: boolean;
} {
  const normalizedBody = body.replace(/\s*$/, "");

  if (
    normalizedBody.includes(spec.sectionStartMarker) &&
    normalizedBody.includes(spec.sectionEndMarker)
  ) {
    return {
      body: normalizedBody.replace(
        spec.sectionEndMarker,
        `${block}\n\n${spec.sectionEndMarker}`,
      ),
      appended: true,
    };
  }

  const separator = normalizedBody.length > 0 ? "\n\n" : "";
  return {
    body:
      `${normalizedBody}${separator}${spec.sectionHeading}\n\n` +
      `${spec.sectionStartMarker}\n\n${block}\n\n${spec.sectionEndMarker}\n`,
    appended: true,
  };
}

function upsertPromotionBody<TContext>(input: {
  body: string;
  capture: InboxPromotionCapture;
  context: TContext;
  spec: PromotionMarkdownTargetSpec<TContext>;
}): {
  body: string;
  appended: boolean;
} {
  const { body, capture, context, spec } = input;
  const marker = `<!-- inbox-capture:${capture.captureId} -->`;
  if (body.includes(marker)) {
    return {
      body,
      appended: false,
    };
  }

  const block = buildCapturePromotionBlock({
    capture,
    marker,
    context,
    spec,
  });
  return upsertMarkdownSectionBlock(body, block, spec);
}

export async function updateExperiment(
  input: UpdateExperimentInput,
): Promise<UpdateExperimentResult> {
  await loadVault({ vaultRoot: input.vaultRoot });
  const rawDocument = await readUtf8File(input.vaultRoot, input.relativePath);
  const document = safeParseDocument(
    experimentFrontmatterSchema,
    rawDocument,
    input.relativePath,
    "HB_EXPERIMENT_FRONTMATTER_INVALID",
    `Experiment frontmatter for "${input.relativePath}" is invalid.`,
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

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "experiment_update",
    summary: `Update experiment ${nextAttributes.experimentId}`,
    occurredAt: new Date(),
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(input.relativePath, nextMarkdown, {
        overwrite: true,
      });

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
  await loadVault({ vaultRoot: input.vaultRoot });
  const rawDocument = await readUtf8File(input.vaultRoot, input.relativePath);
  const document = safeParseDocument(
    experimentFrontmatterSchema,
    rawDocument,
    input.relativePath,
    "HB_EXPERIMENT_FRONTMATTER_INVALID",
    `Experiment frontmatter for "${input.relativePath}" is invalid.`,
  );
  const occurredAt = normalizeTimestampInput(input.occurredAt ?? new Date());
  if (!occurredAt) {
    throw new VaultError("HB_INVALID_TIMESTAMP", "Experiment lifecycle event requires occurredAt.");
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
  const eventRecord = buildExperimentLifecycleEventRecord({
    occurredAt,
    title: `${document.attributes.title} ${input.title}`.trim(),
    note: input.note,
    experimentId: document.attributes.experimentId,
    experimentSlug: document.attributes.slug,
    phase: input.phase,
  });
  const ledgerFile = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    occurredAt,
    "occurredAt",
  );

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "experiment_lifecycle_event",
    summary: `Append ${input.phase} lifecycle event for ${document.attributes.experimentId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(input.relativePath, nextMarkdown, {
        overwrite: true,
      });
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
    throw new VaultError("HB_INVALID_TIMESTAMP", "Experiment lifecycle event requires occurredAt.");
  }

  return appendExperimentLifecycleEvent({
    ...input,
    phase: "stop",
    occurredAt,
    nextStatus: "completed",
    endedOn: occurredAt.slice(0, 10),
  });
}

export async function appendJournal(input: AppendJournalInput): Promise<AppendJournalResult> {
  const ensured = await ensureJournalDayInternal({
    vaultRoot: input.vaultRoot,
    date: input.date,
  });
  const rawDocument = await readUtf8File(input.vaultRoot, ensured.relativePath);
  const document = safeParseDocument(
    journalDayFrontmatterSchema,
    rawDocument,
    ensured.relativePath,
    "HB_JOURNAL_FRONTMATTER_INVALID",
    `Journal frontmatter for "${ensured.relativePath}" is invalid.`,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: document.attributes,
    body: appendMarkdownParagraph(document.body, input.text),
  });

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "journal_append_text",
    summary: `Append journal text for ${input.date}`,
    occurredAt: `${input.date}T00:00:00.000Z`,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(ensured.relativePath, nextMarkdown, {
        overwrite: true,
      });

      return {
        relativePath: ensured.relativePath,
        created: ensured.created,
        updated: true,
      };
    },
  });
}

async function mutateJournalLinks(
  input: MutateJournalLinksInput,
): Promise<MutateJournalLinksResult> {
  const ensured =
    input.operation === "link"
      ? await ensureJournalDayInternal({
          vaultRoot: input.vaultRoot,
          date: input.date,
        })
      : null;
  const relativePath =
    ensured?.relativePath ?? `${VAULT_LAYOUT.journalDirectory}/${input.date.slice(0, 4)}/${input.date}.md`;

  let rawDocument: string;
  try {
    rawDocument = await readUtf8File(input.vaultRoot, relativePath);
  } catch (error) {
    if (error instanceof VaultError && error.code === "VAULT_FILE_MISSING") {
      throw new VaultError("HB_JOURNAL_DAY_MISSING", `No journal day found for "${input.date}".`);
    }

    throw error;
  }

  const document = safeParseDocument(
    journalDayFrontmatterSchema,
    rawDocument,
    relativePath,
    "HB_JOURNAL_FRONTMATTER_INVALID",
    `Journal frontmatter for "${relativePath}" is invalid.`,
  );
  const currentValues = new Set(document.attributes[input.key]);
  let changed = 0;

  for (const value of uniqueTrimmedStringList(input.values) ?? []) {
    if (input.operation === "link") {
      if (!currentValues.has(value)) {
        currentValues.add(value);
        changed += 1;
      }
      continue;
    }

    if (currentValues.delete(value)) {
      changed += 1;
    }
  }

  const nextAttributes = validateJournalFrontmatter(
    {
      ...document.attributes,
      [input.key]: sortStrings([...currentValues]),
    },
    relativePath,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: nextAttributes,
    body: document.body,
  });

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: input.operation === "link" ? "journal_link" : "journal_unlink",
    summary: `${input.operation === "link" ? "Link" : "Unlink"} journal ${input.key} for ${input.date}`,
    occurredAt: `${input.date}T00:00:00.000Z`,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(relativePath, nextMarkdown, {
        overwrite: true,
      });

      return {
        relativePath,
        created: ensured?.created ?? false,
        changed,
        eventIds: nextAttributes.eventIds,
        sampleStreams: nextAttributes.sampleStreams,
      };
    },
  });
}

export async function linkJournalEventIds(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "eventIds",
    operation: "link",
  });
}

export async function unlinkJournalEventIds(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "eventIds",
    operation: "unlink",
  });
}

export async function linkJournalStreams(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "sampleStreams",
    operation: "link",
  });
}

export async function unlinkJournalStreams(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "sampleStreams",
    operation: "unlink",
  });
}

export async function updateVaultSummary(
  input: UpdateVaultSummaryInput,
): Promise<UpdateVaultSummaryResult> {
  await loadVault({ vaultRoot: input.vaultRoot });
  const metadata = validateVaultMetadata(
    await readJsonFile(input.vaultRoot, VAULT_LAYOUT.metadata),
  );
  const coreDocument = safeParseDocument(
    coreFrontmatterSchema,
    await readUtf8File(input.vaultRoot, VAULT_LAYOUT.coreDocument),
    VAULT_LAYOUT.coreDocument,
    "HB_CORE_FRONTMATTER_INVALID",
    `CORE frontmatter for "${VAULT_LAYOUT.coreDocument}" is invalid.`,
  );
  const nextTitle = normalizeOptionalText(input.title) ?? metadata.title;
  const nextTimezone = normalizeOptionalText(input.timezone) ?? metadata.timezone;
  const updatedAt = new Date().toISOString();
  const nextMetadata = validateVaultMetadata({
    ...metadata,
    title: nextTitle,
    timezone: nextTimezone,
  });
  const nextCoreAttributes = validateCoreFrontmatter(
    compactObject({
      ...coreDocument.attributes,
      title: nextTitle,
      timezone: nextTimezone,
      updatedAt,
    }),
  );
  const nextCoreMarkdown = stringifyFrontmatterDocument({
    attributes: nextCoreAttributes,
    body: replaceMarkdownTitle(coreDocument.body, nextTitle),
  });

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "vault_summary_update",
    summary: "Update vault summary",
    occurredAt: updatedAt,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(
        VAULT_LAYOUT.metadata,
        `${JSON.stringify(nextMetadata, null, 2)}\n`,
        {
          overwrite: true,
        },
      );
      await batch.stageTextWrite(VAULT_LAYOUT.coreDocument, nextCoreMarkdown, {
        overwrite: true,
      });

      return {
        metadataFile: VAULT_LAYOUT.metadata,
        corePath: VAULT_LAYOUT.coreDocument,
        title: nextTitle,
        timezone: nextTimezone,
        updatedAt,
        updated: true,
      };
    },
  });
}

export async function upsertProvider(
  input: UpsertProviderInput,
): Promise<UpsertProviderResult> {
  await loadVault({ vaultRoot: input.vaultRoot });
  const existingEntries = await readProviderEntries(input.vaultRoot);
  const normalizedTitle = input.title.trim();
  const desiredSlug = normalizeProviderSlug(input.slug ?? normalizedTitle);
  const requestedId = normalizeOptionalText(input.providerId);
  const existingById =
    requestedId
      ? existingEntries.find((entry) => entry.attributes.providerId === requestedId)
      : undefined;
  const slugOwner = existingEntries.find((entry) => entry.attributes.slug === desiredSlug);

  if (slugOwner && requestedId && slugOwner.attributes.providerId !== requestedId) {
    throw new VaultError(
      "HB_PROVIDER_CONFLICT",
      `Provider slug "${desiredSlug}" is already owned by "${slugOwner.attributes.providerId}".`,
      {
        conflictingProviderId: slugOwner.attributes.providerId,
        providerId: requestedId,
        slug: desiredSlug,
      },
    );
  }

  const existing = existingById ?? slugOwner;
  const providerId = requestedId ?? existing?.attributes.providerId ?? generateRecordId(ID_PREFIXES.provider);
  const relativePath = providerRelativePath(desiredSlug);
  const previousPath = existing?.relativePath ?? null;
  const nextAttributes = validateProviderFrontmatter(
    compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.providerFrontmatter,
      docType: "provider",
      providerId,
      slug: desiredSlug,
      title: normalizedTitle,
      status: normalizeOptionalText(input.status) ?? undefined,
      specialty: normalizeOptionalText(input.specialty) ?? undefined,
      organization: normalizeOptionalText(input.organization) ?? undefined,
      location: normalizeOptionalText(input.location) ?? undefined,
      website: normalizeOptionalText(input.website) ?? undefined,
      phone: normalizeOptionalText(input.phone) ?? undefined,
      note: normalizeOptionalText(input.note) ?? undefined,
      aliases: uniqueTrimmedStringList(input.aliases) ?? undefined,
    }),
    relativePath,
  );
  const body = normalizeProviderBody(
    input.body,
    existing?.body ?? null,
    nextAttributes.title,
    nextAttributes.note,
  );
  const markdown = stringifyFrontmatterDocument({
    attributes: nextAttributes,
    body,
  });

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "provider_upsert",
    summary: `Upsert provider ${providerId}`,
    occurredAt: new Date(),
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(relativePath, markdown, {
        overwrite: true,
      });
      if (previousPath && previousPath !== relativePath) {
        await batch.stageDelete(previousPath);
      }

      return {
        providerId,
        relativePath,
        created: existing === undefined,
      };
    },
  });
}

export async function upsertEvent(
  input: UpsertEventInput,
): Promise<UpsertEventResult> {
  await loadVault({ vaultRoot: input.vaultRoot });
  const eventRecord = buildManualEventRecord(input.payload);
  const existingLedgerFile = await findEventLedgerFileById(input.vaultRoot, eventRecord.id);
  const ledgerFile = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    eventRecord.occurredAt,
    "occurredAt",
  );

  if (existingLedgerFile) {
    return {
      eventId: eventRecord.id,
      ledgerFile: existingLedgerFile,
      created: false,
    };
  }

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "event_upsert",
    summary: `Upsert event ${eventRecord.id}`,
    occurredAt: eventRecord.occurredAt,
    mutate: async ({ batch }) => {
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(eventRecord)}\n`);

      return {
        eventId: eventRecord.id,
        ledgerFile,
        created: true,
      };
    },
  });
}

export async function promoteInboxJournal(
  input: PromoteInboxJournalInput,
): Promise<PromoteInboxJournalResult> {
  const ensured = await ensureJournalDayInternal({
    vaultRoot: input.vaultRoot,
    date: input.date,
  });
  const rawDocument = await readUtf8File(input.vaultRoot, ensured.relativePath);
  const document = safeParseDocument(
    journalDayFrontmatterSchema,
    rawDocument,
    ensured.relativePath,
    "HB_JOURNAL_FRONTMATTER_INVALID",
    `Journal frontmatter for "${ensured.relativePath}" is invalid.`,
  );
  const currentEventIds = [...document.attributes.eventIds];
  const bodyUpdate = upsertPromotionBody({
    body: document.body,
    capture: input.capture,
    context: undefined,
    spec: JOURNAL_PROMOTION_MARKDOWN_SPEC,
  });
  const nextDocument = stringifyFrontmatterDocument({
    attributes: validateJournalFrontmatter(
      {
        ...document.attributes,
        eventIds: uniqueStrings([...currentEventIds, input.capture.eventId]),
      },
      ensured.relativePath,
    ),
    body: bodyUpdate.body,
  });

  if (nextDocument !== rawDocument) {
    await runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "inbox_promote_journal",
      summary: `Promote inbox capture ${input.capture.captureId} into journal ${input.date}`,
      occurredAt: new Date(),
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(ensured.relativePath, nextDocument, {
          overwrite: true,
        });
        return undefined;
      },
    });
  }

  return {
    lookupId: `journal:${input.date}`,
    relatedId: input.capture.eventId,
    journalPath: ensured.relativePath,
    created: ensured.created,
    appended: bodyUpdate.appended,
    linked: !currentEventIds.includes(input.capture.eventId),
  };
}

export async function promoteInboxExperimentNote(
  input: PromoteInboxExperimentNoteInput,
): Promise<PromoteInboxExperimentNoteResult> {
  const rawDocument = await readUtf8File(input.vaultRoot, input.relativePath);
  const document = safeParseDocument(
    experimentFrontmatterSchema,
    rawDocument,
    input.relativePath,
    "HB_EXPERIMENT_FRONTMATTER_INVALID",
    `Experiment frontmatter for "${input.relativePath}" is invalid.`,
  );
  const bodyUpdate = upsertPromotionBody({
    body: document.body,
    capture: input.capture,
    context: {
      experimentSlug: document.attributes.slug,
    },
    spec: EXPERIMENT_PROMOTION_MARKDOWN_SPEC,
  });
  const nextDocument = stringifyFrontmatterDocument({
    attributes: document.attributes,
    body: bodyUpdate.body,
  });

  if (nextDocument !== rawDocument) {
    await runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "inbox_promote_experiment_note",
      summary: `Promote inbox capture ${input.capture.captureId} into experiment ${document.attributes.experimentId}`,
      occurredAt: new Date(),
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(input.relativePath, nextDocument, {
          overwrite: true,
        });
        return undefined;
      },
    });
  }

  return {
    experimentId: document.attributes.experimentId,
    relatedId: input.capture.eventId,
    experimentPath: input.relativePath,
    experimentSlug: document.attributes.slug,
    appended: bodyUpdate.appended,
  };
}
