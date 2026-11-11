import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

describe("hosted workspace snapshot enumeration races", () => {
  it("admits durable vault state while excluding credentials and process residue", async () => {
    const durableRoot = await mkdtemp(path.join(tmpdir(), "workspace-plan-policy-"));
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const included = [
      "journal/entry.md",
      ".runtime/operations/assistant/state/new-continuity.json",
      ".runtime/operations/assistant/diagnostics/snapshot.json",
      ".runtime/projections/query-entities.sqlite",
      ".runtime/projections/query-metrics.sqlite",
      ".runtime/projections/query-wearables.sqlite",
    ];
    const excluded = [
      ".env", "journal/.env.local", ".git/config", "exports/packs/private.zip",
      ".runtime/cache/secret.json", ".runtime/tmp/scratch.json",
      ".runtime/projections/query.sqlite", ".runtime/projections/query-entities.sqlite.tmp",
      ".runtime/operations/assistant/secrets/token.json",
      ".runtime/operations/assistant/outbox/.quarantine/rejected.json",
      ".runtime/operations/assistant/diagnostics/events.jsonl",
      ".runtime/operations/assistant/journals/runtime-events.jsonl.1",
      ".runtime/operations/assistant/state/worker.pid",
      ".runtime/operations/assistant/.runtime-write.lock/metadata.json",
      ".runtime/operations/assistant/state/.runtime-write.lock.pending.fixture/metadata.json",
      ".runtime/operations/assistant/status.json",
    ];
    try {
      for (const relativePath of [...included, ...excluded]) {
        await mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
        await writeFile(path.join(vaultRoot, relativePath), "synthetic fixture");
      }
      await mkdir(operatorHomeRoot);
      await writeFile(path.join(operatorHomeRoot, "config.json"), "synthetic operator config");
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import("../src/hosted-bundles.ts");
      const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot, vaultRoot, operatorHomeRoot });
      expect(plan.entries.filter(entry => entry.kind === "file").map(entry => entry.relativePath).sort())
        .toEqual([...included].sort());
    } finally {
      await rm(durableRoot, { recursive: true, force: true });
    }
  });

  it("keeps empty inbox roots and unrelated empty directories", async () => {
    const durableRoot = await mkdtemp(path.join(tmpdir(), "empty-inbox-roots-"));
    const vaultRoot = path.join(durableRoot, "vault");
    try {
      for (const relativePath of ["raw/inbox/empty/deep", "derived/inbox/empty/deep", "raw/captures/empty"]) {
        await mkdir(path.join(vaultRoot, relativePath), { recursive: true });
      }
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import("../src/hosted-bundles.ts");
      const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot, vaultRoot });
      expect(plan.entries.map(entry => entry.relativePath)).toEqual([
        "", "derived", "derived/inbox", "raw", "raw/captures", "raw/captures/empty", "raw/inbox",
      ]);
      expect(plan.fileCount).toBe(0);
    } finally {
      await rm(durableRoot, { recursive: true, force: true });
    }
  });

  it("includes retired repair progress without parsing it", async () => {
    const durableRoot = await mkdtemp(path.join(tmpdir(), "retired-progress-snapshot-"));
    const vaultRoot = path.join(durableRoot, "vault");
    const relativePath = ".runtime/operations/meal-name-repair/v1.json";
    try {
      await mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
      await writeFile(path.join(vaultRoot, relativePath), "opaque legacy progress");
      const { collectHostedWorkspaceSnapshotArchivePlan } = await import("../src/hosted-bundles.ts");
      const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot, vaultRoot });
      expect(plan.entries).toContainEqual(expect.objectContaining({ root: "vault", relativePath, kind: "file" }));
    } finally {
      await rm(durableRoot, { recursive: true, force: true });
    }
  });

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
