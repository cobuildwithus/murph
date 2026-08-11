import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import {
  clearHostedAssistantRuntimeHotState,
  collectHostedWorkspaceSnapshotArchivePlan,
  pruneHostedCodexHomeToSessionReferencedRollouts,
  resolveAssistantStatePaths,
} from "../src/node/index.ts";

const execFileAsync = promisify(execFile);

test("hosted snapshots add no Codex memory entries when the workspace is absent", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-memory-absent-"));

  try {
    const durableRoot = path.join(workspaceRoot, "durable");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const vaultRoot = path.join(durableRoot, "vault");
    await mkdir(operatorHomeRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });

    const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
      durableRoot,
      operatorHomeRoot,
      vaultRoot,
    });

    assert.equal(
      archivePlan.entries.some((entry) =>
        entry.root === "operator-home"
        && entry.relativePath.startsWith(".codex-hosted/memories/")
      ),
      false,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted snapshots archive only Codex's exact memory read artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-memory-"));

  try {
    const durableRoot = path.join(workspaceRoot, "durable");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const vaultRoot = path.join(durableRoot, "vault");
    const codexHome = path.join(operatorHomeRoot, ".codex-hosted");
    const memoriesRoot = path.join(codexHome, "memories");
    await mkdir(vaultRoot, { recursive: true });

    const archivedMemoryFiles = [
      ["memories/memory_summary.md", "summary\n"],
      ["memories/MEMORY.md", "memory\n"],
      ["memories/raw_memories.md", "raw memory\n"],
    ] as const;
    const nonportableMemoryFiles = [
      ["memories/rollout_summaries/thread.md", "rollout summary\n"],
      ["memories/.git/HEAD", "ref: refs/heads/main\n"],
      ["memories/.git/index", "git index\n"],
      ["memories/.git/objects/ab/cdef", "git object\n"],
      ["memories/skills/demo/SKILL.md", "generated skill\n"],
      [
        "memories/extensions/ad_hoc/notes/2026-08-06T21-00-00-note.md",
        "operator memory note\n",
      ],
      [
        "memories/extensions/ad_hoc/phase2_workspace_diff.md",
        "nested memory resource\n",
      ],
      ["memories/.git/index.lock", "transient lock\n"],
      ["memories/phase2_workspace_diff.md", "transient diff\n"],
      ["memories/tmp/inflight.md", "temporary work\n"],
      ["memories/.tmp-draft", "temporary draft\n"],
      ["memories/cache.sqlite", "private cache\n"],
      ["memories/.env", "environment secret\n"],
      ["memories/.env.local", "local environment secret\n"],
      ["memories/skills/demo/.env.example", "example environment secret\n"],
      ["memories/extensions/ad_hoc/.envrc", "environment rc secret\n"],
      ["memories/extensions/ad_hoc/.env-prod", "production environment secret\n"],
      ["memories/extensions/ad_hoc/.env_backup", "environment backup secret\n"],
      ["memories/extensions/.env-secrets/value.txt", "nested environment secret\n"],
      ["memories/auth/provider.json", "provider credential\n"],
      ["memories/credentials.json", "credential\n"],
      ["memories/secrets/token.json", "secret token\n"],
      ["memories/skills/demo/private.key", "private key\n"],
      ["memories/extensions/demo/provider_cert.json", "provider certificate\n"],
      ["memories/.netrc", "network credential\n"],
    ] as const;
    const privateMemoryStateFiles = [
      ["memories_1.sqlite", "memory db\n"],
      ["memories_1.sqlite-wal", "memory wal\n"],
      ["state_5.sqlite", "state db\n"],
      ["state_5.sqlite-wal", "state wal\n"],
    ] as const;
    const excludedFiles = [
      ["auth.json", "secret\n"],
      ["config.toml", "config\n"],
      ["history.jsonl", "history\n"],
      ["logs_2.sqlite", "logs\n"],
      ["memories_1.sqlite-journal", "journal\n"],
      ["state_5.sqlite-shm", "shared memory\n"],
      ["state_0.sqlite", "invalid version\n"],
    ] as const;
    for (const [relativePath, contents] of [
      ...archivedMemoryFiles,
      ...nonportableMemoryFiles,
      ...privateMemoryStateFiles,
      ...excludedFiles,
    ]) {
      await mkdir(path.dirname(path.join(codexHome, relativePath)), { recursive: true });
      await writeFile(path.join(codexHome, relativePath), contents, "utf8");
    }

    const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
      durableRoot,
      operatorHomeRoot,
      vaultRoot,
    });
    const archivedOperatorFiles = archivePlan.entries
      .filter((entry) => entry.kind === "file" && entry.root === "operator-home")
      .map((entry) => entry.relativePath)
      .sort();
    assert.deepEqual(
      archivedOperatorFiles,
      archivedMemoryFiles
        .map(([relativePath]) => `.codex-hosted/${relativePath}`)
        .sort(),
    );

    await pruneHostedCodexHomeToSessionReferencedRollouts({
      assistantStateRoot: resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      nativeMemoryRetention: "read-artifacts",
      operatorHomeRoot,
    });

    for (const [relativePath, contents] of archivedMemoryFiles) {
      assert.equal(await readFile(path.join(codexHome, relativePath), "utf8"), contents);
    }
    for (const [relativePath] of [
      ...nonportableMemoryFiles,
      ...privateMemoryStateFiles,
      ...excludedFiles,
    ]) {
      await assert.rejects(readFile(path.join(codexHome, relativePath), "utf8"), {
        code: "ENOENT",
      });
    }
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("pre-consolidation raw memory survives without extension or Git state", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "hosted-codex-memory-pre-consolidation-"),
  );

  try {
    const durableRoot = path.join(workspaceRoot, "durable");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const vaultRoot = path.join(durableRoot, "vault");
    const memoriesRoot = path.join(operatorHomeRoot, ".codex-hosted", "memories");
    const rawMemoryFile = ["raw_memories.md", "raw memory before consolidation\n"] as const;
    const excludedFiles = [
      ["extensions/ad_hoc/instructions.md", "extension instructions\n"],
      [
        "extensions/ad_hoc/notes/2026-08-06T21-00-00-note.md",
        "operator note\n",
      ],
    ] as const;
    await mkdir(vaultRoot, { recursive: true });
    for (const [relativePath, contents] of [rawMemoryFile, ...excludedFiles]) {
      const filePath = path.join(memoriesRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }

    const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
      durableRoot,
      operatorHomeRoot,
      vaultRoot,
    });
    const archivedOperatorFiles = new Set(
      archivePlan.entries
        .filter((entry) => entry.kind === "file" && entry.root === "operator-home")
        .map((entry) => entry.relativePath),
    );
    assert.equal(
      archivedOperatorFiles.has(`.codex-hosted/memories/${rawMemoryFile[0]}`),
      true,
    );
    for (const [relativePath] of excludedFiles) {
      assert.equal(
        archivedOperatorFiles.has(`.codex-hosted/memories/${relativePath}`),
        false,
      );
    }

    await pruneHostedCodexHomeToSessionReferencedRollouts({
      assistantStateRoot: resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      nativeMemoryRetention: "read-artifacts",
      operatorHomeRoot,
    });
    assert.equal(
      await readFile(path.join(memoriesRoot, rawMemoryFile[0]), "utf8"),
      rawMemoryFile[1],
    );
    for (const [relativePath] of excludedFiles) {
      await assert.rejects(readFile(path.join(memoriesRoot, relativePath), "utf8"), {
        code: "ENOENT",
      });
    }
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("warm restore retains only bounded Codex memory read artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-memory-warm-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const codexHome = path.join(operatorHomeRoot, ".codex-hosted");
    const retainedFiles = [
      ["memories/MEMORY.md", "memory\n"],
      ["memories/memory_summary.md", "summary\n"],
      ["memories/raw_memories.md", "raw memory\n"],
    ] as const;
    const prunedFiles = [
      ["memories/.git/index.lock", "active lock\n"],
      ["memories_1.sqlite", "memory db\n"],
      ["memories_1.sqlite-wal", "memory wal\n"],
      ["memories_1.sqlite-shm", "memory shm\n"],
      ["state_5.sqlite-journal", "state journal\n"],
      ["memories/skills/demo/credentials.json", "credential\n"],
      ["auth.json", "secret\n"],
      ["config.toml", "config\n"],
      ["state_0.sqlite", "invalid version\n"],
    ] as const;
    await mkdir(vaultRoot, { recursive: true });
    for (const [relativePath, contents] of [...retainedFiles, ...prunedFiles]) {
      const filePath = path.join(codexHome, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }

    await pruneHostedCodexHomeToSessionReferencedRollouts({
      assistantStateRoot: resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      nativeMemoryRetention: "read-artifacts",
      operatorHomeRoot,
    });

    for (const [relativePath, contents] of retainedFiles) {
      assert.equal(await readFile(path.join(codexHome, relativePath), "utf8"), contents);
    }
    for (const [relativePath] of prunedFiles) {
      await assert.rejects(readFile(path.join(codexHome, relativePath), "utf8"), {
        code: "ENOENT",
      });
    }
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("legacy hot cleanup clears Codex home in one delete", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-memory-hot-clear-"));

  try {
    const durableRoot = path.join(workspaceRoot, "durable");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const vaultRoot = path.join(durableRoot, "vault");
    const memoryPath = path.join(
      operatorHomeRoot,
      ".codex-hosted",
      "memories",
      "nested",
      "MEMORY.md",
    );
    await mkdir(path.dirname(memoryPath), { recursive: true });
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(memoryPath, "memory\n", "utf8");

    await clearHostedAssistantRuntimeHotState({
      operatorHomeRoot,
      vaultRoot,
    });

    await assert.rejects(readFile(memoryPath, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test.each(["file-symlink", "directory-symlink", "hardlink"] as const)(
  "hosted snapshots reject %s entries inside Codex native memory",
  async (entryKind) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-memory-unsafe-"));

    try {
      const durableRoot = path.join(workspaceRoot, "durable");
      const operatorHomeRoot = path.join(durableRoot, "home");
      const vaultRoot = path.join(durableRoot, "vault");
      const memoriesRoot = path.join(operatorHomeRoot, ".codex-hosted", "memories");
      const memoryPath = path.join(memoriesRoot, "raw_memories.md");
      const sourcePath = path.join(operatorHomeRoot, "memory-source.md");
      await mkdir(memoriesRoot, { recursive: true });
      await mkdir(vaultRoot, { recursive: true });
      await writeFile(memoryPath, "memory\n", "utf8");

      if (entryKind === "file-symlink") {
        await writeFile(sourcePath, "memory\n", "utf8");
        await rm(memoryPath);
        await symlink(sourcePath, memoryPath);
      } else if (entryKind === "directory-symlink") {
        const externalDirectory = path.join(operatorHomeRoot, "external-memory-directory");
        await mkdir(externalDirectory, { recursive: true });
        await writeFile(path.join(externalDirectory, "raw_memories.md"), "external\n", "utf8");
        await rm(memoriesRoot, { force: true, recursive: true });
        await symlink(externalDirectory, memoriesRoot);
      } else {
        await link(memoryPath, path.join(memoriesRoot, "linked.md"));
      }

      await assert.rejects(
        collectHostedWorkspaceSnapshotArchivePlan({
          durableRoot,
          operatorHomeRoot,
          vaultRoot,
        }),
        new RegExp(entryKind === "hardlink" ? "hardlinks" : "symlinks", "u"),
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  },
);

test("hosted snapshots reject special files inside Codex native memory", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "hosted-codex-memory-special-file-"),
  );

  try {
    const durableRoot = path.join(workspaceRoot, "durable");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const vaultRoot = path.join(durableRoot, "vault");
    const memoriesRoot = path.join(operatorHomeRoot, ".codex-hosted", "memories");
    await mkdir(memoriesRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });
    await execFileAsync("mkfifo", [path.join(memoriesRoot, "raw_memories.md")]);

    await assert.rejects(
      collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot,
        operatorHomeRoot,
        vaultRoot,
      }),
      /unsupported special files/u,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted snapshots ignore a malformed Codex memory root", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "hosted-codex-memory-malformed-root-"),
  );

  try {
    const durableRoot = path.join(workspaceRoot, "durable");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const vaultRoot = path.join(durableRoot, "vault");
    const memoriesRoot = path.join(operatorHomeRoot, ".codex-hosted", "memories");
    await mkdir(path.dirname(memoriesRoot), { recursive: true });
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(memoriesRoot, "not a directory\n", "utf8");

    const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
      durableRoot,
      operatorHomeRoot,
      vaultRoot,
    });
    assert.equal(
      archivePlan.entries.some((entry) =>
        entry.root === "operator-home"
        && entry.relativePath.startsWith(".codex-hosted/memories/")
      ),
      false,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted memory planning preserves cancellation", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "hosted-codex-memory-cancel-"),
  );
  const abortController = new AbortController();
  const abortReason = new Error("foreground wake interrupted memory planning");

  try {
    const durableRoot = path.join(workspaceRoot, "durable");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const vaultRoot = path.join(durableRoot, "vault");
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "memories"), {
      recursive: true,
    });
    await mkdir(vaultRoot, { recursive: true });
    abortController.abort(abortReason);

    await assert.rejects(
      collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot,
        operatorHomeRoot,
        signal: abortController.signal,
        vaultRoot,
      }),
      (error: unknown) => error === abortReason,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
