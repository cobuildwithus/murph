import type { ProviderFrontmatter } from "@murph/contracts";
import { CONTRACT_SCHEMA_VERSION, providerFrontmatterSchema } from "@murph/contracts";

import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import { VaultError } from "../errors.ts";
import { parseFrontmatterDocument } from "../frontmatter.ts";
import { generateRecordId } from "../ids.ts";
import {
  compactObject,
  ensureMarkdownHeading,
  normalizeOptionalText,
  uniqueTrimmedStringList,
  validateContract,
} from "../domains/shared.ts";
import {
  deleteMarkdownRegistryDocument,
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
  resolveMarkdownRegistryUpsertTarget,
  writeMarkdownRegistryRecord,
} from "../registry/markdown.ts";
import { loadVault } from "../vault.ts";

import type { FrontmatterObject } from "../types.ts";

export interface ProviderRecord extends ProviderFrontmatter {
  relativePath: string;
  markdown: string;
  body: string;
}

export interface ReadProviderInput {
  vaultRoot: string;
  providerId?: string;
  slug?: string;
}

export interface UpsertProviderInput {
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

export interface UpsertProviderResult {
  providerId: string;
  relativePath: string;
  created: boolean;
}

export interface DeleteProviderInput {
  vaultRoot: string;
  providerId?: string;
  slug?: string;
}

export interface DeleteProviderResult {
  providerId: string;
  relativePath: string;
  deleted: true;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function normalizeProviderSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (!SLUG_PATTERN.test(normalized)) {
    throw new VaultError(
      "PROVIDER_SLUG_INVALID",
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

function validateProviderFrontmatter(
  value: unknown,
  relativePath: string,
): ProviderFrontmatter {
  return validateContract(
    providerFrontmatterSchema,
    value,
    "PROVIDER_FRONTMATTER_INVALID",
    "Provider frontmatter is invalid.",
    { relativePath },
  );
}

function parseProviderRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): ProviderRecord {
  const frontmatter = validateProviderFrontmatter(attributes, relativePath);
  const document = parseFrontmatterDocument(markdown);
  return {
    ...frontmatter,
    relativePath,
    markdown,
    body: document.body,
  };
}

async function loadProviderRecords(vaultRoot: string): Promise<ProviderRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: VAULT_LAYOUT.providersDirectory,
    recordFromParts: parseProviderRecord,
    isExpectedRecord: (record) =>
      record.docType === "provider" &&
      record.schemaVersion === CONTRACT_SCHEMA_VERSION.providerFrontmatter,
    invalidCode: "PROVIDER_FRONTMATTER_INVALID",
    invalidMessage: "Provider frontmatter is invalid.",
  });

  return records.sort(
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.slug.localeCompare(right.slug) ||
      left.providerId.localeCompare(right.providerId),
  );
}

function selectExistingProviderRecord(
  records: ProviderRecord[],
  providerId: string | undefined,
  slug: string,
): ProviderRecord | null {
  const existingById = providerId
    ? records.find((record) => record.providerId === providerId)
    : undefined;
  const slugOwner = records.find((record) => record.slug === slug);

  if (slugOwner && providerId && slugOwner.providerId !== providerId) {
    throw new VaultError(
      "PROVIDER_CONFLICT",
      `Provider slug "${slug}" is already owned by "${slugOwner.providerId}".`,
      {
        conflictingProviderId: slugOwner.providerId,
        providerId,
        slug,
      },
    );
  }

  return existingById ?? slugOwner ?? null;
}

export async function upsertProvider(
  input: UpsertProviderInput,
): Promise<UpsertProviderResult> {
  await loadVault({ vaultRoot: input.vaultRoot });
  const existingRecords = await loadProviderRecords(input.vaultRoot);
  const normalizedTitle = input.title.trim();
  const desiredSlug = normalizeProviderSlug(input.slug ?? normalizedTitle);
  const requestedId = normalizeOptionalText(input.providerId) ?? undefined;
  const existingRecord = selectExistingProviderRecord(existingRecords, requestedId, desiredSlug);
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: requestedId,
    requestedSlug: desiredSlug,
    defaultSlug: desiredSlug,
    allowSlugUpdate: true,
    directory: VAULT_LAYOUT.providersDirectory,
    getRecordId: (record) => record.providerId,
    createRecordId: () => generateRecordId(ID_PREFIXES.provider),
  });
  const nextAttributes = validateProviderFrontmatter(
    compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.providerFrontmatter,
      docType: "provider",
      providerId: target.recordId,
      slug: target.slug,
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
    target.relativePath,
  );
  const body = normalizeProviderBody(
    input.body,
    existingRecord?.body ?? null,
    nextAttributes.title,
    nextAttributes.note,
  );
  const { record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes: nextAttributes as FrontmatterObject,
    body,
    recordFromParts: parseProviderRecord,
    operationType: "provider_upsert",
    summary: `Upsert provider ${target.recordId}`,
    audit: {
      action: "provider_upsert",
      commandName: "core.upsertProvider",
      summary: `Upserted provider ${target.recordId}.`,
      targetIds: [target.recordId],
    },
  });

  return {
    providerId: record.providerId,
    relativePath: record.relativePath,
    created: target.created,
  };
}

export async function listProviders(vaultRoot: string): Promise<ProviderRecord[]> {
  return loadProviderRecords(vaultRoot);
}

export async function readProvider({
  vaultRoot,
  providerId,
  slug,
}: ReadProviderInput): Promise<ProviderRecord> {
  return readRegistryRecord({
    records: await loadProviderRecords(vaultRoot),
    recordId: providerId,
    slug,
    getRecordId: (record) => record.providerId,
    readMissingCode: "PROVIDER_MISSING",
    readMissingMessage: "Provider was not found.",
  });
}

export async function deleteProvider({
  vaultRoot,
  providerId,
  slug,
}: DeleteProviderInput): Promise<DeleteProviderResult> {
  const provider = await readProvider({
    vaultRoot,
    providerId,
    slug,
  });

  await deleteMarkdownRegistryDocument({
    vaultRoot,
    operationType: "provider_delete",
    summary: `Delete provider ${provider.providerId}`,
    relativePath: provider.relativePath,
  });

  return {
    providerId: provider.providerId,
    relativePath: provider.relativePath,
    deleted: true as const,
  };
}
