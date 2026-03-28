import type { FileChangeOperation, JsonObject } from "@murph/contracts";

export type DateInput = string | number | Date;

export type UnknownRecord = JsonObject;

export type FrontmatterScalar = string | number | boolean | null;

export interface FrontmatterObject {
  [key: string]: FrontmatterValue;
}

export type FrontmatterValue = FrontmatterScalar | FrontmatterObject | FrontmatterValue[];

export interface FrontmatterDocument {
  attributes: FrontmatterObject;
  body: string;
}

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
