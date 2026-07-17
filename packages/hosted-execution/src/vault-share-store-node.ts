import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseSharedVaultShareProjectionStore,
  SHARED_VAULT_SHARE_AUTHORITY_UNAVAILABLE_MARKER_RELATIVE_PATH,
  SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH,
  type SharedVaultShareProjectionsFile,
} from "./vault-share.ts";

export type SharedVaultShareProjectionStoreReadResult =
  | { status: "loaded"; store: SharedVaultShareProjectionsFile }
  | { status: "empty" }
  | { status: "corrupt" }
  | { status: "read_failed" };

export async function readSharedVaultShareProjectionStore(
  vaultRoot: string,
): Promise<SharedVaultShareProjectionStoreReadResult> {
  return await readSharedVaultShareProjectionStoreFile(
    resolveSharedVaultShareProjectionStorePath(vaultRoot),
  );
}

export async function readSharedVaultShareProjectionStoreFile(
  storePath: string,
): Promise<SharedVaultShareProjectionStoreReadResult> {
  let raw: string;
  try {
    raw = await readFile(storePath, "utf8");
  } catch (error) {
    return hasNodeErrorCode(error, "ENOENT")
      ? { status: "empty" }
      : { status: "read_failed" };
  }

  try {
    const store = parseSharedVaultShareProjectionStore(JSON.parse(raw));
    return store ? { status: "loaded", store } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}

export function resolveSharedVaultShareProjectionStorePath(
  vaultRoot: string,
): string {
  return join(vaultRoot, SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH);
}

export function resolveSharedVaultShareAuthorityUnavailableMarkerPath(
  vaultRoot: string,
): string {
  return join(vaultRoot, SHARED_VAULT_SHARE_AUTHORITY_UNAVAILABLE_MARKER_RELATIVE_PATH);
}

export async function hasSharedVaultShareAuthorityUnavailableMarker(
  vaultRoot: string,
): Promise<boolean> {
  try {
    await readFile(
      resolveSharedVaultShareAuthorityUnavailableMarkerPath(vaultRoot),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code
  );
}
