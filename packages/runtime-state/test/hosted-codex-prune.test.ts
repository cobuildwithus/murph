import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { resolveAssistantStatePaths } from "../src/assistant-state.ts";
import { pruneHostedCodexHomeToSessionReferencedRollouts } from "../src/hosted-bundles.ts";

const DIRECT_THREAD = "00000000-0000-4000-8000-000000000001";
const GROUP_THREAD = "00000000-0000-4000-8000-000000000002";
const LEGACY_THREAD = "00000000-0000-4000-8000-000000000003";
const MEMORY_PATHS = ["memories/MEMORY.md", "memories/memory_summary.md", "memories/raw_memories.md"];

function rollout(threadId: string): string {
  return `sessions/2026/09/13/rollout-2026-09-13T01-02-03-${threadId}.jsonl`;
}

function session(threadId: string, rolloutRelativePath = rollout(threadId)) {
  return {
    codexTarget: { adapter: "codex-cli" },
    codexResume: { threadId, rolloutRelativePath, routeFingerprint: "synthetic-route" },
  };
}

async function write(root: string, relativePath: string, contents: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, { mode: 0o600 });
}

async function withWorkspace(run: (input: {
  assistantStateRoot: string;
  codexHome: string;
  operatorHomeRoot: string;
  root: string;
}) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "hosted-codex-prune-"));
  const assistantStateRoot = resolveAssistantStatePaths(path.join(root, "vault")).assistantStateRoot;
  const operatorHomeRoot = path.join(root, "home");
  const codexHome = path.join(operatorHomeRoot, ".codex-hosted");
  try {
    await fs.mkdir(codexHome, { recursive: true });
    await run({ assistantStateRoot, codexHome, operatorHomeRoot, root });
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

test("pruning retains complete direct, group, and legacy rollouts plus only native memory read artifacts", async () => {
  await withWorkspace(async (input) => {
    const direct = JSON.stringify(session(DIRECT_THREAD));
    const group = JSON.stringify({ ...session(GROUP_THREAD), conversationId: "synthetic-group" });
    const legacy = JSON.stringify({
      target: { adapter: "codex-cli" },
      resumeState: {
        providerSessionId: LEGACY_THREAD,
        codexRolloutRelativePath: rollout(LEGACY_THREAD),
        resumeRouteId: "synthetic-legacy-route",
      },
    });
    for (const [name, contents] of [["direct", direct], ["group", group], ["legacy", legacy]]) {
      await write(input.assistantStateRoot, `sessions/${name}.json`, contents);
    }
    // Duplicate references do not cause duplicate validation or remove continuity.
    await write(input.assistantStateRoot, "sessions/nested/duplicate.json", direct);
    const retained = [rollout(DIRECT_THREAD), rollout(GROUP_THREAD), rollout(LEGACY_THREAD), ...MEMORY_PATHS];
    for (const relativePath of retained) {
      await write(input.codexHome, relativePath, `${relativePath}\n${"complete history\n".repeat(100)}`);
    }
    const removed = [
      rollout("00000000-0000-4000-8000-000000000004"),
      "auth.json", "config.toml", "state_5.sqlite", "history.jsonl",
      "memories/.git/objects/ab/object", "memories/extensions/notes.md",
      "memories/rollout_summaries/thread.md", "sessions-shadow/private.jsonl",
      "cache/deep/private.json", "archived_sessions/private.jsonl",
    ];
    for (const relativePath of removed) await write(input.codexHome, relativePath, "discarded runtime residue\n");

    await pruneHostedCodexHomeToSessionReferencedRollouts({ ...input, nativeMemoryRetention: "read-artifacts" });

    // Repeated warm sanitation must preserve the same complete continuity.
    await pruneHostedCodexHomeToSessionReferencedRollouts({ ...input, nativeMemoryRetention: "read-artifacts" });

    for (const relativePath of retained) {
      assert.equal(await fs.readFile(path.join(input.codexHome, relativePath), "utf8"),
        `${relativePath}\n${"complete history\n".repeat(100)}`);
    }
    for (const relativePath of removed) {
      await assert.rejects(fs.lstat(path.join(input.codexHome, relativePath)), { code: "ENOENT" });
    }
    assert.equal(await fs.readFile(path.join(input.assistantStateRoot, "sessions/direct.json"), "utf8"), direct);
    assert.equal(await fs.readFile(path.join(input.assistantStateRoot, "sessions/group.json"), "utf8"), group);
    assert.equal(await fs.readFile(path.join(input.assistantStateRoot, "sessions/legacy.json"), "utf8"), legacy);
  });
});

test("pruning still rejects invalid, missing, archived, and non-Codex resume references", async () => {
  await withWorkspace(async (input) => {
    const validPath = rollout(DIRECT_THREAD);
    const records: unknown[] = [
      session(GROUP_THREAD, validPath),
      session(DIRECT_THREAD, validPath.replace("/09/13/", "/09/12/")),
      session(DIRECT_THREAD, "archived_sessions/rollout.jsonl"),
      session(DIRECT_THREAD, `../${validPath}`),
      session(DIRECT_THREAD, `/${validPath}`),
      session(DIRECT_THREAD, validPath.replaceAll("/", "\\")),
      session(GROUP_THREAD), // Missing rollout, even though the reference is valid.
      { ...session(DIRECT_THREAD), codexTarget: { adapter: "other-provider" } },
      { codexResume: { threadId: DIRECT_THREAD, rolloutRelativePath: validPath } },
    ];
    for (const [index, record] of records.entries()) {
      await write(input.assistantStateRoot, `sessions/${index}.json`, JSON.stringify(record));
    }
    await write(input.assistantStateRoot, "sessions/malformed.json", "not json");
    await write(input.codexHome, validPath, "unreferenced\n");
    await write(input.codexHome, "archived_sessions/rollout.jsonl", "archived\n");
    await write(input.codexHome, "memories/MEMORY.md", "memory is not retained by default\n");

    await pruneHostedCodexHomeToSessionReferencedRollouts(input);
    await assert.rejects(fs.lstat(input.codexHome), { code: "ENOENT" });
    await pruneHostedCodexHomeToSessionReferencedRollouts(input); // Absent home is a no-op.
  });
});

for (const linkKind of ["root", "ancestor", "leaf", "hardlink"] as const) {
  test(`pruning rejects ${linkKind} links without following them or changing external targets`, async () => {
    await withWorkspace(async (input) => {
      const relativePath = rollout(DIRECT_THREAD);
      const outside = path.join(input.root, "outside");
      const outsideFile = path.join(outside, relativePath);
      await write(outside, relativePath, "external sentinel\n");
      await write(input.assistantStateRoot, "sessions/direct.json", JSON.stringify(session(DIRECT_THREAD)));
      if (linkKind === "root") {
        await fs.rm(input.codexHome, { recursive: true });
        await fs.symlink(outside, input.codexHome, "dir");
      } else if (linkKind === "ancestor") {
        await fs.symlink(path.join(outside, "sessions"), path.join(input.codexHome, "sessions"), "dir");
      } else {
        const target = path.join(input.codexHome, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (linkKind === "hardlink") await fs.link(outsideFile, target);
        else await fs.symlink(outsideFile, target);
      }
      await pruneHostedCodexHomeToSessionReferencedRollouts(input);
      await assert.rejects(fs.lstat(input.codexHome), { code: "ENOENT" });
      assert.equal(await fs.readFile(outsideFile, "utf8"), "external sentinel\n");
    });
  });
}

test("pruning checks each retained file once and visits only retained ancestors once", async () => {
  await withWorkspace(async (input) => {
    for (const threadId of [DIRECT_THREAD, GROUP_THREAD]) {
      await write(input.assistantStateRoot, `sessions/${threadId}.json`, JSON.stringify(session(threadId)));
      await write(input.codexHome, rollout(threadId), "history\n");
    }
    for (const relativePath of MEMORY_PATHS) await write(input.codexHome, relativePath, "memory\n");
    await write(input.codexHome, "cache/private/deep/file", "residue\n");
    const inspected: string[] = [];
    const listed: string[] = [];
    const originalLstat = fs.lstat;
    const originalReaddir = fs.readdir;
    try {
      // Forward every argument and the exact result. Updating builtin bindings
      // observes real filesystem work without replacing the pruning implementation.
      fs.lstat = ((...args: Parameters<typeof fs.lstat>) => {
        inspected.push(String(args[0]));
        return Reflect.apply(originalLstat, fs, args);
      }) as typeof fs.lstat;
      fs.readdir = ((...args: Parameters<typeof fs.readdir>) => {
        listed.push(String(args[0]));
        return Reflect.apply(originalReaddir, fs, args);
      }) as typeof fs.readdir;
      syncBuiltinESMExports();
      await pruneHostedCodexHomeToSessionReferencedRollouts({ ...input, nativeMemoryRetention: "read-artifacts" });
    } finally {
      fs.lstat = originalLstat;
      fs.readdir = originalReaddir;
      syncBuiltinESMExports();
    }
    assert.deepEqual(inspected.sort(), [input.codexHome, ...[
      rollout(DIRECT_THREAD), rollout(GROUP_THREAD), ...MEMORY_PATHS,
    ].map((relativePath) => path.join(input.codexHome, relativePath))].sort());
    const expectedDirectories = ["", "memories", "sessions", "sessions/2026", "sessions/2026/09", "sessions/2026/09/13"];
    assert.deepEqual(listed.filter((entry) => entry.startsWith(input.codexHome)).sort(),
      expectedDirectories.map((relativePath) => path.join(input.codexHome, relativePath)).sort());
    await assert.rejects(fs.lstat(path.join(input.codexHome, "cache")), { code: "ENOENT" });
  });
});

test("pruning propagates a retained-directory read failure instead of reporting completion", async () => {
  await withWorkspace(async (input) => {
    await write(input.assistantStateRoot, "sessions/direct.json", JSON.stringify(session(DIRECT_THREAD)));
    await write(input.codexHome, rollout(DIRECT_THREAD), "history\n");
    const failure = Object.assign(new Error("synthetic retained-directory failure"), { code: "EIO" });
    const originalReaddir = fs.readdir;
    try {
      fs.readdir = ((...args: Parameters<typeof fs.readdir>) => {
        if (String(args[0]) === path.join(input.codexHome, "sessions")) return Promise.reject(failure);
        return Reflect.apply(originalReaddir, fs, args);
      }) as typeof fs.readdir;
      syncBuiltinESMExports();
      await assert.rejects(pruneHostedCodexHomeToSessionReferencedRollouts(input), (error) => error === failure);
    } finally {
      fs.readdir = originalReaddir;
      syncBuiltinESMExports();
    }
    assert.equal(await fs.readFile(path.join(input.codexHome, rollout(DIRECT_THREAD)), "utf8"), "history\n");
  });
});

test("pruning propagates a private-subtree deletion failure instead of leaving residue silently", async () => {
  await withWorkspace(async (input) => {
    await write(input.codexHome, "cache/private.json", "private residue\n");
    const failure = Object.assign(new Error("synthetic private-subtree delete failure"), { code: "EACCES" });
    const originalRm = fs.rm;
    try {
      fs.rm = ((...args: Parameters<typeof fs.rm>) => {
        if (String(args[0]) === path.join(input.codexHome, "cache")) return Promise.reject(failure);
        return Reflect.apply(originalRm, fs, args);
      }) as typeof fs.rm;
      syncBuiltinESMExports();
      await assert.rejects(pruneHostedCodexHomeToSessionReferencedRollouts(input), (error) => error === failure);
    } finally {
      fs.rm = originalRm;
      syncBuiltinESMExports();
    }
  });
});
