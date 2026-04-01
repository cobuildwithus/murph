import type { CoreFrontmatter, VaultMetadata } from "@murphai/contracts";
import {
  coreFrontmatterSchema,
  vaultMetadataSchema,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "../constants.ts";
import { stringifyFrontmatterDocument } from "../frontmatter.ts";
import { loadVault } from "../vault.ts";

import {
  compactObject,
  normalizeOptionalText,
  readValidatedFrontmatterDocument,
  replaceMarkdownTitle,
  runLoadedCanonicalWrite,
  validateContract,
} from "./shared.ts";

export interface UpdateVaultSummaryInput {
  vaultRoot: string;
  title?: string;
  timezone?: string;
}

export interface UpdateVaultSummaryResult {
  metadataFile: string;
  corePath: string;
  title: string;
  timezone: string;
  updatedAt: string;
  updated: true;
}

function validateVaultMetadata(value: unknown): VaultMetadata {
  return validateContract(
    vaultMetadataSchema,
    value,
    "VAULT_METADATA_INVALID",
    "Vault metadata is invalid.",
  );
}

function validateCoreFrontmatter(
  value: unknown,
  relativePath = VAULT_LAYOUT.coreDocument,
): CoreFrontmatter {
  return validateContract(
    coreFrontmatterSchema,
    value,
    "CORE_FRONTMATTER_INVALID",
    `CORE frontmatter for "${relativePath}" is invalid.`,
    {
      relativePath,
    },
  );
}

export async function updateVaultSummary(
  input: UpdateVaultSummaryInput,
): Promise<UpdateVaultSummaryResult> {
  const { metadata } = await loadVault({ vaultRoot: input.vaultRoot });
  const { document: coreDocument } = await readValidatedFrontmatterDocument(
    input.vaultRoot,
    VAULT_LAYOUT.coreDocument,
    coreFrontmatterSchema,
    "CORE_FRONTMATTER_INVALID",
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

  return runLoadedCanonicalWrite<UpdateVaultSummaryResult>({
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
