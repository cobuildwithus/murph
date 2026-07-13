import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEmptySharedVaultShareProjectionStore } from "../src/vault-share.ts";
import {
  readSharedVaultShareProjectionStore,
  resolveSharedVaultShareProjectionStorePath,
} from "../src/vault-share-store-node.ts";

describe("readSharedVaultShareProjectionStore", () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-store-"));
  });

  afterEach(async () => {
    await rm(vaultRoot, { force: true, recursive: true });
  });

  it("distinguishes missing, loaded, corrupt, and unreadable stores", async () => {
    const path = resolveSharedVaultShareProjectionStorePath(vaultRoot);

    await expect(readSharedVaultShareProjectionStore(vaultRoot))
      .resolves.toEqual({ status: "empty" });

    await mkdir(dirname(path), { recursive: true });
    const store = createEmptySharedVaultShareProjectionStore();
    await writeFile(path, JSON.stringify(store), "utf8");
    await expect(readSharedVaultShareProjectionStore(vaultRoot))
      .resolves.toEqual({ status: "loaded", store });

    await writeFile(path, "{ invalid json", "utf8");
    await expect(readSharedVaultShareProjectionStore(vaultRoot))
      .resolves.toEqual({ status: "corrupt" });

    await rm(path, { force: true });
    await mkdir(path);
    await expect(readSharedVaultShareProjectionStore(vaultRoot))
      .resolves.toEqual({ status: "read_failed" });
  });
});
