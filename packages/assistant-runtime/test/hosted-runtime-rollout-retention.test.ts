import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import {
  getAssistantSession,
  lookupAssistantSession,
  resolveAssistantSession,
  saveAssistantSession,
} from "@murphai/assistant-engine/assistant-store";
import { createAssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import { runHostedIdleCheckpointMaintenance } from "../src/hosted-runtime/idle-maintenance.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("retires idle resumes before snapshot and converges after a lost checkpoint or old restore", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"));
  const durableRoot = await mkdtemp(path.join(os.tmpdir(), "murph-rollout-retention-"));
  roots.push(durableRoot);
  const vaultRoot = path.join(durableRoot, "vault");
  const operatorHomeRoot = path.join(durableRoot, "home");
  await initializeVault({ vaultRoot });
  const target = createAssistantModelTarget({ provider: "codex-cli", model: "gpt-6.1-sol" });
  const cases = [
    { alias: "old-notification", lastTurnAt: "2026-10-03T11:59:59.999Z", turnCount: 1, retire: true },
    { alias: "old-conversation", lastTurnAt: "2026-09-01T12:00:00.000Z", turnCount: 8, retire: true },
    { alias: "boundary", lastTurnAt: "2026-10-03T12:00:00.000Z", turnCount: 2, retire: false },
    { alias: "recent", lastTurnAt: "2026-11-01T12:00:00.000Z", turnCount: 4, retire: false },
    { alias: "updated-fallback", lastTurnAt: null, turnCount: 1, retire: true },
  ];
  const sessions = [];
  for (const [index, item] of cases.entries()) {
    const resolved = await resolveAssistantSession({
      alias: item.alias, target, vault: vaultRoot,
      ...(item.alias === "old-conversation" ? {
        channel: "linq", identityId: "synthetic-member", threadId: "synthetic-chat", threadIsDirect: true,
      } : {}),
    });
    const threadId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const rolloutRelativePath = `sessions/2026/09/01/rollout-2026-09-01T12-00-00-${threadId}.jsonl`;
    const rollout = path.join(".codex-hosted", rolloutRelativePath);
    await mkdir(path.dirname(path.join(operatorHomeRoot, rollout)), { recursive: true });
    const rolloutBytes = Buffer.from(JSON.stringify({ syntheticRollout: item.alias }) + "\n");
    await writeFile(path.join(operatorHomeRoot, rollout), rolloutBytes);
    const session = await saveAssistantSession(vaultRoot, {
      ...resolved.session,
      createdAt: "2026-09-01T12:00:00.000Z",
      // New metadata must not extend retention when lastTurnAt exists.
      updatedAt: item.lastTurnAt ? "2026-11-02T12:00:00.000Z" : "2026-09-01T12:00:00.000Z",
      lastTurnAt: item.lastTurnAt, turnCount: item.turnCount,
      codexResume: { routeFingerprint: "synthetic-route", threadId, rolloutRelativePath },
    });
    const sessionPath = path.join(".runtime/operations/assistant/sessions", `${session.sessionId}.json`);
    sessions.push({ ...item, session, sessionPath, rollout, rolloutBytes, sessionBytes: await readFile(path.join(vaultRoot, sessionPath)) });
  }
  // A newer session owns routing while its idle predecessor still claims the
  // same alias and conversation key in its persisted session record.
  const predecessor = sessions[1]!;
  const successor = sessions[3]!;
  successor.session = await saveAssistantSession(vaultRoot, {
    ...successor.session,
    alias: predecessor.session.alias,
    binding: predecessor.session.binding,
  });
  successor.sessionBytes = await readFile(path.join(vaultRoot, successor.sessionPath));
  expect(successor.session.sessionId).not.toBe(predecessor.session.sessionId);
  const assertSuccessorRouting = async (vault: string, home: string) => {
    for (const locator of [
      { alias: predecessor.session.alias },
      { channel: "linq", identityId: "synthetic-member", threadId: "synthetic-chat", threadIsDirect: true },
    ]) {
      const resolved = await lookupAssistantSession({ ...locator, vault });
      expect(resolved.session.sessionId).toBe(successor.session.sessionId);
    }
    expect(await readFile(path.join(vault, successor.sessionPath))).toEqual(successor.sessionBytes);
    expect(await readFile(path.join(home, successor.rollout))).toEqual(successor.rolloutBytes);
  };
  await assertSuccessorRouting(vaultRoot, operatorHomeRoot);
  const oldSnapshot = await snapshotHostedExecutionContext({ vaultRoot, operatorHomeRoot });
  expect(oldSnapshot.codexHomeSnapshotDiagnostics?.codexResumeThreadCount).toBe(5);

  const maintain = (vault: string) => runHostedIdleCheckpointMaintenance({
    vaultRoot: vault, credentialSource: "platform", memberId: "synthetic-member",
    providerName: null, pendingWork: false, recordUsage: null,
    resolveAssistantSessionId: null, shutdownSignal: null, wakeSignal: null,
  });
  await maintain(vaultRoot);
  await assertSuccessorRouting(vaultRoot, operatorHomeRoot);
  expect(await getAssistantSession(vaultRoot, predecessor.session.sessionId)).toMatchObject({ codexResume: null, resumeState: null });
  // Local retirement survived, but the checkpoint did not: rerunning is safe.
  const retiredBytes = await Promise.all(sessions.map((item) => readFile(path.join(vaultRoot, item.sessionPath))));
  await maintain(vaultRoot);
  await assertSuccessorRouting(vaultRoot, operatorHomeRoot);
  expect(await Promise.all(sessions.map((item) => readFile(path.join(vaultRoot, item.sessionPath))))).toEqual(retiredBytes);

  const archive = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot, vaultRoot, operatorHomeRoot });
  expect(archive.codexHomeSnapshotDiagnostics?.codexResumeThreadCount).toBe(2);
  expect(archive.entries.filter((entry) => entry.root === "operator-home" && entry.kind === "file")
    .map((entry) => entry.relativePath).sort()).toEqual(sessions.filter((item) => !item.retire).map((item) => item.rollout).sort());
  const snapshot = await snapshotHostedExecutionContext({ vaultRoot, operatorHomeRoot });
  const restored = await restoreHostedExecutionContext({ bundle: snapshot.bundle, workspaceRoot: path.join(durableRoot, "new-restore") });
  await assertSuccessorRouting(restored.vaultRoot, restored.operatorHomeRoot);
  for (const item of sessions) {
    const current = await getAssistantSession(restored.vaultRoot, item.session.sessionId);
    if (item.retire) {
      expect(current.codexResume).toBeNull();
      expect(current.resumeState).toBeNull();
      expect({ ...current, codexResume: item.session.codexResume, resumeState: item.session.resumeState }).toEqual(item.session);
      await expect(readFile(path.join(restored.operatorHomeRoot, item.rollout))).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(await readFile(path.join(restored.vaultRoot, item.sessionPath))).toEqual(item.sessionBytes);
      expect(await readFile(path.join(restored.operatorHomeRoot, item.rollout))).toEqual(item.rolloutBytes);
    }
  }
  // A crash losing the local workspace restores the old complete checkpoint.
  const oldRestore = await restoreHostedExecutionContext({ bundle: oldSnapshot.bundle, workspaceRoot: path.join(durableRoot, "old-restore") });
  await assertSuccessorRouting(oldRestore.vaultRoot, oldRestore.operatorHomeRoot);
  for (const item of sessions) {
    expect((await getAssistantSession(oldRestore.vaultRoot, item.session.sessionId)).codexResume).toEqual(item.session.codexResume);
    expect(await readFile(path.join(oldRestore.operatorHomeRoot, item.rollout))).toEqual(item.rolloutBytes);
  }
  await maintain(oldRestore.vaultRoot);
  await assertSuccessorRouting(oldRestore.vaultRoot, oldRestore.operatorHomeRoot);
  expect(await getAssistantSession(oldRestore.vaultRoot, predecessor.session.sessionId)).toMatchObject({ codexResume: null, resumeState: null });
  const converged = await snapshotHostedExecutionContext(oldRestore);
  expect(converged.codexHomeSnapshotDiagnostics?.codexResumeThreadCount).toBe(2);
});
