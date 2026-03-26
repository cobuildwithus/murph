import { VaultError } from "../errors.js";
import { parseFrontmatterDocument } from "../frontmatter.js";
import { stringifyFrontmatterDocument } from "../frontmatter.js";
import { readUtf8File, walkVaultFiles } from "../fs.js";
import { emitAuditRecord } from "../audit.js";
import { runCanonicalWrite } from "../operations/index.js";
import { resolveRecordByIdOrSlug } from "./id-or-slug.js";

import type { FrontmatterObject, DateInput } from "../types.js";

interface MarkdownRegistryLoadOptions<TRecord> {
  vaultRoot: string;
  directory: string;
  recordFromParts: (attributes: FrontmatterObject, relativePath: string, markdown: string) => TRecord;
  isExpectedRecord: (record: TRecord) => boolean;
  invalidCode: string;
  invalidMessage: string;
}

interface RegistryRecord {
  slug: string;
}

interface ExistingMarkdownRegistryRecord extends RegistryRecord {
  relativePath: string;
}

interface RegistrySelectionOptions<TRecord extends RegistryRecord> {
  records: readonly TRecord[];
  recordId?: string;
  slug?: string;
  getRecordId: (record: TRecord) => string;
  readMissingCode: string;
  readMissingMessage: string;
}

interface ExistingRegistrySelectionOptions<TRecord extends RegistryRecord>
  extends Omit<RegistrySelectionOptions<TRecord>, "readMissingCode" | "readMissingMessage"> {
  conflictCode: string;
  conflictMessage: string;
}

interface MarkdownRegistryUpsertAuditInput {
  action: Parameters<typeof emitAuditRecord>[0]["action"];
  commandName: string;
  summary: string;
  targetIds?: string[];
  occurredAt?: DateInput;
}

interface UpsertMarkdownRegistryDocumentInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  relativePath: string;
  previousRelativePath?: string;
  markdown: string;
  created: boolean;
  audit: MarkdownRegistryUpsertAuditInput;
}

interface ResolveMarkdownRegistryUpsertTargetOptions<TRecord extends ExistingMarkdownRegistryRecord> {
  existingRecord: TRecord | null;
  recordId?: string;
  requestedSlug?: string;
  defaultSlug: string;
  allowSlugUpdate?: boolean;
  directory: string;
  getRecordId: (record: TRecord) => string;
  createRecordId: () => string;
}

export interface MarkdownRegistryUpsertTarget {
  recordId: string;
  slug: string;
  relativePath: string;
  previousRelativePath?: string;
  created: boolean;
}

interface WriteMarkdownRegistryRecordOptions<TRecord> {
  vaultRoot: string;
  target: MarkdownRegistryUpsertTarget;
  attributes: FrontmatterObject;
  body: string;
  recordFromParts: (attributes: FrontmatterObject, relativePath: string, markdown: string) => TRecord;
  operationType: string;
  summary: string;
  audit: MarkdownRegistryUpsertAuditInput;
}

export async function loadMarkdownRegistryDocuments<TRecord>({
  vaultRoot,
  directory,
  recordFromParts,
  isExpectedRecord,
  invalidCode,
  invalidMessage,
}: MarkdownRegistryLoadOptions<TRecord>): Promise<TRecord[]> {
  const relativePaths = await walkVaultFiles(vaultRoot, directory, { extension: ".md" });
  const records: TRecord[] = [];

  for (const relativePath of relativePaths) {
    const markdown = await readUtf8File(vaultRoot, relativePath);
    const document = parseFrontmatterDocument(markdown);
    const record = recordFromParts(document.attributes, relativePath, markdown);

    if (!isExpectedRecord(record)) {
      throw new VaultError(invalidCode, invalidMessage);
    }

    records.push(record);
  }

  return records;
}

export function selectExistingRegistryRecord<TRecord extends RegistryRecord>({
  records,
  recordId,
  slug,
  getRecordId,
  conflictCode,
  conflictMessage,
}: ExistingRegistrySelectionOptions<TRecord>): TRecord | null {
  const selection = resolveRecordByIdOrSlug({
    records,
    recordId,
    slug,
    getRecordId,
    detectConflict: true,
  });

  if (selection.hasConflict) {
    throw new VaultError(conflictCode, conflictMessage);
  }

  return selection.match;
}

export function readRegistryRecord<TRecord extends RegistryRecord>({
  records,
  recordId,
  slug,
  getRecordId,
  readMissingCode,
  readMissingMessage,
}: RegistrySelectionOptions<TRecord>): TRecord {
  const match = resolveRecordByIdOrSlug({
    records,
    recordId,
    slug,
    getRecordId,
  }).match;

  if (!match) {
    throw new VaultError(readMissingCode, readMissingMessage);
  }

  return match;
}

export function resolveMarkdownRegistryUpsertTarget<TRecord extends ExistingMarkdownRegistryRecord>({
  existingRecord,
  recordId,
  requestedSlug,
  defaultSlug,
  allowSlugUpdate,
  directory,
  getRecordId,
  createRecordId,
}: ResolveMarkdownRegistryUpsertTargetOptions<TRecord>): MarkdownRegistryUpsertTarget {
  const slug = allowSlugUpdate
    ? requestedSlug ?? existingRecord?.slug ?? defaultSlug
    : existingRecord?.slug ?? requestedSlug ?? defaultSlug;
  const relativePath = `${directory}/${slug}.md`;
  return {
    recordId: existingRecord ? getRecordId(existingRecord) : (recordId ?? createRecordId()),
    slug,
    relativePath,
    previousRelativePath:
      allowSlugUpdate && existingRecord && existingRecord.relativePath !== relativePath
        ? existingRecord.relativePath
        : undefined,
    created: !existingRecord,
  };
}

export async function upsertMarkdownRegistryDocument({
  vaultRoot,
  operationType,
  summary,
  relativePath,
  previousRelativePath,
  markdown,
  created,
  audit,
}: UpsertMarkdownRegistryDocumentInput): Promise<string> {
  const stagedAudit = await runCanonicalWrite({
    vaultRoot,
    operationType,
    summary,
    occurredAt: audit.occurredAt,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(relativePath, markdown);
      if (previousRelativePath && previousRelativePath !== relativePath) {
        await batch.stageDelete(previousRelativePath);
      }

      const files = previousRelativePath ? [relativePath, previousRelativePath] : [relativePath];
      const changes = [
        { path: relativePath, op: created ? "create" as const : "update" as const },
      ]

      return emitAuditRecord({
        vaultRoot,
        batch,
        action: audit.action,
        commandName: audit.commandName,
        summary: audit.summary,
        occurredAt: audit.occurredAt,
        files,
        targetIds: audit.targetIds ?? [],
        changes,
      });
    },
  });

  return stagedAudit.relativePath;
}

export async function writeMarkdownRegistryRecord<TRecord>({
  vaultRoot,
  target,
  attributes,
  body,
  recordFromParts,
  operationType,
  summary,
  audit,
}: WriteMarkdownRegistryRecordOptions<TRecord>): Promise<{
  auditPath: string;
  record: TRecord;
}> {
  const markdown = stringifyFrontmatterDocument({ attributes, body });
  const auditPath = await upsertMarkdownRegistryDocument({
    vaultRoot,
    operationType,
    summary,
    relativePath: target.relativePath,
    previousRelativePath: target.previousRelativePath,
    markdown,
    created: target.created,
    audit,
  });

  return {
    auditPath,
    record: recordFromParts(attributes, target.relativePath, markdown),
  };
}
