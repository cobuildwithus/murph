import { FRONTMATTER_SCHEMA_VERSIONS } from "./constants.ts";
import { stringifyFrontmatterDocument } from "./frontmatter.ts";

export interface BuildVaultCoreDocumentInput {
  vaultId: string;
  title: string;
  timezone: string;
  updatedAt: string;
}

export function buildVaultCoreDocument({
  vaultId,
  title,
  timezone,
  updatedAt,
}: BuildVaultCoreDocumentInput): string {
  return stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.core,
      docType: "core",
      vaultId,
      title,
      timezone,
      updatedAt,
    },
    body: `# ${title}\n\n## Notes\n\n`,
  });
}
