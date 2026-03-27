import {
  deleteMarkdownRegistryDocument,
  loadMarkdownRegistryDocuments,
  type MarkdownRegistryUpsertTarget,
  readRegistryRecord,
  resolveMarkdownRegistryUpsertTarget,
  selectExistingRegistryRecord,
  writeMarkdownRegistryRecord,
} from "./markdown.ts";

import type { FrontmatterObject } from "../types.ts";

type MarkdownRegistryAuditAction = Parameters<typeof writeMarkdownRegistryRecord>[0]["audit"]["action"];

interface RegistryApiRecord {
  slug: string;
  relativePath: string;
}

interface CreateMarkdownRegistryApiOptions<TRecord extends RegistryApiRecord> {
  directory: string;
  recordFromParts: (attributes: FrontmatterObject, relativePath: string, markdown: string) => TRecord;
  isExpectedRecord: (record: TRecord) => boolean;
  invalidCode: string;
  invalidMessage: string;
  sortRecords: (records: TRecord[]) => void;
  getRecordId: (record: TRecord) => string;
  conflictCode: string;
  conflictMessage: string;
  readMissingCode: string;
  readMissingMessage: string;
  createRecordId: () => string;
  operationType: string;
  summary: (recordId: string) => string;
  deleteOperationType?: string;
  deleteSummary?: (recordId: string) => string;
  audit: {
    action: MarkdownRegistryAuditAction;
    commandName: string;
    summary: (created: boolean, recordId: string) => string;
  };
}

interface UpsertMarkdownRegistryApiRecordInput<TRecord extends RegistryApiRecord> {
  vaultRoot: string;
  existingRecord: TRecord | null;
  recordId?: string;
  requestedSlug?: string;
  defaultSlug: string;
  allowSlugUpdate?: boolean;
  buildDocument: (target: MarkdownRegistryUpsertTarget) => {
    attributes: FrontmatterObject;
    body: string;
  };
}

interface ReadMarkdownRegistryApiRecordInput {
  vaultRoot: string;
  recordId?: string;
  slug?: string;
}

interface DeleteMarkdownRegistryApiRecordInput {
  vaultRoot: string;
  recordId?: string;
  slug?: string;
}

interface ResolveExistingMarkdownRegistryApiRecordInput {
  vaultRoot: string;
  recordId?: string;
  slug?: string;
}

export function createMarkdownRegistryApi<TRecord extends RegistryApiRecord>({
  directory,
  recordFromParts,
  isExpectedRecord,
  invalidCode,
  invalidMessage,
  sortRecords,
  getRecordId,
  conflictCode,
  conflictMessage,
  readMissingCode,
  readMissingMessage,
  createRecordId,
  operationType,
  summary,
  deleteOperationType,
  deleteSummary,
  audit,
}: CreateMarkdownRegistryApiOptions<TRecord>) {
  async function loadRecords(vaultRoot: string): Promise<TRecord[]> {
    const records = await loadMarkdownRegistryDocuments({
      vaultRoot,
      directory,
      recordFromParts,
      isExpectedRecord,
      invalidCode,
      invalidMessage,
    });

    sortRecords(records);
    return records;
  }

  function selectExistingRecord(
    records: TRecord[],
    recordId: string | undefined,
    slug: string | undefined,
  ): TRecord | null {
    return selectExistingRegistryRecord({
      records,
      recordId,
      slug,
      getRecordId,
      conflictCode,
      conflictMessage,
    });
  }

  async function resolveExistingRecord({
    vaultRoot,
    recordId,
    slug,
  }: ResolveExistingMarkdownRegistryApiRecordInput): Promise<TRecord | null> {
    return selectExistingRecord(await loadRecords(vaultRoot), recordId, slug);
  }

  async function upsertRecord({
    vaultRoot,
    existingRecord,
    recordId,
    requestedSlug,
    defaultSlug,
    allowSlugUpdate,
    buildDocument,
  }: UpsertMarkdownRegistryApiRecordInput<TRecord>): Promise<{
    created: boolean;
    auditPath: string;
    record: TRecord;
  }> {
    const target = resolveMarkdownRegistryUpsertTarget({
      existingRecord,
      recordId,
      requestedSlug,
      defaultSlug,
      allowSlugUpdate,
      directory,
      getRecordId,
      createRecordId,
    });
    const { attributes, body } = buildDocument(target);
    const { auditPath, record } = await writeMarkdownRegistryRecord({
      vaultRoot,
      target,
      attributes,
      body,
      recordFromParts,
      operationType,
      summary: summary(target.recordId),
      audit: {
        action: audit.action,
        commandName: audit.commandName,
        summary: audit.summary(target.created, target.recordId),
        targetIds: [target.recordId],
      },
    });

    return {
      created: target.created,
      auditPath,
      record,
    };
  }

  async function readRecord({
    vaultRoot,
    recordId,
    slug,
  }: ReadMarkdownRegistryApiRecordInput): Promise<TRecord> {
    const records = await loadRecords(vaultRoot);
    return readRegistryRecord({
      records,
      recordId,
      slug,
      getRecordId,
      readMissingCode,
      readMissingMessage,
    });
  }

  async function deleteRecord({
    vaultRoot,
    recordId,
    slug,
  }: DeleteMarkdownRegistryApiRecordInput): Promise<{
    record: TRecord;
  }> {
    const record = await readRecord({
      vaultRoot,
      recordId,
      slug,
    });

    if (!deleteOperationType || !deleteSummary) {
      throw new Error("Markdown registry delete is not configured for this record type.");
    }

    await deleteMarkdownRegistryDocument({
      vaultRoot,
      operationType: deleteOperationType,
      summary: deleteSummary(getRecordId(record)),
      relativePath: record.relativePath,
    });

    return {
      record,
    };
  }

  return {
    loadRecords,
    selectExistingRecord,
    resolveExistingRecord,
    listRecords: loadRecords,
    upsertRecord,
    readRecord,
    deleteRecord,
  };
}
