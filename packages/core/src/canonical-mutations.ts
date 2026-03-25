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
import { ensureJournalDay as ensureJournalDayInternal } from "./domains/journal.js";
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
  | "sleep_session"
  | "intervention_session";

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
  "intervention_session",
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

async function readExperimentFrontmatterDocument(
  vaultRoot: string,
  relativePath: string,
): Promise<{
  rawDocument: string;
  document: {
    attributes: ExperimentFrontmatter;
    body: string;
  };
}> {
  const rawDocument = await readUtf8File(vaultRoot, relativePath);
  return {
    rawDocument,
    document: safeParseDocument(
      experimentFrontmatterSchema,
      rawDocument,
      relativePath,
      "HB_EXPERIMENT_FRONTMATTER_INVALID",
      `Experiment frontmatter for "${relativePath}" is invalid.`,
    ),
  };
}

async function readJournalDayFrontmatterDocument(
  vaultRoot: string,
  relativePath: string,
): Promise<{
  rawDocument: string;
  document: {
    attributes: JournalDayFrontmatter;
    body: string;
  };
}> {
  const rawDocument = await readUtf8File(vaultRoot, relativePath);
  return {
    rawDocument,
    document: safeParseDocument(
      journalDayFrontmatterSchema,
      rawDocument,
      relativePath,
      "HB_JOURNAL_FRONTMATTER_INVALID",
      `Journal frontmatter for "${relativePath}" is invalid.`,
    ),
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

export async function promoteInboxJournal(
  input: PromoteInboxJournalInput,
): Promise<PromoteInboxJournalResult> {
  const ensured = await ensureJournalDayInternal({
    vaultRoot: input.vaultRoot,
    date: input.date,
  });
  const { rawDocument, document } = await readJournalDayFrontmatterDocument(
    input.vaultRoot,
    ensured.relativePath,
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
  const { rawDocument, document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
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
