import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSharePackFromVault, initializeVault, listFoods, readFood, upsertFood, upsertProtocolItem } from "@healthybob/core";
import { restoreHostedExecutionContext, snapshotHostedExecutionContext } from "@healthybob/runtime-state";
import { assistantOutboxIntentSchema, resolveAssistantStatePaths } from "healthybob";

const hostedCliMocks = vi.hoisted(() => ({
  drainAssistantOutbox: vi.fn(),
  runAssistantAutomation: vi.fn(),
}));

vi.mock("../src/runtime-adapter.js", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime-adapter.js")>(
    "../src/runtime-adapter.js",
  );

  return {
    ...actual,
    createHostedCliRuntime: () => {
      const runtime = actual.createHostedCliRuntime();

      return {
        ...runtime,
        drainAssistantOutbox: (...args: Parameters<typeof runtime.drainAssistantOutbox>) =>
          hostedCliMocks.drainAssistantOutbox(...args),
        runAssistantAutomation: (...args: Parameters<typeof runtime.runAssistantAutomation>) =>
          hostedCliMocks.runAssistantAutomation(...args),
      };
    },
  };
});

import { runHostedExecutionJob, setHostedExecutionRunStartHookForTests } from "../src/node-runner.js";
import { writeHostedUserEnvToAgentStateBundle } from "../src/user-env.js";

describe("runHostedExecutionJob", () => {
  const cleanupPaths: string[] = [];

  beforeEach(async () => {
    vi.restoreAllMocks();
    const actual = await vi.importActual<typeof import("../src/runtime-adapter.js")>(
      "../src/runtime-adapter.js",
    );
    const runtime = actual.createHostedCliRuntime();
    hostedCliMocks.runAssistantAutomation.mockImplementation((input) => runtime.runAssistantAutomation(input));
    hostedCliMocks.drainAssistantOutbox.mockImplementation((input) => runtime.drainAssistantOutbox(input));
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
    const importedFood = (await listFoods(restored.vaultRoot)).find((food) => food.title === "Morning Smoothie");

    expect(result.result.summary).toContain('Imported share pack');
    expect(importedFood).toBeDefined();
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
    const previousHostedMemberId = process.env.HOSTED_MEMBER_ID;
    const previousVault = process.env.VAULT;

    process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = "CUSTOM_API_KEY";
    process.env.CUSTOM_API_KEY = "custom-original-key";
    process.env.HOME = "/tmp/original-home";
    process.env.HOSTED_MEMBER_ID = "original-member";
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
      expect(process.env.HOSTED_MEMBER_ID).toBe("original-member");
      expect(process.env.VAULT).toBe("/tmp/original-vault");

      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS", previousAllowedUserEnvKeys);
      restoreEnvVar("CUSTOM_API_KEY", previousCustomApiKey);
      restoreEnvVar("HOME", previousHome);
      restoreEnvVar("HOSTED_MEMBER_ID", previousHostedMemberId);
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
    let commitCallCount = 0;
    const commitFetch = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/commit")) {
        commitCallCount += 1;
        seenValues.push(process.env.CUSTOM_API_KEY ?? "missing");
        if (commitCallCount === 1) {
          await releaseFirstCommit.promise;
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).includes("/finalize")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
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
      expect(commitCallCount).toBe(2);
      expect(seenValues).toEqual(["user-one-key", "user-two-key"]);
    } finally {
      setHostedExecutionRunStartHookForTests(null);
      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS", previousAllowedUserEnvKeys);
    }
  });

  it("reconciles journaled hosted assistant deliveries only after the durable commit callback", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-outbox-"));
    const operatorHomeRoot = path.join(parent, "home");
    const vaultRoot = path.join(parent, "vault");
    cleanupPaths.push(parent);
    await mkdir(operatorHomeRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });

    const statePaths = resolveAssistantStatePaths(vaultRoot);
    await mkdir(statePaths.outboxDirectory, { recursive: true });
    const intentId = "outbox_hosted_reconcile";
    const createdAt = "2026-03-26T12:00:00.000Z";
    await writeFile(
      path.join(statePaths.outboxDirectory, `${intentId}.json`),
      `${JSON.stringify(assistantOutboxIntentSchema.parse({
        schema: "healthybob.assistant-outbox-intent.v1",
        intentId,
        sessionId: "sess_hosted",
        turnId: "turn_hosted",
        createdAt,
        updatedAt: createdAt,
        lastAttemptAt: null,
        nextAttemptAt: createdAt,
        sentAt: null,
        attemptCount: 0,
        status: "pending",
        message: "Queued the Linq reply.",
        dedupeKey: "dedupe_hosted",
        targetFingerprint: "target_hosted",
        channel: "linq",
        identityId: null,
        actorId: null,
        threadId: "chat_123",
        threadIsDirect: true,
        bindingDelivery: {
          kind: "thread",
          target: "chat_123",
        },
        explicitTarget: null,
        delivery: null,
        lastError: null,
      }))}\n`,
    );
    const initialSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        fetchCalls.push(`${init?.method ?? "GET"} ${String(url)}`);

        if (String(url).includes("/internal/runner-events/")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (String(url).includes("/internal/runner-outbox/")) {
          return new Response(JSON.stringify({
            delivery: {
              channel: "linq",
              sentAt: "2026-03-26T12:00:05.000Z",
              target: "chat_123",
              targetKind: "thread",
              messageLength: "Queued the Linq reply.".length,
            },
            intentId,
          }), { status: 200 });
        }

        throw new Error(`Unexpected fetch URL: ${String(url)}`);
      }),
    );

    const result = await runHostedExecutionJob({
      bundles: {
        agentState: Buffer.from(initialSnapshot.agentStateBundle).toString("base64"),
        vault: Buffer.from(initialSnapshot.vaultBundle).toString("base64"),
      },
      commit: {
        bundleRefs: {
          agentState: null,
          vault: null,
        },
        token: "runner-token",
        url: "https://worker.example.test/internal/runner-events/member_123/evt_outbox/commit",
      },
      dispatch: {
        event: {
          kind: "member.activated",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          userId: "member_123",
        },
        eventId: "evt_outbox",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    expect(fetchCalls).toEqual([
      "POST https://worker.example.test/internal/runner-events/member_123/evt_outbox/commit",
      "GET https://worker.example.test/internal/runner-outbox/member_123/outbox_hosted_reconcile?dedupeKey=dedupe_hosted",
      "POST https://worker.example.test/internal/runner-events/member_123/evt_outbox/finalize",
    ]);

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-outbox-restored-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: Buffer.from(result.bundles.agentState!, "base64"),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const savedIntent = JSON.parse(
      await readFile(path.join(resolveAssistantStatePaths(restored.vaultRoot).outboxDirectory, `${intentId}.json`), "utf8"),
    ) as {
      delivery: { target: string } | null;
      status: string;
    };
    const statusSnapshot = JSON.parse(
      await readFile(resolveAssistantStatePaths(restored.vaultRoot).statusPath, "utf8"),
    ) as {
      outbox: { pending: number; sent: number };
      recentTurns: Array<{ deliveryDisposition: string; status: string }>;
    };

    expect(savedIntent.status).toBe("sent");
    expect(savedIntent.delivery?.target).toBe("chat_123");
    expect(statusSnapshot.outbox.pending).toBe(0);
    expect(statusSnapshot.outbox.sent).toBe(1);
    expect(statusSnapshot.recentTurns).toEqual([]);
  });

  it("journals hosted assistant deliveries after the durable commit before finalizing returned bundles", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-outbox-journal-"));
    cleanupPaths.push(parent);
    const intentId = "outbox_hosted_send";
    const createdAt = "2026-03-26T12:00:00.000Z";
    const sentAt = "2026-03-26T12:00:05.000Z";
    const delivery = {
      channel: "linq" as const,
      sentAt,
      target: "chat_123",
      targetKind: "thread" as const,
      messageLength: "Queued the Linq reply.".length,
    };
    const writePendingIntent = async (vaultRoot: string) => {
      const statePaths = resolveAssistantStatePaths(vaultRoot);
      await mkdir(statePaths.outboxDirectory, { recursive: true });
      await writeFile(
        path.join(statePaths.outboxDirectory, `${intentId}.json`),
        `${JSON.stringify(assistantOutboxIntentSchema.parse({
          schema: "healthybob.assistant-outbox-intent.v1",
          intentId,
          sessionId: "sess_hosted",
          turnId: "turn_hosted",
          createdAt,
          updatedAt: createdAt,
          lastAttemptAt: null,
          nextAttemptAt: createdAt,
          sentAt: null,
          attemptCount: 0,
          status: "pending",
          message: "Queued the Linq reply.",
          dedupeKey: "dedupe_hosted_send",
          targetFingerprint: "target_hosted_send",
          channel: "linq",
          identityId: null,
          actorId: null,
          threadId: "chat_123",
          threadIsDirect: true,
          bindingDelivery: {
            kind: "thread",
            target: "chat_123",
          },
          explicitTarget: null,
          delivery: null,
          lastError: null,
        }))}\n`,
      );
    };

    hostedCliMocks.runAssistantAutomation.mockImplementationOnce(async ({ vault }) => {
      await writePendingIntent(vault);
    });
    hostedCliMocks.drainAssistantOutbox.mockImplementationOnce(async ({ dispatchHooks, limit, vault }) => {
      expect(limit).toBe(20);
      const statePaths = resolveAssistantStatePaths(vault);
      const intentPath = path.join(statePaths.outboxDirectory, `${intentId}.json`);
      const pendingIntent = assistantOutboxIntentSchema.parse(
        JSON.parse(await readFile(intentPath, "utf8")),
      );

      await expect(
        dispatchHooks?.resolveDeliveredIntent?.({
          intent: pendingIntent,
          vault,
        }),
      ).resolves.toBeNull();
      await dispatchHooks?.persistDeliveredIntent?.({
        delivery,
        intent: pendingIntent,
        vault,
      });
      await writeFile(
        intentPath,
        `${JSON.stringify({
          ...pendingIntent,
          updatedAt: sentAt,
          nextAttemptAt: null,
          sentAt,
          status: "sent",
          delivery,
          lastError: null,
        })}\n`,
      );

      return {
        attempted: 1,
        failed: 0,
        queued: 0,
        sent: 1,
      };
    });

    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        fetchCalls.push(`${init?.method ?? "GET"} ${String(url)}`);

        if (String(url).includes("/internal/runner-events/") && String(url).includes("/commit")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (String(url).includes("/internal/runner-outbox/") && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({
            delivery: null,
            intentId,
          }), { status: 200 });
        }

        if (String(url).includes("/internal/runner-outbox/") && init?.method === "PUT") {
          return new Response(String(init?.body), { status: 200 });
        }

        if (String(url).includes("/internal/runner-events/") && String(url).includes("/finalize")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        throw new Error(`Unexpected fetch URL: ${String(url)}`);
      }),
    );

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
        url: "https://worker.example.test/internal/runner-events/member_123/evt_outbox_send/commit",
      },
      dispatch: {
        event: {
          kind: "member.activated",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          userId: "member_123",
        },
        eventId: "evt_outbox_send",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    expect(fetchCalls).toEqual([
      "POST https://worker.example.test/internal/runner-events/member_123/evt_outbox_send/commit",
      "GET https://worker.example.test/internal/runner-outbox/member_123/outbox_hosted_send?dedupeKey=dedupe_hosted_send",
      "PUT https://worker.example.test/internal/runner-outbox/member_123/outbox_hosted_send?dedupeKey=dedupe_hosted_send",
      "POST https://worker.example.test/internal/runner-events/member_123/evt_outbox_send/finalize",
    ]);

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-outbox-journal-restored-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: Buffer.from(result.bundles.agentState!, "base64"),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const savedIntent = assistantOutboxIntentSchema.parse(
      JSON.parse(
        await readFile(
          path.join(resolveAssistantStatePaths(restored.vaultRoot).outboxDirectory, `${intentId}.json`),
          "utf8",
        ),
      ),
    );
    const statusSnapshot = JSON.parse(
      await readFile(resolveAssistantStatePaths(restored.vaultRoot).statusPath, "utf8"),
    ) as {
      outbox: { pending: number; sent: number };
      recentTurns: Array<{ deliveryDisposition: string; status: string }>;
    };

    expect(savedIntent.status).toBe("sent");
    expect(savedIntent.delivery).toEqual(delivery);
    expect(statusSnapshot.outbox.pending).toBe(0);
    expect(statusSnapshot.outbox.sent).toBe(1);
    expect(statusSnapshot.recentTurns).toEqual([]);
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

      expect(commitFetch).toHaveBeenCalledTimes(2);
      expect(timeoutSpy).toHaveBeenCalledWith(15_000);
      const [commitUrl, commitInit] = commitFetch.mock.calls[0] ?? [];
      const [finalizeUrl, finalizeInit] = commitFetch.mock.calls[1] ?? [];
      expect(commitUrl).toBe("https://worker.example.test/internal/runner-events/member_123/evt_commit/commit");
      expect(commitInit?.headers).toMatchObject({
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      });
      expect(JSON.parse(String(commitInit?.body))).toMatchObject({
        currentBundleRefs: {
          agentState: null,
          vault: null,
        },
        result: result.result,
      });
      expect(String(finalizeUrl)).toBe("https://worker.example.test/internal/runner-events/member_123/evt_commit/finalize");
      expect(finalizeInit?.headers).toMatchObject({
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      });
      expect(JSON.parse(String(finalizeInit?.body))).toEqual({
        bundles: result.bundles,
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
