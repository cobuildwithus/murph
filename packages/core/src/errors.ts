import type { UnknownRecord } from "./types.ts";

export class VaultError extends Error {
  code: string;
  details: UnknownRecord;

  constructor(code: string, message: string, details: UnknownRecord = {}) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.details = details;
  }
}

export function isVaultError(error: unknown): error is VaultError {
  return error instanceof VaultError;
}
