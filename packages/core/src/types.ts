import type {
  FileChangeOperation,
  FrontmatterObject,
  FrontmatterScalar,
  FrontmatterValue,
  JsonObject,
  ParsedFrontmatterDocument,
} from "@murph/contracts";

export type DateInput = string | number | Date;

export type UnknownRecord = JsonObject;

export type { FrontmatterObject, FrontmatterScalar, FrontmatterValue };

export type FrontmatterDocument = Pick<ParsedFrontmatterDocument, "attributes" | "body">;

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
  severity: string;
}

export interface FileChange {
  path: string;
  op?: FileChangeOperation;
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export function isPlainRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
