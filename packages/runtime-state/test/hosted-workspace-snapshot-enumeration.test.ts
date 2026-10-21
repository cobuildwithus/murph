import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

describe("hosted workspace snapshot enumeration races", () => {
  it.each([
    ["vault", "file"],
    ["vault", "directory"],
    ["vault", "root"],
    ["operator-home", "file"],
    ["operator-home", "directory"],
    ["operator-home", "root"],
  ] as const)("rejects a vanished included %s %s instead of returning a partial plan", async (root, kind) => {
    const durableRoot = await mkdtemp(path.join(tmpdir(), "workspace-plan-race-"));
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const rootPath = root === "vault" ? vaultRoot : operatorHomeRoot;
    const directoryPath = root === "vault"
      ? path.join(vaultRoot, "journal")
      : path.join(operatorHomeRoot, ".codex-hosted", "memories");
    const filePath = path.join(directoryPath, root === "vault" ? "entry.md" : "MEMORY.md");
    const targetPath = kind === "file" ? filePath : kind === "directory" ? directoryPath : rootPath;
    let removed = false;
    try {
      await mkdir(vaultRoot, { recursive: true });
      await mkdir(directoryPath, { recursive: true });
      await writeFile(path.join(vaultRoot, "vault.json"), "{}");
      await writeFile(filePath, "Synthetic durable contents\n");
      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
        return {
          ...actual,
          readdir: async (...args: Parameters<typeof actual.readdir>) => {
            if (kind !== "file" && String(args[0]) === targetPath && !removed) {
              removed = true;
              await actual.rm(targetPath, { recursive: true });
            }
            const children = await actual.readdir(...args);
            if (kind === "file" && String(args[0]) === directoryPath && !removed) {
              removed = true;
              await actual.rm(filePath);
            }
            return children;
          },
        };
      });
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import(
        "../src/hosted-bundles.ts"
      );
      await expect(collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot, operatorHomeRoot, vaultRoot,
      })).rejects.toMatchObject({ code: "ENOENT" });
      expect(removed).toBe(true);
    } finally {
      await rm(durableRoot, { recursive: true, force: true });
    }
  });

  it("allows roots that do not exist at the start of inventory", async () => {
    const durableRoot = await mkdtemp(path.join(tmpdir(), "workspace-plan-optional-"));
    try {
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import(
        "../src/hosted-bundles.ts"
      );
      const plan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot,
        operatorHomeRoot: path.join(durableRoot, "home"),
        vaultRoot: path.join(durableRoot, "vault"),
      });
      expect(plan.entries).toEqual([]);
      expect(plan.fileCount).toBe(0);
    } finally {
      await rm(durableRoot, { recursive: true, force: true });
    }
  });

  it("preserves foreground interruption when readdir rejects concurrently", async () => {
    const durableRoot = await mkdtemp(path.join(tmpdir(), "workspace-plan-abort-"));
    const vaultRoot = path.join(durableRoot, "vault");
    const controller = new AbortController();
    const reason = new Error("foreground wake interrupted inventory");
    try {
      await mkdir(vaultRoot);
      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
        return {
          ...actual,
          readdir: async () => {
            controller.abort(reason);
            throw Object.assign(new Error("directory disappeared"), { code: "ENOENT" });
          },
        };
      });
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import(
        "../src/hosted-bundles.ts"
      );
      await expect(collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot, vaultRoot, signal: controller.signal,
      })).rejects.toBe(reason);
    } finally {
      await rm(durableRoot, { recursive: true, force: true });
    }
  });
});
