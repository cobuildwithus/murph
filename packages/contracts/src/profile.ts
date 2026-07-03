import { z } from "zod";

import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
} from "./constants.ts";
import { parseFrontmatterDocument } from "./frontmatter.ts";
import { withContractMetadata } from "./schema-metadata.ts";

export const profileDocumentRelativePath = "bank/profile.md";
export const profileDocumentDocType = FRONTMATTER_DOC_TYPES.profile;
export const profileDocumentSchemaVersion = CONTRACT_SCHEMA_VERSION.profileFrontmatter;

export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 120;

// Mirrors the vault-share profile-name delivery rule: a name the canonical document
// accepts must never be rejected later by the delivery parser. Expressed as a regex (not
// a refine) so the published JSON schema carries the same non-blank/no-control-character
// constraint as the Zod contract: first and last characters are non-space non-control,
// interior characters are anything but controls.
const PROFILE_DISPLAY_NAME_PATTERN =
  /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f])?$/u;

const profileDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROFILE_DISPLAY_NAME_MAX_LENGTH)
  .regex(PROFILE_DISPLAY_NAME_PATTERN, {
    message: "displayName must not be blank or contain control characters",
  });

export const profileDocumentFrontmatterSchema = withContractMetadata(
  z
    .object({
      docType: z.literal(profileDocumentDocType),
      schemaVersion: z.literal(profileDocumentSchemaVersion),
      displayName: profileDisplayNameSchema.nullable().default(null),
      updatedAt: z.string().min(1),
    })
    .strict(),
  "@murphai/contracts/frontmatter-profile.schema.json",
  "Murph Profile Frontmatter",
);

export const profileDocumentSchema = z
  .object({
    frontmatter: profileDocumentFrontmatterSchema,
  })
  .strict();

export const profileDocumentSnapshotSchema = profileDocumentSchema.extend({
  exists: z.boolean(),
  markdown: z.string(),
  sourcePath: z.string().min(1),
});

export type ProfileDocumentFrontmatter = z.infer<typeof profileDocumentFrontmatterSchema>;
export type ProfileDocument = z.infer<typeof profileDocumentSchema>;
export type ProfileDocumentSnapshot = z.infer<typeof profileDocumentSnapshotSchema>;

export interface ParseProfileDocumentInput {
  text: string;
}

export interface SetProfileDisplayNameInput {
  displayName: string;
  now?: Date;
}

const PROFILE_DOCUMENT_BODY = [
  "# Profile",
  "",
  "Canonical typed profile facts. Edit through `vault-cli profile`; freeform",
  "notes belong in memory instead.",
  "",
].join("\n");

export function createDefaultProfileFrontmatter(now = new Date()): ProfileDocumentFrontmatter {
  return profileDocumentFrontmatterSchema.parse({
    docType: profileDocumentDocType,
    schemaVersion: profileDocumentSchemaVersion,
    displayName: null,
    updatedAt: now.toISOString(),
  });
}

export function createEmptyProfileDocument(now = new Date()): ProfileDocument {
  return {
    frontmatter: createDefaultProfileFrontmatter(now),
  };
}

export function parseProfileDocument(input: ParseProfileDocumentInput): ProfileDocument {
  const parsed = parseFrontmatterDocument(input.text);
  return {
    frontmatter: profileDocumentFrontmatterSchema.parse(parsed.attributes),
  };
}

export function renderProfileDocument(document: ProfileDocument): string {
  const frontmatter = profileDocumentSchema.parse(document).frontmatter;
  return [
    "---",
    `docType: ${frontmatter.docType}`,
    `schemaVersion: ${frontmatter.schemaVersion}`,
    `displayName: ${renderProfileFrontmatterValue(frontmatter.displayName)}`,
    `updatedAt: ${renderProfileFrontmatterValue(frontmatter.updatedAt)}`,
    "---",
    PROFILE_DOCUMENT_BODY,
  ].join("\n");
}

export function setProfileDisplayName(
  document: ProfileDocument,
  input: SetProfileDisplayNameInput,
): ProfileDocument {
  const displayName = profileDisplayNameSchema.parse(input.displayName);
  return {
    frontmatter: profileDocumentFrontmatterSchema.parse({
      ...document.frontmatter,
      displayName,
      updatedAt: (input.now ?? new Date()).toISOString(),
    }),
  };
}

function renderProfileFrontmatterValue(value: string | null): string {
  if (value === null) {
    return "null";
  }
  if (/^[A-Za-z0-9_./:-]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
