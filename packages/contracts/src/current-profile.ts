import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
} from "./constants.ts";
import {
  profileCurrentFrontmatterSchema,
  type ProfileCurrentFrontmatter,
} from "./zod.ts";
import { safeParseContract } from "./validate.ts";

import type { FrontmatterObject, FrontmatterValue } from "./frontmatter.ts";

export interface CurrentProfileDocumentInput {
  snapshotId: string;
  updatedAt: string;
  source: unknown;
  sourceAssessmentIds?: readonly string[] | null;
  sourceEventIds?: readonly string[] | null;
  profile: Record<string, unknown>;
}

export interface CurrentProfileDocument {
  attributes: ProfileCurrentFrontmatter;
  body: string;
  markdown: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function firstObject(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const candidate = value[key];
  return isPlainObject(candidate) ? candidate : null;
}

function firstStringArray(
  value: Record<string, unknown>,
  key: string,
): string[] {
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((entry): entry is string => typeof entry === "string");
}

function stringifyScalar(value: FrontmatterValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    if (!value) {
      return "\"\"";
    }

    if (/^[A-Za-z0-9_./:-]+$/u.test(value)) {
      return value;
    }

    return JSON.stringify(value);
  }

  throw new Error("Frontmatter supports only scalars, arrays, and plain objects.");
}

type FrontmatterContainerNode = FrontmatterObject | FrontmatterValue[];

function serializeFrontmatterNode(value: FrontmatterContainerNode, indent = 0): string {
  const padding = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${padding}[]`;
    }

    return value
      .map((item) => {
        /* c8 ignore next 3 -- profile-current frontmatter arrays are flat scalar arrays */
        if (Array.isArray(item) || isPlainObject(item)) {
          const nested = serializeFrontmatterNode(item, indent + 2);
          return `${padding}-\n${nested}`;
        }

        return `${padding}- ${stringifyScalar(item)}`;
      })
      .join("\n");
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      return `${padding}{}`;
    }

    return entries
      .map(([key, entryValue]) => {
        /* c8 ignore next 3 -- keys come from the schema-owned frontmatter surface */
        if (!/^[A-Za-z0-9_-]+$/u.test(key)) {
          throw new Error(`Invalid frontmatter key "${key}".`);
        }

        if (Array.isArray(entryValue) || isPlainObject(entryValue)) {
          const nested = serializeFrontmatterNode(entryValue, indent + 2);

          /* c8 ignore next 3 -- nested arrays are not part of the profile-current frontmatter contract */
          if (nested.trim() === "[]") {
            return `${padding}${key}: []`;
          }

          if (nested.trim() === "{}") {
            return `${padding}${key}: {}`;
          }

          return `${padding}${key}:\n${nested}`;
        }

        return `${padding}${key}: ${stringifyScalar(entryValue)}`;
      })
      .join("\n");
  }

  return `${padding}${stringifyScalar(value)}`;
}

function stringifyFrontmatterDocument(input: {
  attributes: FrontmatterObject;
  body: string;
}): string {
  const header =
    Object.keys(input.attributes).length === 0
      ? ""
      : serializeFrontmatterNode(input.attributes);

  return header
    ? `---\n${header}\n---\n${input.body}`
    : `---\n---\n${input.body}`;
}

function renderProfileValue(value: unknown, depth = 0): string[] {
  const indent = "  ".repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indent}[]`];
    }

    return value.flatMap((entry) => {
      if (isPlainObject(entry) || Array.isArray(entry)) {
        return [`${indent}-`, ...renderProfileValue(entry, depth + 1)];
      }

      return [`${indent}- ${String(entry)}`];
    });
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    if (entries.length === 0) {
      return [`${indent}{}`];
    }

    return entries.flatMap(([key, entry]) => {
      if (isPlainObject(entry) || Array.isArray(entry)) {
        return [`${indent}- ${key}:`, ...renderProfileValue(entry, depth + 1)];
      }

      return [`${indent}- ${key}: ${String(entry)}`];
    });
  }

  return [`${indent}${String(value)}`];
}

export function buildCurrentProfileDocument(
  input: CurrentProfileDocumentInput,
): CurrentProfileDocument {
  const topGoalIds = firstStringArray(
    firstObject(input.profile, "goals") ?? {},
    "topGoalIds",
  );
  const unitPreferences = firstObject(input.profile, "unitPreferences") ?? undefined;
  const rawAttributes = Object.fromEntries(
    Object.entries({
      schemaVersion: CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter,
      docType: FRONTMATTER_DOC_TYPES.profileCurrent,
      snapshotId: input.snapshotId,
      updatedAt: input.updatedAt,
      sourceAssessmentIds: input.sourceAssessmentIds?.length
        ? [...input.sourceAssessmentIds]
        : undefined,
      sourceEventIds: input.sourceEventIds?.length ? [...input.sourceEventIds] : undefined,
      topGoalIds: topGoalIds.length > 0 ? topGoalIds : undefined,
      unitPreferences,
    }).filter(([, value]) => value !== undefined),
  ) as FrontmatterObject;
  const attributesResult = safeParseContract(
    profileCurrentFrontmatterSchema,
    rawAttributes,
  );

  if (!attributesResult.success) {
    throw new Error(attributesResult.errors.join("; "));
  }

  const attributes = Object.fromEntries(
    Object.entries(attributesResult.data).filter(([, value]) => value !== undefined),
  ) as ProfileCurrentFrontmatter;
  const body = [
    "# Current Profile",
    "",
    `Snapshot ID: \`${input.snapshotId}\``,
    `Recorded At: ${input.updatedAt}`,
    `Source: ${String(input.source)}`,
    "",
    "## Structured Profile",
    "",
    ...renderProfileValue(input.profile),
    "",
    "## JSON",
    "",
    "```json",
    JSON.stringify(input.profile, null, 2),
    "```",
    "",
  ].join("\n");

  return {
    attributes,
    body,
    markdown: stringifyFrontmatterDocument({
      attributes: attributes as FrontmatterObject,
      body,
    }),
  };
}
