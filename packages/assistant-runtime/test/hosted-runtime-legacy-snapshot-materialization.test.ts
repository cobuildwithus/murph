import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readHostedWorkspaceSkippedInlineFiles,
  sha256HostedBundleHex,
  writeHostedWorkspaceSkippedInlineFiles,
  type HostedWorkspaceSkippedInlineFile,
} from "@murphai/runtime-state/node";
import { afterEach, describe, expect, it } from "vitest";

import {
  materializeLegacyWorkspaceRefsForV2Snapshot,
  type LegacyWorkspaceRefsForV2SnapshotMaterializationPlan,
} from "../src/hosted-runtime/legacy-snapshot-materialization.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map(async (target) => {
    await rm(target, { force: true, recursive: true });
  }));
});

describe("legacy workspace v2 snapshot materialization", () => {
  it("unwinds staged artifacts without partially mutating live roots when interrupted", async () => {
    const roots = await createWorkspaceRoots();
    const first = createSkippedInlineFile("raw/legacy/first.txt", "first legacy bytes\n");
    const second = createSkippedInlineFile("raw/legacy/second.txt", "second legacy bytes\n");
    const plan = createPlan([first.file, second.file]);
    await writeHostedWorkspaceSkippedInlineFiles({
      files: plan.skippedInlineFiles,
      vaultRoot: roots.vaultRoot,
    });
    const controller = new AbortController();
    const interruption = new Error("Synthetic foreground checkpoint interruption.");
    const artifactStore = {
      get: async (sha256: string) => {
        if (sha256 === second.file.sha256) {
          controller.abort(interruption);
          return second.bytes;
        }
        return sha256 === first.file.sha256 ? first.bytes : null;
      },
    };

    const operation = materializeLegacyWorkspaceRefsForV2Snapshot({
      artifactStore,
      operatorHomeRoot: roots.operatorHomeRoot,
      plan,
      scratchRoot: roots.scratchRoot,
      signal: controller.signal,
      vaultRoot: roots.vaultRoot,
    });

    await expect(operation).rejects.toBe(interruption);
    await expectMissing(path.join(roots.vaultRoot, first.file.path));
    await expectMissing(path.join(roots.vaultRoot, second.file.path));
    const remainingManifest = await readHostedWorkspaceSkippedInlineFiles({
      vaultRoot: roots.vaultRoot,
    });
    expect(remainingManifest).toHaveLength(plan.skippedInlineFiles.length);
    expect(remainingManifest).toEqual(expect.arrayContaining([...plan.skippedInlineFiles]));
    expect(await readdir(roots.scratchRoot)).toEqual([]);
  });

  it("rolls back only files installed by the failed commit and keeps the manifest", async () => {
    const roots = await createWorkspaceRoots();
    const first = createSkippedInlineFile("raw/legacy/first.txt", "first legacy bytes\n");
    const second = createSkippedInlineFile("raw/blocked/second.txt", "second legacy bytes\n");
    const plan = createPlan([first.file, second.file]);
    await writeHostedWorkspaceSkippedInlineFiles({
      files: plan.skippedInlineFiles,
      vaultRoot: roots.vaultRoot,
    });
    const bytesByHash = new Map([
      [first.file.sha256, first.bytes],
      [second.file.sha256, second.bytes],
    ]);
    const blockingPath = path.join(roots.vaultRoot, "raw", "blocked");
    await mkdir(path.dirname(blockingPath), { recursive: true });
    await writeFile(blockingPath, "foreground-owned path\n", "utf8");

    await expect(materializeLegacyWorkspaceRefsForV2Snapshot({
      artifactStore: {
        get: async (sha256: string) => bytesByHash.get(sha256) ?? null,
      },
      operatorHomeRoot: roots.operatorHomeRoot,
      plan,
      scratchRoot: roots.scratchRoot,
      vaultRoot: roots.vaultRoot,
    })).rejects.toBeTruthy();

    await expectMissing(path.join(roots.vaultRoot, first.file.path));
    expect(await readFile(blockingPath, "utf8")).toBe("foreground-owned path\n");
    const remainingManifest = await readHostedWorkspaceSkippedInlineFiles({
      vaultRoot: roots.vaultRoot,
    });
    expect(remainingManifest).toHaveLength(plan.skippedInlineFiles.length);
    expect(remainingManifest).toEqual(expect.arrayContaining([...plan.skippedInlineFiles]));
    expect(await readdir(roots.scratchRoot)).toEqual([]);
  });
});

function createPlan(
  files: readonly HostedWorkspaceSkippedInlineFile[],
): LegacyWorkspaceRefsForV2SnapshotMaterializationPlan {
  return {
    currentSnapshotRefPresent: true,
    legacyBundleRefPresent: true,
    preservedInlineFileCount: 0,
    preservedState: null,
    skippedInlineFiles: files,
    skippedInlineFileCount: files.length,
  };
}

function createSkippedInlineFile(relativePath: string, contents: string): {
  bytes: Uint8Array;
  file: HostedWorkspaceSkippedInlineFile;
} {
  const bytes = Buffer.from(contents, "utf8");
  return {
    bytes,
    file: {
      path: relativePath,
      root: "vault",
      sha256: sha256HostedBundleHex(bytes),
      size: bytes.byteLength,
    },
  };
}

async function createWorkspaceRoots(): Promise<{
  operatorHomeRoot: string;
  scratchRoot: string;
  vaultRoot: string;
}> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-legacy-materialization-"));
  cleanupPaths.push(workspaceRoot);
  const operatorHomeRoot = path.join(workspaceRoot, "durable", "home");
  const scratchRoot = path.join(workspaceRoot, "scratch");
  const vaultRoot = path.join(workspaceRoot, "durable", "vault");
  await Promise.all([
    mkdir(operatorHomeRoot, { recursive: true }),
    mkdir(scratchRoot, { recursive: true }),
    mkdir(vaultRoot, { recursive: true }),
  ]);
  return {
    operatorHomeRoot,
    scratchRoot,
    vaultRoot,
  };
}

async function expectMissing(absolutePath: string): Promise<void> {
  await expect(access(absolutePath)).rejects.toMatchObject({
    code: "ENOENT",
  });
}
