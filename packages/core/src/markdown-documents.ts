import type { AuditAction } from "@murphai/contracts";

import { commitAuditedCanonicalWrite } from "./audited-write.ts";
import { VaultError } from "./errors.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
import { readUtf8File, walkVaultFiles } from "./fs.ts";
import { type WriteBatch } from "./operations/write-batch.ts";

import type { DateInput, FileChange, FrontmatterObject } from "./types.ts";

interface MarkdownDirectoryLoadOptions<TRecord> {
  vaultRoot: string;
  directory: string;
  recordFromParts: (attributes: FrontmatterObject, relativePath: string, markdown: string) => TRecord;
  isExpectedRecord: (record: TRecord) => boolean;
  invalidCode: string;
  invalidMessage: string;
}

interface ResolveSlugMarkdownDocumentTargetOptions<TRecord> {
  existingRecord: TRecord | null;
  recordId?: string;
  requestedSlug?: string;
  defaultSlug: string;
  allowSlugUpdate?: boolean;
  directory: string;
  getRecordId: (record: TRecord) => string;
  getRecordSlug: (record: TRecord) => string;
  getRecordRelativePath: (record: TRecord) => string;
  createRecordId: () => string;
}

interface ResolveSingletonMarkdownDocumentTargetOptions {
  relativePath: string;
  created?: boolean;
}

interface ResolveDatedMarkdownDocumentTargetOptions {
  directory: string;
  dayKey: string;
  created?: boolean;
  yearSharded?: boolean;
  previousRelativePath?: string;
}

export interface CanonicalMarkdownDocumentTarget {
  relativePath: string;
  previousRelativePath?: string;
  created: boolean;
}

export interface SlugMarkdownDocumentTarget extends CanonicalMarkdownDocumentTarget {
  recordId: string;
  slug: string;
}

export interface CanonicalMarkdownDocumentAuditInput {
  action: AuditAction;
  commandName: string;
  summary: string;
  targetIds?: string[];
  occurredAt?: DateInput;
}

export interface StageMarkdownDocumentWriteOptions {
  overwrite?: boolean;
  allowExistingMatch?: boolean;
  allowAppendOnlyJsonl?: boolean;
  allowRaw?: boolean;
}

interface WriteCanonicalMarkdownDocumentOptions extends StageMarkdownDocumentWriteOptions {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
  target: CanonicalMarkdownDocumentTarget;
  markdown: string;
  audit: CanonicalMarkdownDocumentAuditInput;
}

interface WriteCanonicalFrontmatterDocumentOptions<TRecord>
  extends Omit<WriteCanonicalMarkdownDocumentOptions, "markdown"> {
  attributes: FrontmatterObject;
  body: string;
  recordFromParts: (attributes: FrontmatterObject, relativePath: string, markdown: string) => TRecord;
}

export interface StagedMarkdownDocumentWrite {
  relativePath: string;
  previousRelativePath?: string;
  created: boolean;
  files: string[];
  changes: FileChange[];
}

function buildMarkdownDocumentFiles(target: CanonicalMarkdownDocumentTarget): string[] {
  const files = [target.relativePath];

  if (
    target.previousRelativePath &&
    target.previousRelativePath !== target.relativePath
  ) {
    files.push(target.previousRelativePath);
  }

  return files;
}

function assertMarkdownDocumentPath(relativePath: string, fieldName: string): void {
  if (!relativePath.endsWith(".md")) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      `${fieldName} must point to a markdown document path.`,
    );
  }
}

function buildMarkdownDocumentChanges(target: CanonicalMarkdownDocumentTarget): FileChange[] {
  return [
    {
      path: target.relativePath,
      op: target.created ? "create" : "update",
    },
  ];
}

export async function loadMarkdownDocuments<TRecord>({
  vaultRoot,
  directory,
  recordFromParts,
  isExpectedRecord,
  invalidCode,
  invalidMessage,
}: MarkdownDirectoryLoadOptions<TRecord>): Promise<TRecord[]> {
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

export function resolveSingletonMarkdownDocumentTarget({
  relativePath,
  created = false,
}: ResolveSingletonMarkdownDocumentTargetOptions): CanonicalMarkdownDocumentTarget {
  return {
    relativePath,
    created,
  };
}

export function resolveDatedMarkdownDocumentTarget({
  directory,
  dayKey,
  created = false,
  yearSharded = true,
  previousRelativePath,
}: ResolveDatedMarkdownDocumentTargetOptions): CanonicalMarkdownDocumentTarget {
  const relativePath = yearSharded
    ? `${directory}/${dayKey.slice(0, 4)}/${dayKey}.md`
    : `${directory}/${dayKey}.md`;

  return {
    relativePath,
    previousRelativePath,
    created,
  };
}

export function resolveSlugMarkdownDocumentTarget<TRecord>({
  existingRecord,
  recordId,
  requestedSlug,
  defaultSlug,
  allowSlugUpdate,
  directory,
  getRecordId,
  getRecordSlug,
  getRecordRelativePath,
  createRecordId,
}: ResolveSlugMarkdownDocumentTargetOptions<TRecord>): SlugMarkdownDocumentTarget {
  const slug = allowSlugUpdate
    ? requestedSlug ?? (existingRecord ? getRecordSlug(existingRecord) : undefined) ?? defaultSlug
    : (existingRecord ? getRecordSlug(existingRecord) : undefined) ?? requestedSlug ?? defaultSlug;
  const relativePath = `${directory}/${slug}.md`;

  return {
    recordId: existingRecord ? getRecordId(existingRecord) : (recordId ?? createRecordId()),
    slug,
    relativePath,
    previousRelativePath:
      allowSlugUpdate && existingRecord && getRecordRelativePath(existingRecord) !== relativePath
        ? getRecordRelativePath(existingRecord)
        : undefined,
    created: !existingRecord,
  };
}

export async function stageMarkdownDocumentWrite(
  batch: WriteBatch,
  target: CanonicalMarkdownDocumentTarget,
  markdown: string,
  options: StageMarkdownDocumentWriteOptions = {},
): Promise<StagedMarkdownDocumentWrite> {
  assertMarkdownDocumentPath(target.relativePath, "target.relativePath");
  if (target.previousRelativePath) {
    assertMarkdownDocumentPath(target.previousRelativePath, "target.previousRelativePath");
  }

  await batch.stageTextWrite(target.relativePath, markdown, {
    overwrite: options.overwrite,
    allowExistingMatch: options.allowExistingMatch,
    allowAppendOnlyJsonl: options.allowAppendOnlyJsonl,
    allowRaw: options.allowRaw,
  });

  if (
    target.previousRelativePath &&
    target.previousRelativePath !== target.relativePath
  ) {
    await batch.stageDelete(target.previousRelativePath);
  }

  return {
    relativePath: target.relativePath,
    previousRelativePath:
      target.previousRelativePath && target.previousRelativePath !== target.relativePath
        ? target.previousRelativePath
        : undefined,
    created: target.created,
    files: buildMarkdownDocumentFiles(target),
    changes: buildMarkdownDocumentChanges(target),
  };
}

export async function writeCanonicalMarkdownDocument({
  vaultRoot,
  operationType,
  summary,
  occurredAt,
  target,
  markdown,
  audit,
  ...options
}: WriteCanonicalMarkdownDocumentOptions): Promise<{
  auditPath: string;
  markdown: string;
  write: StagedMarkdownDocumentWrite;
}> {
  const result = await commitAuditedCanonicalWrite({
    vaultRoot,
    operationType,
    summary,
    occurredAt,
    audit,
    mutate: async ({ batch }) => {
      const write = await stageMarkdownDocumentWrite(batch, target, markdown, options);

      return {
        result: {
          markdown,
          write,
        },
        files: write.files,
        changes: write.changes,
        targetIds: audit.targetIds ?? [],
      };
    },
  });

  return {
    ...result.result,
    auditPath: result.auditPath,
  };
}

export async function writeCanonicalFrontmatterDocument<TRecord>({
  attributes,
  body,
  recordFromParts,
  ...input
}: WriteCanonicalFrontmatterDocumentOptions<TRecord>): Promise<{
  auditPath: string;
  markdown: string;
  record: TRecord;
  write: StagedMarkdownDocumentWrite;
}> {
  const markdown = stringifyFrontmatterDocument({ attributes, body });
  const result = await writeCanonicalMarkdownDocument({
    ...input,
    markdown,
  });

  return {
    ...result,
    record: recordFromParts(attributes, input.target.relativePath, markdown),
  };
}

export async function deleteCanonicalMarkdownDocument({
  vaultRoot,
  operationType,
  summary,
  relativePath,
  occurredAt,
  audit,
}: {
  vaultRoot: string;
  operationType: string;
  summary: string;
  relativePath: string;
  occurredAt?: DateInput;
  audit: CanonicalMarkdownDocumentAuditInput;
}): Promise<{
  relativePath: string;
}> {
  assertMarkdownDocumentPath(relativePath, "relativePath");

  const result = await commitAuditedCanonicalWrite({
    vaultRoot,
    operationType,
    summary,
    occurredAt,
    audit,
    mutate: async ({ batch }) => {
      await batch.stageDelete(relativePath);
      return {
        result: {
          relativePath,
        },
        files: [relativePath],
        changes: [
          {
            path: relativePath,
            op: "delete",
          },
        ],
      };
    },
  });

  return result.result;
}
