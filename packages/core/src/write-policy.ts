import path from "node:path";
import { promises as fs } from "node:fs";

import { VaultError } from "./errors.js";
import {
  assertPathWithinVaultOnDisk,
  isAppendOnlyRelativePath,
  isRawRelativePath,
  resolveVaultPath,
} from "./path-safety.js";
import { isErrnoException } from "./types.js";

export type ResolvedVaultPath = ReturnType<typeof resolveVaultPath>;
export type WriteTargetPolicyKind = "text" | "raw" | "jsonl_append" | "delete";

interface WriteTargetPolicyMessages {
  appendOnlyDisallowed?: string;
  rawDisallowed?: string;
  rawRequired?: string;
}

export interface WriteTargetPolicy {
  kind: WriteTargetPolicyKind;
  allowAppendOnlyJsonl?: boolean;
  allowRaw?: boolean;
  messages?: WriteTargetPolicyMessages;
}

interface ReuseExistingTargetOptions {
  allowExistingMatch?: boolean;
  errorCode: string;
  errorMessage: string;
  matchesExistingContent: () => Promise<boolean>;
  relativePath: string;
}

interface ApplyImmutableWriteTargetOptions {
  allowExistingMatch?: boolean;
  createEffect?: "copy" | "create";
  createTarget: () => Promise<void>;
  existsErrorCode?: string;
  existsErrorMessage: string;
  matchesExistingContent: () => Promise<boolean>;
  target: ResolvedVaultPath;
}

interface ApplyTextWriteTargetOptions {
  allowExistingMatch?: boolean;
  backupExisting?: () => Promise<void>;
  createTarget: () => Promise<void>;
  matchesExistingContent: () => Promise<boolean>;
  overwrite: boolean;
  replaceTarget: () => Promise<void>;
  target: ResolvedVaultPath;
}

interface ApplyJsonlAppendTargetOptions {
  appendPayload: (payload: string) => Promise<void>;
  readPayload: () => Promise<string>;
  target: ResolvedVaultPath;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export function assertWriteTargetPolicy(relativePath: string, policy: WriteTargetPolicy): void {
  if (policy.kind === "raw") {
    if (!isRawRelativePath(relativePath)) {
      throw new VaultError(
        "VAULT_RAW_PATH_REQUIRED",
        policy.messages?.rawRequired ?? "Raw writes must target the raw/ tree.",
        { relativePath },
      );
    }

    return;
  }

  if (policy.kind === "jsonl_append") {
    if (isRawRelativePath(relativePath)) {
      throw new VaultError(
        "VAULT_RAW_IMMUTABLE",
        policy.messages?.rawDisallowed ?? "Raw files are immutable once written.",
        { relativePath },
      );
    }

    if (!relativePath.endsWith(".jsonl") || !isAppendOnlyRelativePath(relativePath)) {
      throw new VaultError(
        "VAULT_APPEND_ONLY_PATH",
        policy.messages?.appendOnlyDisallowed ??
          "Append-only writes are restricted to JSONL ledger and audit shards.",
        { relativePath },
      );
    }

    return;
  }

  if (
    isAppendOnlyRelativePath(relativePath) &&
    relativePath.endsWith(".jsonl") &&
    !policy.allowAppendOnlyJsonl
  ) {
    throw new VaultError(
      "VAULT_APPEND_ONLY_PATH",
      policy.messages?.appendOnlyDisallowed ?? "Use appendJsonlRecord for ledger and audit shards.",
      { relativePath },
    );
  }

  if (isRawRelativePath(relativePath) && !policy.allowRaw) {
    throw new VaultError(
      "VAULT_RAW_IMMUTABLE",
      policy.messages?.rawDisallowed ?? "Use copyRawArtifact for raw writes.",
      { relativePath },
    );
  }
}

export async function prepareVerifiedWriteTarget(
  vaultRoot: string,
  relativePath: string,
  policy?: WriteTargetPolicy,
): Promise<ResolvedVaultPath> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  if (policy) {
    assertWriteTargetPolicy(resolved.relativePath, policy);
  }

  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
  return resolved;
}

export async function fileContentsEqual(leftAbsolutePath: string, rightAbsolutePath: string): Promise<boolean> {
  const [left, right] = await Promise.all([fs.readFile(leftAbsolutePath), fs.readFile(rightAbsolutePath)]);
  return left.equals(right);
}

export async function reuseExistingTargetIfContentMatches({
  allowExistingMatch = false,
  errorCode,
  errorMessage,
  matchesExistingContent,
  relativePath,
}: ReuseExistingTargetOptions): Promise<boolean> {
  if (allowExistingMatch && (await matchesExistingContent())) {
    return true;
  }

  throw new VaultError(errorCode, errorMessage, {
    relativePath,
  });
}

export async function applyImmutableWriteTarget({
  allowExistingMatch = false,
  createEffect = "create",
  createTarget,
  existsErrorCode = "VAULT_RAW_IMMUTABLE",
  existsErrorMessage,
  matchesExistingContent,
  target,
}: ApplyImmutableWriteTargetOptions): Promise<{
  effect: "copy" | "create" | "reuse";
  existedBefore: boolean;
}> {
  try {
    await createTarget();
    return {
      effect: createEffect,
      existedBefore: false,
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      await reuseExistingTargetIfContentMatches({
        allowExistingMatch,
        errorCode: existsErrorCode,
        errorMessage: existsErrorMessage,
        matchesExistingContent,
        relativePath: target.relativePath,
      });
      return {
        effect: "reuse",
        existedBefore: true,
      };
    }

    throw error;
  }
}

export async function applyTextWriteTarget({
  allowExistingMatch = false,
  backupExisting,
  createTarget,
  matchesExistingContent,
  overwrite,
  replaceTarget,
  target,
}: ApplyTextWriteTargetOptions): Promise<{
  effect: "create" | "update" | "reuse";
  existedBefore: boolean;
}> {
  if (!overwrite) {
    const result = await applyImmutableWriteTarget({
      allowExistingMatch,
      createEffect: "create",
      createTarget,
      existsErrorCode: "VAULT_FILE_EXISTS",
      existsErrorMessage: `Refusing to overwrite existing file "${target.relativePath}".`,
      matchesExistingContent,
      target,
    });

    return {
      effect: result.effect === "reuse" ? "reuse" : "create",
      existedBefore: result.existedBefore,
    };
  }

  const existedBefore = await pathExists(target.absolutePath);

  if (existedBefore) {
    await backupExisting?.();
    await replaceTarget();
    return {
      effect: "update",
      existedBefore: true,
    };
  }

  try {
    await createTarget();
    return {
      effect: "create",
      existedBefore: false,
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      await backupExisting?.();
      await replaceTarget();
      return {
        effect: "update",
        existedBefore: true,
      };
    }

    throw error;
  }
}

export async function applyJsonlAppendTarget({
  appendPayload,
  readPayload,
  target,
}: ApplyJsonlAppendTargetOptions): Promise<{
  effect: "append";
  existedBefore: boolean;
  originalSize: number;
}> {
  const existedBefore = await pathExists(target.absolutePath);
  const originalSize = existedBefore ? (await fs.stat(target.absolutePath)).size : 0;
  const payload = await readPayload();
  await appendPayload(payload);

  return {
    effect: "append",
    existedBefore,
    originalSize,
  };
}
