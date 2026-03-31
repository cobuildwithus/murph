import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  ensureAssistantStateDirectory,
  resolveAssistantStatePaths,
} from "../src/index.ts";

test("assistant-state directory ensure adopts a single legacy bucket for a renamed vault root", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-state-rename-"));
  const renamedVaultRoot = path.join(workspaceRoot, "vault");

  try {
    const renamedPaths = resolveAssistantStatePaths(renamedVaultRoot);
    const assistantStateParent = path.dirname(renamedPaths.assistantStateRoot);
    const legacyBucketRoot = path.join(assistantStateParent, "vault-111111111111");

    await mkdir(path.join(legacyBucketRoot, "sessions"), { recursive: true });
    await writeFile(path.join(legacyBucketRoot, "sessions", "session.json"), "{\"ok\":true}\n");

    await ensureAssistantStateDirectory(renamedPaths.sessionsDirectory);

    assert.equal(
      await readFile(path.join(renamedPaths.sessionsDirectory, "session.json"), "utf8"),
      "{\"ok\":true}\n",
    );
    await assert.rejects(readFile(path.join(legacyBucketRoot, "sessions", "session.json"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assistant-state directory ensure leaves multiple legacy sibling buckets untouched", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-state-ambiguous-"));
  const renamedWorkspace = path.join(workspaceRoot, "renamed");
  const renamedVaultRoot = path.join(renamedWorkspace, "vault");

  try {
    const renamedPaths = resolveAssistantStatePaths(renamedVaultRoot);
    const assistantStateParent = path.dirname(renamedPaths.assistantStateRoot);

    await mkdir(path.join(assistantStateParent, "vault-111111111111"), { recursive: true });
    await mkdir(path.join(assistantStateParent, "vault-222222222222"), { recursive: true });

    await ensureAssistantStateDirectory(renamedPaths.sessionsDirectory);

    assert.equal((await lstat(renamedPaths.assistantStateRoot)).isDirectory(), true);
    assert.equal(
      (await lstat(path.join(assistantStateParent, "vault-111111111111"))).isDirectory(),
      true,
    );
    assert.equal(
      (await lstat(path.join(assistantStateParent, "vault-222222222222"))).isDirectory(),
      true,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assistant-state directory ensure keeps the current bucket when it already exists", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-state-current-"));
  const renamedVaultRoot = path.join(workspaceRoot, "vault");

  try {
    const renamedPaths = resolveAssistantStatePaths(renamedVaultRoot);
    const assistantStateParent = path.dirname(renamedPaths.assistantStateRoot);
    const legacyBucketRoot = path.join(assistantStateParent, "vault-111111111111");

    await mkdir(path.join(legacyBucketRoot, "sessions"), { recursive: true });
    await writeFile(path.join(legacyBucketRoot, "sessions", "legacy.json"), "{\"legacy\":true}\n");
    await mkdir(path.join(renamedPaths.sessionsDirectory), { recursive: true });
    await writeFile(path.join(renamedPaths.sessionsDirectory, "current.json"), "{\"current\":true}\n");

    await ensureAssistantStateDirectory(renamedPaths.sessionsDirectory);

    assert.equal(
      await readFile(path.join(renamedPaths.sessionsDirectory, "current.json"), "utf8"),
      "{\"current\":true}\n",
    );
    assert.equal(
      await readFile(path.join(legacyBucketRoot, "sessions", "legacy.json"), "utf8"),
      "{\"legacy\":true}\n",
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
