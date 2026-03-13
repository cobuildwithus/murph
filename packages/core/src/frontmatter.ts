import {
  parseFrontmatterDocument as parseSharedFrontmatterDocument,
  type FrontmatterParseProblem,
} from "@healthybob/contracts";

import { VaultError } from "./errors.js";

import { isPlainRecord } from "./types.js";

import type {
  FrontmatterDocument,
  FrontmatterObject,
  FrontmatterValue,
} from "./types.js";

function isFrontmatterObject(value: unknown): value is FrontmatterObject {
  return isPlainRecord(value);
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

    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
      return value;
    }

    return JSON.stringify(value);
  }

  throw new VaultError(
    "VAULT_UNSUPPORTED_FRONTMATTER",
    "Frontmatter supports only scalars, arrays, and plain objects.",
    {
      valueType: typeof value,
    },
  );
}

function serializeNode(value: FrontmatterValue, indent = 0): string {
  const padding = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${padding}[]`;
    }

    return value
      .map((item) => {
        if (Array.isArray(item) || isFrontmatterObject(item)) {
          const nested = serializeNode(item, indent + 2);
          return `${padding}-\n${nested}`;
        }

        return `${padding}- ${stringifyScalar(item)}`;
      })
      .join("\n");
  }

  if (isFrontmatterObject(value)) {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      return `${padding}{}`;
    }

    return entries
      .map(([key, entryValue]) => {
        if (!/^[A-Za-z0-9_-]+$/.test(key)) {
          throw new VaultError("VAULT_INVALID_FRONTMATTER_KEY", `Invalid frontmatter key "${key}".`, {
            key,
          });
        }

        if (Array.isArray(entryValue) || isFrontmatterObject(entryValue)) {
          const nested = serializeNode(entryValue, indent + 2);

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

function toVaultError(problem: FrontmatterParseProblem): VaultError {
  return new VaultError("VAULT_INVALID_FRONTMATTER", problem.message, {
    ...(problem.line === undefined ? {} : { line: problem.line }),
    ...(problem.index === undefined ? {} : { index: problem.index }),
  });
}

export function stringifyFrontmatterDocument(
  { attributes = {}, body = "" }: Partial<FrontmatterDocument> = {},
): string {
  if (!isFrontmatterObject(attributes)) {
    throw new VaultError("VAULT_INVALID_FRONTMATTER", "Frontmatter attributes must be a plain object.");
  }

  const header = Object.keys(attributes).length === 0 ? "" : serializeNode(attributes);
  const normalizedBody = String(body ?? "");
  return header ? `---\n${header}\n---\n${normalizedBody}` : `---\n---\n${normalizedBody}`;
}

export function parseFrontmatterDocument(documentText: string): FrontmatterDocument {
  const parsed = parseSharedFrontmatterDocument(documentText, {
    mode: "strict",
    bodyNormalization: "preserve",
    createError: toVaultError,
  });

  return {
    attributes: parsed.attributes,
    body: parsed.body,
  };
}
