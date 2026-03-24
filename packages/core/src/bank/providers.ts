import type { ProviderFrontmatter } from "@healthybob/contracts";
import {
  CONTRACT_SCHEMA_VERSION,
  providerFrontmatterSchema,
  safeParseContract,
} from "@healthybob/contracts";

import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.js";
import { VaultError } from "../errors.js";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "../frontmatter.js";
import { generateRecordId } from "../ids.js";
import { runCanonicalWrite } from "../operations/write-batch.js";
import {
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
} from "../registry/markdown.js";
import { loadVault } from "../vault.js";

import type { FrontmatterObject } from "../types.js";

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

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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

function ensureMarkdownHeading(body: string, title: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("# ")) {
    return body.replace(/^# .*(?:\r?\n)?/u, `# ${title}\n`);
  }

  return `# ${title}\n\n${body.trimStart()}`;
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

function providerRelativePath(slug: string): string {
  return `${VAULT_LAYOUT.providersDirectory}/${slug}.md`;
}

function validateProviderFrontmatter(
  value: unknown,
  relativePath: string,
): ProviderFrontmatter {
  const result = safeParseContract(providerFrontmatterSchema, value);
  if (!result.success) {
    throw new VaultError("HB_PROVIDER_FRONTMATTER_INVALID", "Provider frontmatter is invalid.", {
      relativePath,
      errors: result.errors,
    });
  }

  return result.data;
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
    invalidCode: "HB_PROVIDER_FRONTMATTER_INVALID",
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
      "HB_PROVIDER_CONFLICT",
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
  const providerId = requestedId ?? existingRecord?.providerId ?? generateRecordId(ID_PREFIXES.provider);
  const relativePath = providerRelativePath(desiredSlug);
  const previousPath = existingRecord?.relativePath ?? null;
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
    existingRecord?.body ?? null,
    nextAttributes.title,
    nextAttributes.note,
  );
  const markdown = stringifyFrontmatterDocument({
    attributes: nextAttributes as FrontmatterObject,
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
        created: existingRecord === null,
      };
    },
  });
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
    readMissingCode: "HB_PROVIDER_MISSING",
    readMissingMessage: "Provider was not found.",
  });
}
