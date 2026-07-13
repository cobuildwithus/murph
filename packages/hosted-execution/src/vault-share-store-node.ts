import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseSharedVaultShareProjectionStore,
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
  let raw: string;
  try {
    raw = await readFile(resolveSharedVaultShareProjectionStorePath(vaultRoot), "utf8");
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

function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code
  );
}
