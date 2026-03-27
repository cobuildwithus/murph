import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSharePackFromVault, initializeVault, readFood, upsertFood, upsertProtocolItem } from "@healthybob/core";
import { restoreHostedExecutionContext } from "@healthybob/runtime-state";

import { runHostedExecutionJob, setHostedExecutionRunStartHookForTests } from "../src/node-runner.js";
import { writeHostedUserEnvToAgentStateBundle } from "../src/user-env.js";

describe("runHostedExecutionJob", () => {
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { force: true, recursive: true })));
  });

  it("bootstraps a new hosted member context and persists assistant auto-reply state", async () => {
    const result = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-test-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: Buffer.from(result.bundles.agentState!, "base64"),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const automationState = JSON.parse(
      await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
    ) as { autoReplyChannels: string[] };

    expect(result.result.summary).toContain("Initialized");
    expect(result.result.summary).toContain("Parser jobs: 0.");
    expect(automationState.autoReplyChannels).toContain("linq");
    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".healthybob", "config.json"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(path.join(restored.vaultRoot, "vault.json"), "utf8")).resolves.toContain("{");
  });

  it("imports a shared food bundle with attached supplement protocols", async () => {
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-source-"));
    cleanupPaths.push(sourceVaultRoot);
    await initializeVault({ vaultRoot: sourceVaultRoot });

    const creatine = await upsertProtocolItem({
      vaultRoot: sourceVaultRoot,
      title: "Creatine monohydrate",
      kind: "supplement",
      group: "supplement",
      startedOn: "2026-03-01",
    });
    const smoothie = await upsertFood({
      vaultRoot: sourceVaultRoot,
      title: "Morning Smoothie",
      kind: "smoothie",
      attachedProtocolIds: [creatine.record.protocolId],
      autoLogDaily: {
        time: "08:00",
      },
    });
    const pack = await buildSharePackFromVault({
      vaultRoot: sourceVaultRoot,
      foods: [{ id: smoothie.record.foodId }],
      includeAttachedProtocols: true,
      logMeal: {
        food: { id: smoothie.record.foodId },
      },
    });

    const result = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "vault.share.accepted",
          shareCode: "share_test_123",
          pack,
          userId: "member_456",
        },
        eventId: "evt_share_123",
        occurredAt: "2026-03-26T12:30:00.000Z",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-share-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: Buffer.from(result.bundles.agentState!, "base64"),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const importedFood = await readFood({
      vaultRoot: restored.vaultRoot,
      slug: "morning-smoothie",
    });

    expect(result.result.summary).toContain('Imported share pack');
    expect(importedFood.attachedProtocolIds?.length).toBe(1);
    expect(importedFood.autoLogDaily?.time).toBe("08:00");
  });

  it("preserves encrypted per-user env overrides across one-shot runs", async () => {
    const initialAgentState = writeHostedUserEnvToAgentStateBundle({
      agentStateBundle: null,
      env: {
        OPENAI_API_KEY: "sk-user",
        TELEGRAM_BOT_TOKEN: "bot-token",
      },
      now: "2026-03-26T12:00:00.000Z",
    });

    const result = await runHostedExecutionJob({
      bundles: {
        agentState: Buffer.from(initialAgentState).toString("base64"),
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          userId: "member_123",
        },
        eventId: "evt_user_env",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-test-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: Buffer.from(result.bundles.agentState!, "base64"),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });

    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".healthybob", "hosted", "user-env.json"), "utf8"),
    ).resolves.toContain("\"OPENAI_API_KEY\": \"sk-user\"");
  });

  it("restores the prior process env after per-user overrides are applied", async () => {
    const initialAgentState = writeHostedUserEnvToAgentStateBundle({
      agentStateBundle: null,
      env: {
        CUSTOM_API_KEY: "custom-user-key",
      },
      now: "2026-03-26T12:00:00.000Z",
    });
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS;
    const previousCustomApiKey = process.env.CUSTOM_API_KEY;
    const previousHome = process.env.HOME;
    const previousHostedMemberId = process.env.HEALTHYBOB_HOSTED_MEMBER_ID;
    const previousVault = process.env.VAULT;

    process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = "CUSTOM_API_KEY";
    process.env.CUSTOM_API_KEY = "custom-original-key";
    process.env.HOME = "/tmp/original-home";
    process.env.HEALTHYBOB_HOSTED_MEMBER_ID = "original-member";
    process.env.VAULT = "/tmp/original-vault";

    try {
      await runHostedExecutionJob({
        bundles: {
          agentState: Buffer.from(initialAgentState).toString("base64"),
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            linqChatId: "chat_123",
            normalizedPhoneNumber: "+15551234567",
            userId: "member_123",
          },
          eventId: "evt_user_env_restore",
          occurredAt: "2026-03-26T12:05:00.000Z",
        },
      });
    } finally {
      expect(process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS).toBe("CUSTOM_API_KEY");
      expect(process.env.CUSTOM_API_KEY).toBe("custom-original-key");
      expect(process.env.HOME).toBe("/tmp/original-home");
      expect(process.env.HEALTHYBOB_HOSTED_MEMBER_ID).toBe("original-member");
      expect(process.env.VAULT).toBe("/tmp/original-vault");

      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS", previousAllowedUserEnvKeys);
      restoreEnvVar("CUSTOM_API_KEY", previousCustomApiKey);
      restoreEnvVar("HOME", previousHome);
      restoreEnvVar("HEALTHYBOB_HOSTED_MEMBER_ID", previousHostedMemberId);
      restoreEnvVar("VAULT", previousVault);
    }
  });

  it("serializes concurrent hosted runs so per-user env overrides do not overlap", async () => {
    const firstAgentState = writeHostedUserEnvToAgentStateBundle({
      agentStateBundle: null,
      env: {
        CUSTOM_API_KEY: "user-one-key",
      },
      now: "2026-03-26T12:00:00.000Z",
    });
    const secondAgentState = writeHostedUserEnvToAgentStateBundle({
      agentStateBundle: null,
      env: {
        CUSTOM_API_KEY: "user-two-key",
      },
      now: "2026-03-26T12:00:00.000Z",
    });
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS;
    process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = "CUSTOM_API_KEY";

    const firstRunStarted = createDeferred<void>();
    const secondRunStarted = createDeferred<void>();
    let startedRunCount = 0;
    const releaseFirstCommit = createDeferred<void>();
    const seenValues: string[] = [];
    const commitFetch = vi.fn()
      .mockImplementationOnce(async () => {
        seenValues.push(process.env.CUSTOM_API_KEY ?? "missing");
        await releaseFirstCommit.promise;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
      .mockImplementationOnce(async () => {
        seenValues.push(process.env.CUSTOM_API_KEY ?? "missing");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });
    vi.stubGlobal("fetch", commitFetch);
    setHostedExecutionRunStartHookForTests(() => {
      startedRunCount += 1;
      if (startedRunCount === 1) {
        firstRunStarted.resolve();
      } else if (startedRunCount === 2) {
        secondRunStarted.resolve();
      }
    });

    try {
      const firstRun = runHostedExecutionJob({
        bundles: {
          agentState: Buffer.from(firstAgentState).toString("base64"),
          vault: null,
        },
        commit: {
          bundleRefs: { agentState: null, vault: null },
          token: "runner-token",
          url: "https://worker.example.test/internal/runner-events/member_1/evt_one/commit",
        },
        dispatch: {
          event: {
            kind: "member.activated",
            linqChatId: "chat_1",
            normalizedPhoneNumber: "+15550000001",
            userId: "member_1",
          },
          eventId: "evt_one",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      });

      await firstRunStarted.promise;
      await vi.waitFor(() => {
        expect(commitFetch).toHaveBeenCalledTimes(1);
      });

      const secondRun = runHostedExecutionJob({
        bundles: {
          agentState: Buffer.from(secondAgentState).toString("base64"),
          vault: null,
        },
        commit: {
          bundleRefs: { agentState: null, vault: null },
          token: "runner-token",
          url: "https://worker.example.test/internal/runner-events/member_2/evt_two/commit",
        },
        dispatch: {
          event: {
            kind: "member.activated",
            linqChatId: "chat_2",
            normalizedPhoneNumber: "+15550000002",
            userId: "member_2",
          },
          eventId: "evt_two",
          occurredAt: "2026-03-26T12:00:01.000Z",
        },
      });

      await Promise.resolve();
      expect(startedRunCount).toBe(1);
      expect(commitFetch).toHaveBeenCalledTimes(1);

      releaseFirstCommit.resolve();
      await firstRun;
      await secondRunStarted.promise;
      await secondRun;

      expect(startedRunCount).toBe(2);
      expect(commitFetch).toHaveBeenCalledTimes(2);
      expect(seenValues).toEqual(["user-one-key", "user-two-key"]);
    } finally {
      setHostedExecutionRunStartHookForTests(null);
      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS", previousAllowedUserEnvKeys);
    }
  });

  it("posts a durable commit before returning when a commit callback is configured", async () => {
    const previousCommitTimeout = process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS;
    process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS = "15000";
    const commitFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", commitFetch);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        commit: {
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          token: "runner-token",
          url: "https://worker.example.test/internal/runner-events/member_123/evt_commit/commit",
        },
        dispatch: {
          event: {
            kind: "member.activated",
            linqChatId: "chat_123",
            normalizedPhoneNumber: "+15551234567",
            userId: "member_123",
          },
          eventId: "evt_commit",
          occurredAt: "2026-03-26T12:10:00.000Z",
        },
      });

      expect(commitFetch).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(15_000);
      const [url, init] = commitFetch.mock.calls[0] ?? [];
      expect(url).toBe("https://worker.example.test/internal/runner-events/member_123/evt_commit/commit");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        bundles: result.bundles,
        currentBundleRefs: {
          agentState: null,
          vault: null,
        },
        result: result.result,
      });
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", previousCommitTimeout);
    }
  });

  it("releases the runner queue after a failed hosted run", async () => {
    const firstRunStarted = createDeferred<void>();
    const secondRunStarted = createDeferred<void>();
    const firstCommitEntered = createDeferred<void>();
    const releaseFirstCommit = createDeferred<void>();
    let startedRunCount = 0;

    setHostedExecutionRunStartHookForTests(() => {
      startedRunCount += 1;
      if (startedRunCount === 1) {
        firstRunStarted.resolve();
      } else if (startedRunCount === 2) {
        secondRunStarted.resolve();
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementationOnce(async () => {
        firstCommitEntered.resolve();
        await releaseFirstCommit.promise;
        return new Response("commit failed", { status: 500 });
      }),
    );

    try {
      const firstRun = runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        commit: {
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          token: "runner-token",
          url: "https://worker.example.test/internal/runner-events/member_123/evt_commit/commit",
        },
        dispatch: {
          event: {
            kind: "member.activated",
            linqChatId: "chat_123",
            normalizedPhoneNumber: "+15551234567",
            userId: "member_123",
          },
          eventId: "evt_commit",
          occurredAt: "2026-03-26T12:10:00.000Z",
        },
      });

      await firstRunStarted.promise;
      await firstCommitEntered.promise;

      const secondRun = runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            linqChatId: "chat_456",
            normalizedPhoneNumber: "+15557654321",
            userId: "member_456",
          },
          eventId: "evt_after_failure",
          occurredAt: "2026-03-26T12:10:01.000Z",
        },
      });

      await Promise.resolve();
      expect(startedRunCount).toBe(1);

      releaseFirstCommit.resolve();
      await expect(firstRun).rejects.toThrow(
        "Hosted runner durable commit failed for member_123/evt_commit with HTTP 500.",
      );

      await secondRunStarted.promise;
      const secondResult = await secondRun;

      expect(startedRunCount).toBe(2);
      expect(secondResult.result.summary).toContain("Initialized hosted member bundles");
    } finally {
      setHostedExecutionRunStartHookForTests(null);
    }
  });

});

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });

  return {
    promise,
    reject,
    resolve,
  };
}
