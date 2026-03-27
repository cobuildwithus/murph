import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assistantOutboxIntentSchema,
  resolveAssistantStatePaths,
} from "@healthybob/assistant-runtime";
import { buildSharePackFromVault, initializeVault, listFoods, upsertFood, upsertProtocolItem } from "@healthybob/core";
import { restoreHostedExecutionContext, snapshotHostedExecutionContext } from "@healthybob/runtime-state";

const hostedCliMocks = vi.hoisted(() => ({
  dispatchAssistantOutboxIntent: vi.fn(),
  drainAssistantOutbox: vi.fn(),
  runAssistantAutomation: vi.fn(),
}));

vi.mock("healthybob", async () => {
  const actual = await vi.importActual<typeof import("healthybob")>("healthybob");
  return {
    ...actual,
    dispatchAssistantOutboxIntent: (...args: Parameters<typeof actual.dispatchAssistantOutboxIntent>) =>
      hostedCliMocks.dispatchAssistantOutboxIntent(...args),
    drainAssistantOutbox: (...args: Parameters<typeof actual.drainAssistantOutbox>) =>
      hostedCliMocks.drainAssistantOutbox(...args),
    runAssistantAutomation: (...args: Parameters<typeof actual.runAssistantAutomation>) =>
      hostedCliMocks.runAssistantAutomation(...args),
  };
});

import {
  runHostedExecutionJob,
  setHostedExecutionCallbackBaseUrlsForTests,
  setHostedExecutionRunModeForTests,
  setHostedExecutionRunStartHookForTests,
} from "../src/node-runner.ts";

describe("runHostedExecutionJob", () => {
  const cleanupPaths: string[] = [];

  beforeEach(async () => {
    vi.restoreAllMocks();
    setHostedExecutionCallbackBaseUrlsForTests(null);
    setHostedExecutionRunModeForTests("in-process");
    const actual = await vi.importActual<typeof import("healthybob")>("healthybob");
    hostedCliMocks.dispatchAssistantOutboxIntent.mockImplementation((input) =>
      actual.dispatchAssistantOutboxIntent(input));
    hostedCliMocks.runAssistantAutomation.mockImplementation((input) => actual.runAssistantAutomation(input));
    hostedCliMocks.drainAssistantOutbox.mockImplementation((input) => actual.drainAssistantOutbox(input));
  });

  afterEach(async () => {
    setHostedExecutionCallbackBaseUrlsForTests(null);
    setHostedExecutionRunModeForTests(null);
    setHostedExecutionRunStartHookForTests(null);
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { force: true, recursive: true })));
  });

  it("bootstraps a new hosted member context only during activation and records the result explicitly", async () => {
    const result = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
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

    expect(result.result.summary).toContain("Processed member activation");
    expect(result.result.summary).toContain("created the canonical vault");
    expect(result.result.summary).toContain("enabled Linq auto-reply");
    expect(result.result.summary).toContain("Parser jobs: 0.");
    expect(automationState.autoReplyChannels).toContain("linq");
    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".healthybob", "config.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".healthybob", "hosted", "user-env.json"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(path.join(restored.vaultRoot, "vault.json"), "utf8")).resolves.toContain("{");
  });

  it("reuses the existing hosted member bootstrap on repeated activation", async () => {
    const firstActivation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation_first",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    const secondActivation = await runHostedExecutionJob({
      bundles: firstActivation.bundles,
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation_second",
        occurredAt: "2026-03-26T12:05:00.000Z",
      },
    });

    expect(secondActivation.result.summary).toContain("Processed member activation");
    expect(secondActivation.result.summary).toContain("reused the canonical vault");
    expect(secondActivation.result.summary).toContain("kept Linq auto-reply enabled");
  });


  it("bootstraps hosted email auto-reply when the hosted email bridge is configured", async () => {
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;

    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            linqChatId: "chat_email",
            normalizedPhoneNumber: "+15551230000",
            userId: "member_email",
          },
          eventId: "evt_activation_email",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-email-bootstrap-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: Buffer.from(result.bundles.agentState!, "base64"),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      ) as { autoReplyChannels: string[] };

      expect(result.result.summary).toContain("enabled hosted email auto-reply");
      expect(automationState.autoReplyChannels).toContain("email");
      expect(automationState.autoReplyChannels).toContain("linq");
    } finally {
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
    }
  });

  it("fetches raw hosted email through the email worker bridge when processing inbound email events", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          linqChatId: "chat_email_fetch",
          normalizedPhoneNumber: "+15551230001",
          userId: "member_email_fetch",
        },
        eventId: "evt_activation_email_fetch",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    const raw = [
      'From: Alice Example <alice@example.test>',
      'To: assistant@mail.example.test',
      'Subject: Hosted inbox hello',
      'Message-ID: <msg_email_fetch@example.test>',
      'Date: Thu, 26 Mar 2026 12:00:00 +0000',
      '',
      'Hello from a hosted inbound email.',
      '',
    ].join('\r\n');
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "GET"} ${request.url ?? ""}`);

      if (request.url === "/messages/raw_email_123") {
        response.statusCode = 200;
        response.setHeader("content-type", "message/rfc822");
        response.end(raw);
        return;
      }

      response.statusCode = 404;
      response.end("Not found");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted email test server to expose a TCP port.");
      }

      setHostedExecutionCallbackBaseUrlsForTests({
        emailBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        dispatch: {
          event: {
            envelopeFrom: "alice@example.test",
            envelopeTo: "assistant+u-member@mail.example.test",
            identityId: "assistant@mail.example.test",
            kind: "email.message.received",
            rawMessageKey: "raw_email_123",
            threadTarget: null,
            userId: "member_email_fetch",
          },
          eventId: "evt_email_fetch",
          occurredAt: "2026-03-26T12:05:00.000Z",
        },
      });

      expect(result.result.summary).toContain("Persisted hosted email capture");
      expect(requests).toEqual(["GET /messages/raw_email_123"]);
    } finally {
      setHostedExecutionCallbackBaseUrlsForTests(null);
      server.close();
      await once(server, "close");
    }
  });

  it("rejects non-activation hosted events until member activation bootstrap has run", async () => {
    await expect(runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_tick_without_bootstrap",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    })).rejects.toThrow(
      "Hosted execution for assistant.cron.tick requires member.activated bootstrap first.",
    );
  });

  it("runs follow-up hosted events without re-running durable bootstrap", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    const followUp = await runHostedExecutionJob({
      bundles: activation.bundles,
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_tick",
        occurredAt: "2026-03-26T12:05:00.000Z",
      },
    });

    expect(followUp.result.summary).toContain("Processed assistant cron tick (manual)");
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
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_456",
        },
        eventId: "evt_activation_share",
        occurredAt: "2026-03-26T12:25:00.000Z",
      },
    });

    const result = await runHostedExecutionJob({
      bundles: activation.bundles,
      dispatch: {
        event: {
          kind: "vault.share.accepted",
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
    const result = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_user_env",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
      userEnv: {
        OPENAI_API_KEY: "sk-user",
        TELEGRAM_BOT_TOKEN: "bot-token",
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
    ).rejects.toThrow();
  });

  it("restores the prior process env after per-user overrides are applied", async () => {
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
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_user_env_restore",
          occurredAt: "2026-03-26T12:05:00.000Z",
        },
        userEnv: {
          CUSTOM_API_KEY: "custom-user-key",
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

  it("allows concurrent hosted runs because each job uses isolated process env", async () => {
    setHostedExecutionRunModeForTests("isolated");
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS;
    process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = "CUSTOM_API_KEY";

    const firstRunStarted = createDeferred<void>();
    const secondRunStarted = createDeferred<void>();
    const firstCommitSeen = createDeferred<void>();
    const secondCommitSeen = createDeferred<void>();
    const releaseFirstCommit = createDeferred<void>();
    let startedRunCount = 0;
    let commitCount = 0;
    let commitsInFlight = 0;
    let maxCommitsInFlight = 0;

    setHostedExecutionRunStartHookForTests(() => {
      startedRunCount += 1;
      if (startedRunCount === 1) {
        firstRunStarted.resolve();
      } else if (startedRunCount === 2) {
        secondRunStarted.resolve();
      }
    });

    const server = createServer(async (request, response) => {
      if (request.url?.includes("/commit")) {
        commitCount += 1;
        commitsInFlight += 1;
        maxCommitsInFlight = Math.max(maxCommitsInFlight, commitsInFlight);

        if (commitCount === 1) {
          firstCommitSeen.resolve();
          await releaseFirstCommit.promise;
        } else if (commitCount === 2) {
          secondCommitSeen.resolve();
        }

        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: true }));
        commitsInFlight -= 1;
        return;
      }

      if (request.url?.includes("/finalize")) {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.statusCode = 404;
      response.end("Not found");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted test server to expose a TCP port.");
      }
      setHostedExecutionCallbackBaseUrlsForTests({
        commitBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const firstRun = runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        commit: {
          bundleRefs: { agentState: null, vault: null },
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_1",
          },
          eventId: "evt_one",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        userEnv: {
          CUSTOM_API_KEY: "user-one-key",
        },
      });

      const secondRun = runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        commit: {
          bundleRefs: { agentState: null, vault: null },
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_2",
          },
          eventId: "evt_two",
          occurredAt: "2026-03-26T12:00:01.000Z",
        },
        userEnv: {
          CUSTOM_API_KEY: "user-two-key",
        },
      });

      await Promise.all([
        firstRunStarted.promise,
        secondRunStarted.promise,
        firstCommitSeen.promise,
      ]);
      await secondCommitSeen.promise;

      releaseFirstCommit.resolve();
      await Promise.all([firstRun, secondRun]);

      expect(startedRunCount).toBe(2);
      expect(commitCount).toBe(2);
      expect(maxCommitsInFlight).toBe(2);
    } finally {
      setHostedExecutionCallbackBaseUrlsForTests(null);
      server.close();
      await once(server, "close");
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

        if (String(url).startsWith("http://commit.worker/events/")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (
          String(url).startsWith(
            "http://side-effects.worker/effects/",
          )
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: {
              delivery: {
                channel: "linq",
                sentAt: "2026-03-26T12:00:05.000Z",
                target: "chat_123",
                targetKind: "thread",
                messageLength: "Queued the Linq reply.".length,
              },
              effectId: intentId,
              fingerprint: "dedupe_hosted",
              intentId,
              kind: "assistant.delivery",
              recordedAt: "2026-03-26T12:00:05.000Z",
            },
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
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_outbox",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    expect(fetchCalls).toEqual([
      "POST http://commit.worker/events/evt_outbox/commit",
      "GET http://side-effects.worker/effects/outbox_hosted_reconcile?fingerprint=dedupe_hosted&kind=assistant.delivery",
      "POST http://commit.worker/events/evt_outbox/finalize",
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
    hostedCliMocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dispatchHooks, intentId: nextIntentId, vault }) => {
      expect(nextIntentId).toBe(intentId);
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
        deliveryError: null,
        intent: assistantOutboxIntentSchema.parse({
          ...pendingIntent,
          updatedAt: sentAt,
          nextAttemptAt: null,
          sentAt,
          status: "sent",
          delivery,
          lastError: null,
        }),
        session: null,
      };
    });
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        fetchCalls.push(`${init?.method ?? "GET"} ${String(url)}`);

        if (
          String(url)
          === "http://commit.worker/events/evt_outbox_send/commit"
        ) {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            sideEffects: [
              {
                effectId: intentId,
                fingerprint: "dedupe_hosted_send",
                intentId,
                kind: "assistant.delivery",
              },
            ],
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (
          String(url)
          === "http://side-effects.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send&kind=assistant.delivery"
          && (init?.method ?? "GET") === "GET"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: null,
          }), { status: 200 });
        }

        if (
          String(url)
          === "http://side-effects.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send&kind=assistant.delivery"
          && init?.method === "PUT"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: JSON.parse(String(init?.body)),
          }), { status: 200 });
        }

        if (
          String(url)
          === "http://commit.worker/events/evt_outbox_send/finalize"
        ) {
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
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_outbox_send",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    expect(fetchCalls).toEqual([
      "POST http://commit.worker/events/evt_outbox_send/commit",
      "GET http://side-effects.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send&kind=assistant.delivery",
      "PUT http://side-effects.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send&kind=assistant.delivery",
      "POST http://commit.worker/events/evt_outbox_send/finalize",
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

  it("replays committed side effects on resume without rerunning compute or recommitting", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-outbox-resume-"));
    const operatorHomeRoot = path.join(parent, "home");
    const vaultRoot = path.join(parent, "vault");
    cleanupPaths.push(parent);
    await mkdir(operatorHomeRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });

    const statePaths = resolveAssistantStatePaths(vaultRoot);
    await mkdir(statePaths.outboxDirectory, { recursive: true });
    const intentId = "outbox_hosted_resume";
    const createdAt = "2026-03-26T12:00:00.000Z";
    const sentAt = "2026-03-26T12:00:05.000Z";
    const delivery = {
      channel: "linq" as const,
      sentAt,
      target: "chat_123",
      targetKind: "thread" as const,
      messageLength: "Queued the Linq reply.".length,
    };
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
        dedupeKey: "dedupe_hosted_resume",
        targetFingerprint: "target_hosted_resume",
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

    setHostedExecutionCallbackBaseUrlsForTests({
      sideEffectsBaseUrl: "http://side-effects.worker",
    });
    hostedCliMocks.runAssistantAutomation.mockImplementation(() => {
      throw new Error("resume path should not rerun hosted automation");
    });
    hostedCliMocks.runAssistantAutomation.mockClear();
    hostedCliMocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dispatchHooks, intentId: nextIntentId, vault }) => {
      expect(nextIntentId).toBe(intentId);
      const nextStatePaths = resolveAssistantStatePaths(vault);
      const intentPath = path.join(nextStatePaths.outboxDirectory, `${intentId}.json`);
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
        deliveryError: null,
        intent: assistantOutboxIntentSchema.parse({
          ...pendingIntent,
          updatedAt: sentAt,
          nextAttemptAt: null,
          sentAt,
          status: "sent",
          delivery,
          lastError: null,
        }),
        session: null,
      };
    });
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        fetchCalls.push(`${init?.method ?? "GET"} ${String(url)}`);

        if (
          String(url)
          === "http://side-effects.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume&kind=assistant.delivery"
          && (init?.method ?? "GET") === "GET"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: null,
          }), { status: 200 });
        }

        if (
          String(url)
          === "http://side-effects.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume&kind=assistant.delivery"
          && init?.method === "PUT"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: JSON.parse(String(init?.body)),
          }), { status: 200 });
        }

        if (String(url) === "http://commit.worker/events/evt_outbox_resume/finalize") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
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
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_outbox_resume",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            summary: "committed",
          },
          sideEffects: [
            {
              effectId: intentId,
              fingerprint: "dedupe_hosted_resume",
              intentId,
              kind: "assistant.delivery",
            },
          ],
        },
      },
    });

    expect(hostedCliMocks.runAssistantAutomation).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([
      "GET http://side-effects.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume&kind=assistant.delivery",
      "PUT http://side-effects.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume&kind=assistant.delivery",
      "POST http://commit.worker/events/evt_outbox_resume/finalize",
    ]);
    expect(fetchCalls).not.toContain("POST http://commit.worker/events/evt_outbox_resume/commit");
    expect(result.result).toEqual({
      eventsHandled: 1,
      summary: "committed",
    });

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cloudflare-outbox-resume-restored-"));
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
        },
        dispatch: {
          event: {
            kind: "member.activated",
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
      expect(commitUrl).toBe(
        "http://commit.worker/events/evt_commit/commit",
      );
      expect(commitInit?.headers).toMatchObject({
        "content-type": "application/json; charset=utf-8",
      });
      expect(JSON.parse(String(commitInit?.body))).toMatchObject({
        currentBundleRefs: {
          agentState: null,
          vault: null,
        },
        result: result.result,
      });
      expect(String(finalizeUrl)).toBe(
        "http://commit.worker/events/evt_commit/finalize",
      );
      expect(finalizeInit?.headers).toMatchObject({
        "content-type": "application/json; charset=utf-8",
      });
      expect(JSON.parse(String(finalizeInit?.body))).toEqual({
        bundles: result.bundles,
      });
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", previousCommitTimeout);
    }
  });

  it("does not block a concurrent hosted run when another hosted commit fails", async () => {
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
        },
        dispatch: {
          event: {
            kind: "member.activated",
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
            userId: "member_456",
          },
          eventId: "evt_after_failure",
          occurredAt: "2026-03-26T12:10:01.000Z",
        },
      });

      await secondRunStarted.promise;
      expect(startedRunCount).toBe(2);

      releaseFirstCommit.resolve();
      await expect(firstRun).rejects.toThrow(
        "Hosted runner durable commit failed for member_123/evt_commit with HTTP 500.",
      );

      const secondResult = await secondRun;

      expect(startedRunCount).toBe(2);
      expect(secondResult.result.summary).toContain("Processed member activation");
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
