import { VaultError } from "../errors.ts";
import {
  deleteCanonicalMarkdownDocument,
  loadMarkdownDocuments,
  resolveSlugMarkdownDocumentTarget,
  writeCanonicalFrontmatterDocument,
  writeCanonicalMarkdownDocument,
  type CanonicalMarkdownDocumentAuditInput,
  type SlugMarkdownDocumentTarget,
} from "../markdown-documents.ts";
import { resolveRecordByIdOrSlug } from "./id-or-slug.ts";

import type { FrontmatterObject } from "../types.ts";

interface MarkdownRegistryLoadOptions<TRecord> {
  vaultRoot: string;
  directory: string;
  recordFromParts: (attributes: FrontmatterObject, relativePath: string, markdown: string) => TRecord;
  isExpectedRecord: (record: TRecord) => boolean;
  invalidCode: string;
  invalidMessage: string;
}

interface RegistrySelectionOptions<TRecord> {
  records: readonly TRecord[];
  recordId?: string;
  slug?: string;
  getRecordId: (record: TRecord) => string;
  getRecordSlug: (record: TRecord) => string;
  readMissingCode: string;
  readMissingMessage: string;
}

interface ExistingRegistrySelectionOptions<TRecord>
  extends Omit<RegistrySelectionOptions<TRecord>, "readMissingCode" | "readMissingMessage"> {
  conflictCode: string;
  conflictMessage: string;
}

type MarkdownRegistryUpsertAuditInput = CanonicalMarkdownDocumentAuditInput;

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

interface DeleteMarkdownRegistryDocumentInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  relativePath: string;
}

interface ResolveMarkdownRegistryUpsertTargetOptions<TRecord> {
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

export type MarkdownRegistryUpsertTarget = SlugMarkdownDocumentTarget;

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
  return loadMarkdownDocuments({
    vaultRoot,
    directory,
    recordFromParts,
    isExpectedRecord,
    invalidCode,
    invalidMessage,
  });
}

export function selectExistingRegistryRecord<TRecord>({
  records,
  recordId,
  slug,
  getRecordId,
  getRecordSlug,
  conflictCode,
  conflictMessage,
}: ExistingRegistrySelectionOptions<TRecord>): TRecord | null {
  const selection = resolveRecordByIdOrSlug({
    records,
    recordId,
    slug,
    getRecordId,
    getRecordSlug,
    detectConflict: true,
  });

  if (selection.hasConflict) {
    throw new VaultError(conflictCode, conflictMessage);
  }

  return selection.match;
}

export function readRegistryRecord<TRecord>({
  records,
  recordId,
  slug,
  getRecordId,
  getRecordSlug,
  readMissingCode,
  readMissingMessage,
}: RegistrySelectionOptions<TRecord>): TRecord {
  const match = resolveRecordByIdOrSlug({
    records,
    recordId,
    slug,
    getRecordId,
    getRecordSlug,
  }).match;

  if (!match) {
    throw new VaultError(readMissingCode, readMissingMessage);
  }

  return match;
}

/**
 * Canonical slug/id-to-path resolution for markdown-backed registries.
 *
 * Keeping rename and record-id ownership here prevents bank domains from
 * drifting on create-vs-update decisions or old-path cleanup.
 */
export function resolveMarkdownRegistryUpsertTarget<TRecord>({
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
}: ResolveMarkdownRegistryUpsertTargetOptions<TRecord>): MarkdownRegistryUpsertTarget {
  return resolveSlugMarkdownDocumentTarget({
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
  });
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
  const result = await writeCanonicalMarkdownDocument({
    vaultRoot,
    operationType,
    summary,
    target: {
      relativePath,
      previousRelativePath,
      created,
    },
    markdown,
    audit,
  });

  if (!result.auditPath) {
    throw new Error("Markdown registry upsert audit path was not produced.");
  }

  return result.auditPath;
}

export async function deleteMarkdownRegistryDocument({
  vaultRoot,
  operationType,
  summary,
  relativePath,
}: DeleteMarkdownRegistryDocumentInput): Promise<{
  relativePath: string;
}> {
  return deleteCanonicalMarkdownDocument({
    vaultRoot,
    operationType,
    summary,
    relativePath,
  });
}

/**
 * Canonical markdown-registry write path.
 *
 * This is the shared seam that turns validated frontmatter + markdown body into
 * one canonical write transaction with the corresponding audit entry.
 */
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
  const result = await writeCanonicalFrontmatterDocument({
    vaultRoot,
    target,
    attributes,
    body,
    recordFromParts,
    operationType,
    summary,
    audit,
  });

  if (!result.auditPath) {
    throw new Error("Markdown registry write audit path was not produced.");
  }

  return {
    auditPath: result.auditPath,
    record: result.record,
  };
}
