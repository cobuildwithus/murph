import path from "node:path";

export const QUERY_SOURCE_INVALID_CODE = "QUERY_SOURCE_INVALID";

export type QuerySourceIssue =
  | "document_path_mismatch"
  | "frontmatter_contract_invalid"
  | "frontmatter_invalid"
  | "malformed_json"
  | "metadata_invalid"
  | "missing_field";

export interface QueryVaultSourceErrorDetails {
  field?: string;
  issue: QuerySourceIssue;
  lineNumber?: number;
  querySource: true;
  relativePath: string;
}

export class QueryVaultSourceError extends Error {
  readonly code = QUERY_SOURCE_INVALID_CODE;
  readonly details: QueryVaultSourceErrorDetails;

  constructor(input: {
    field?: string;
    issue: QuerySourceIssue;
    lineNumber?: number;
    relativePath: string;
  }) {
    const relativePath = normalizeQuerySourcePath(input.relativePath);
    const lineNumber = normalizeLineNumber(input.lineNumber);
    super(
      lineNumber === undefined
        ? `Canonical vault source ${relativePath} is invalid.`
        : `Canonical vault source ${relativePath}:${lineNumber} is invalid.`,
    );
    this.name = "VaultError";
    this.details = {
      querySource: true,
      relativePath,
      issue: input.issue,
      ...(lineNumber === undefined ? {} : { lineNumber }),
      ...(isSafeField(input.field) ? { field: input.field } : {}),
    };
  }
}

function normalizeQuerySourcePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\/+/, "");
  if (
    normalized.length === 0
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || /[\u0000-\u001F\u007F]/u.test(normalized)
  ) {
    return "<vault-source>";
  }

  return Array.from(normalized).slice(0, 160).join("");
}

function normalizeLineNumber(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : undefined;
}

function isSafeField(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u.test(value);
}
