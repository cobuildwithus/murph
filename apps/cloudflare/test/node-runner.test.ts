import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { buildSharePackFromVault, initializeVault, listFoods, upsertFood, upsertProtocolItem } from "@murphai/core";
import { createInboxPipeline, openInboxRuntime, rebuildRuntimeFromVault } from "@murphai/inboxd";
import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  listPendingAssistantUsageRecords,
  parseHostedEmailThreadTarget,
  resolveAssistantStatePaths,
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";
import { assistantOutboxIntentSchema } from "@murphai/assistant-core";
import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
} from "@murphai/assistant-runtime";

const hostedCliMocks = vi.hoisted(() => ({
  dispatchAssistantOutboxIntent: vi.fn(),
  runAssistantAutomation: vi.fn(),
}));

vi.mock("@murphai/assistant-core", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-core")>(
    "@murphai/assistant-core",
  );
  return {
    ...actual,
    dispatchAssistantOutboxIntent: (...args: Parameters<typeof actual.dispatchAssistantOutboxIntent>) =>
      hostedCliMocks.dispatchAssistantOutboxIntent(...args),
    runAssistantAutomation: (...args: Parameters<typeof actual.runAssistantAutomation>) =>
      hostedCliMocks.runAssistantAutomation(...args),
  };
});

import {
  runHostedExecutionJob as runHostedExecutionJobInternal,
  setHostedExecutionCallbackBaseUrlsForTests,
  setHostedExecutionRunModeForTests,
  setHostedExecutionRunStartHookForTests,
} from "../src/node-runner.ts";

const describe = baseDescribe.sequential;

type NodeRunnerTestInput =
  HostedAssistantRuntimeJobInput["request"] &
  Pick<
    HostedAssistantRuntimeConfig,
    "forwardedEnv" | "internalWorkerProxyToken" | "userEnv"
  >;

async function runHostedExecutionJob(
  input: NodeRunnerTestInput,
  options?: {
    signal?: AbortSignal;
  },
) {
  const {
    forwardedEnv,
    internalWorkerProxyToken,
    userEnv,
    ...request
  } = input;
  const runtime: HostedAssistantRuntimeConfig = {
    ...(forwardedEnv === undefined ? {} : { forwardedEnv }),
    ...(internalWorkerProxyToken === undefined ? {} : { internalWorkerProxyToken }),
    ...(userEnv === undefined ? {} : { userEnv }),
  };

  return runHostedExecutionJobInternal({
    request,
    ...(Object.keys(runtime).length === 0 ? {} : { runtime }),
  }, options);
}

describe("runHostedExecutionJob", () => {
  const cleanupPaths: string[] = [];
  const initialHostedAssistantAutomation = process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION = "off";
    setHostedExecutionCallbackBaseUrlsForTests(null);
    setHostedExecutionRunModeForTests("in-process");
    const actualAssistantCore = await vi.importActual<typeof import("@murphai/assistant-core")>(
      "@murphai/assistant-core",
    );
    hostedCliMocks.dispatchAssistantOutboxIntent.mockImplementation((input) =>
      actualAssistantCore.dispatchAssistantOutboxIntent(input));
    hostedCliMocks.runAssistantAutomation.mockImplementation((input) =>
      actualAssistantCore.runAssistantAutomation(input));
  });

  afterEach(async () => {
    restoreEnvVar("HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION", initialHostedAssistantAutomation);
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
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-test-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const automationState = JSON.parse(
      await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
    ) as { autoReplyChannels: string[] };

    expect(result.result.summary).toContain("Processed member activation");
    expect(result.result.summary).toContain("created the canonical vault");
    expect(result.result.summary).toContain("kept hosted email auto-reply unchanged");
    expect(result.result.summary).toContain("Parser jobs: 0.");
    expect(automationState.autoReplyChannels).not.toContain("linq");
    expect(automationState.autoReplyChannels).not.toContain("email");
    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "hosted", "user-env.json"), "utf8"),
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
    expect(secondActivation.result.summary).toContain("kept hosted email auto-reply unchanged");
  });


  it("does not bootstrap hosted email auto-reply when ingress is configured but send credentials are missing", async () => {
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;

    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_email_partial",
          },
          eventId: "evt_activation_email_partial",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-bootstrap-partial-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      ) as { autoReplyChannels: string[] };

      expect(result.result.summary).toContain("kept hosted email auto-reply unchanged");
      expect(automationState.autoReplyChannels).not.toContain("email");
    } finally {
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
    }
  });

  it("persists hosted Telegram captures from webhook-style dispatches", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_telegram_ingress",
        },
        eventId: "evt_activation_telegram_ingress",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

	      const result = await runHostedExecutionJob({
	        bundles: activation.bundles,
	        dispatch: {
	          event: {
          botUserId: null,
          kind: "telegram.message.received",
          telegramUpdate: {
            message: {
              chat: {
                id: 123,
                type: "private",
              },
              date: 1_774_522_600,
              from: {
                first_name: "Alice",
                id: 456,
              },
              message_id: 1,
              text: "hello from Telegram",
            },
            update_id: 321,
          },
          userId: "member_telegram_ingress",
        },
        eventId: "telegram:update:321",
        occurredAt: "2026-03-26T12:05:00.000Z",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-telegram-ingress-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const runtime = await openInboxRuntime({
      vaultRoot: restored.vaultRoot,
    });

    try {
      await rebuildRuntimeFromVault({
        runtime,
        vaultRoot: restored.vaultRoot,
      });
      const capture = runtime.listCaptures({ limit: 1 })[0];

      expect(result.result.summary).toContain("Persisted Telegram capture");
      expect(capture?.actor.id).toBe("456");
      expect(capture?.text).toBe("hello from Telegram");
      expect(capture?.thread.isDirect).toBe(true);
      expect(capture?.thread.id).toContain("123");
    } finally {
      runtime.close();
    }
  });

  it("bootstraps hosted email auto-reply when the hosted email bridge is configured", async () => {
    const previousAutomationEnabled = process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION;
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;

    delete process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION;
    process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID = "acct_123";
    process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN = "cf-token";
    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_email",
          },
          eventId: "evt_activation_email",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-bootstrap-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      ) as { autoReplyChannels: string[] };

      expect(result.result.summary).toContain("enabled hosted email auto-reply");
      expect(automationState.autoReplyChannels).toContain("email");
      expect(automationState.autoReplyChannels).not.toContain("linq");
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION", previousAutomationEnabled);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID", previousHostedEmailAccountId);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_API_TOKEN", previousHostedEmailApiToken);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
    }
  });

  it("does not bootstrap hosted email auto-reply when sender credentials exist without a hosted email domain", async () => {
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailFromAddress = process.env.HOSTED_EMAIL_FROM_ADDRESS;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;

    process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID = "acct_123";
    process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN = "cf-token";
    process.env.HOSTED_EMAIL_FROM_ADDRESS = "assistant@mail.example.test";
    delete process.env.HOSTED_EMAIL_DOMAIN;
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_email_no_domain",
          },
          eventId: "evt_activation_email_no_domain",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-bootstrap-no-domain-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      ) as { autoReplyChannels: string[] };

      expect(result.result.summary).toContain("kept hosted email auto-reply unchanged");
      expect(automationState.autoReplyChannels).not.toContain("email");
    } finally {
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID", previousHostedEmailAccountId);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_API_TOKEN", previousHostedEmailApiToken);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_FROM_ADDRESS", previousHostedEmailFromAddress);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
    }
  });

  it("does not enable hosted auto-reply on non-activation events after bootstrap", async () => {
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;

    delete process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    delete process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    delete process.env.HOSTED_EMAIL_DOMAIN;
    delete process.env.HOSTED_EMAIL_LOCAL_PART;
    delete process.env.HOSTED_EMAIL_SIGNING_SECRET;

    try {
      const activation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_email_late_env",
          },
          eventId: "evt_activation_email_late_env",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      });

      process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID = "acct_123";
      process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN = "cf-token";
      process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
      process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
      process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_email_late_env",
          },
          eventId: "evt_tick_email_late_env",
          occurredAt: "2026-03-26T12:05:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-late-env-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      ) as { autoReplyChannels: string[] };

      expect(result.result.summary).toContain("Processed assistant cron tick");
      expect(automationState.autoReplyChannels).not.toContain("email");
    } finally {
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID", previousHostedEmailAccountId);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_API_TOKEN", previousHostedEmailApiToken);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
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
            identityId: "assistant@mail.example.test",
            kind: "email.message.received",
            rawMessageKey: "raw_email_123",
            userId: "member_email_fetch",
          },
	          eventId: "evt_email_fetch",
	          occurredAt: "2026-03-26T12:05:00.000Z",
	        },
	        userEnv: {
	          HOSTED_USER_VERIFIED_EMAIL: "alice@example.test",
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

  it("persists hosted stable-alias email captures with Reply-To-based thread targets", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_email_alias",
        },
        eventId: "evt_activation_email_alias",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    const raw = [
      'From: Alice Example <alice@example.test>',
      'Reply-To: Alice Replies <reply@example.test>, Team Replies <team@example.test>',
      'To: assistant+u-member_email_alias@mail.example.test',
      'Cc: assistant@mail.example.test',
      'Subject: Hosted alias hello',
      'Message-ID: <msg_email_alias@example.test>',
      'Date: Thu, 26 Mar 2026 12:00:00 +0000',
      '',
      'Hello from the hosted stable alias path.',
      '',
    ].join('\r\n');
    const server = createServer((request, response) => {
      if (request.url === "/messages/raw_email_alias") {
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
            identityId: "assistant@mail.example.test",
            kind: "email.message.received",
            rawMessageKey: "raw_email_alias",
            userId: "member_email_alias",
          },
	          eventId: "evt_email_alias",
	          occurredAt: "2026-03-26T12:05:00.000Z",
	        },
	        userEnv: {
	          HOSTED_USER_VERIFIED_EMAIL: "alice@example.test",
	        },
	      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-alias-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const runtime = await openInboxRuntime({
        vaultRoot: restored.vaultRoot,
      });

      try {
        await rebuildRuntimeFromVault({
          runtime,
          vaultRoot: restored.vaultRoot,
        });
        const capture = runtime.listCaptures({ limit: 1 })[0];

        expect(capture?.actor.id).toBe("alice@example.test");
        expect(capture?.thread.id).toBeTruthy();
        expect(capture?.thread.isDirect).toBe(false);
      } finally {
        runtime.close();
      }
    } finally {
      setHostedExecutionCallbackBaseUrlsForTests(null);
      server.close();
      await once(server, "close");
    }
  });

  it("persists hosted Telegram captures through the hosted runtime event seam", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_telegram",
        },
        eventId: "evt_activation_telegram",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });

    const result = await runHostedExecutionJob({
      bundles: activation.bundles,
      dispatch: {
        event: {
          botUserId: null,
          kind: "telegram.message.received",
          telegramUpdate: {
            update_id: 123,
            message: {
              chat: {
                first_name: "Alice",
                id: 456,
                type: "private",
              },
              date: 1_711_620_000,
              from: {
                first_name: "Alice",
                id: 456,
                is_bot: false,
              },
              message_id: 789,
              text: "Hello from hosted Telegram.",
            },
          },
          userId: "member_telegram",
        },
        eventId: "evt_telegram",
        occurredAt: "2026-03-26T12:05:00.000Z",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-telegram-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const runtime = await openInboxRuntime({
      vaultRoot: restored.vaultRoot,
    });

    try {
      await rebuildRuntimeFromVault({
        runtime,
        vaultRoot: restored.vaultRoot,
      });
      const capture = runtime.listCaptures({ limit: 1 })[0];

      expect(result.result.summary).toContain("Persisted Telegram capture");
      expect(capture?.source).toBe("telegram");
      expect(capture?.externalId).toBe("update:123");
      expect(capture?.text).toBe("Hello from hosted Telegram.");
    } finally {
      runtime.close();
    }
  });

  it("hydrates hosted Telegram attachment bytes when runner Telegram env is present", async () => {
    const previousTelegramApiBaseUrl = process.env.TELEGRAM_API_BASE_URL;
    const previousTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const previousTelegramFileBaseUrl = process.env.TELEGRAM_FILE_BASE_URL;
    process.env.TELEGRAM_API_BASE_URL = "https://telegram-api.example.test";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_FILE_BASE_URL = "https://telegram-files.example.test";

    const attachmentBytes = Uint8Array.from([1, 2, 3, 4]);
    const artifactBytesByUrl = new Map<string, Uint8Array>();
    const fetchSpy = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith("http://artifacts.worker/objects/")) {
        if (init?.method === "PUT") {
          const bodyBytes = new Uint8Array(await new Response(init.body).arrayBuffer());
          artifactBytesByUrl.set(String(url), bodyBytes);
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (init?.method === "GET") {
          const storedBytes = artifactBytesByUrl.get(String(url));
          if (!storedBytes) {
            return new Response("Not found", { status: 404 });
          }

          return new Response(storedBytes, {
            headers: {
              "content-type": "application/octet-stream",
            },
            status: 200,
          });
        }
      }

      if (String(url) === "https://telegram-api.example.test/bottelegram-token/getFile?file_id=file_123") {
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify({
          ok: true,
          result: {
            file_id: "file_123",
            file_path: "photos/file_123.jpg",
            file_size: attachmentBytes.byteLength,
            file_unique_id: "photo_unique_123",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (String(url) === "https://telegram-files.example.test/bottelegram-token/photos/file_123.jpg") {
        expect(init?.method).toBe("GET");
        return new Response(attachmentBytes, {
          headers: {
            "content-type": "image/jpeg",
          },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const activation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_telegram_attachment",
          },
          eventId: "evt_activation_telegram_attachment",
          occurredAt: "2026-03-29T09:00:00.000Z",
        },
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        dispatch: {
          event: {
            botUserId: null,
            kind: "telegram.message.received",
            telegramUpdate: {
              update_id: 124,
              message: {
                caption: "Photo from hosted Telegram.",
                chat: {
                  first_name: "Alice",
                  id: 456,
                  type: "private",
                },
                date: 1_711_620_001,
                from: {
                  first_name: "Alice",
                  id: 456,
                  is_bot: false,
                },
                message_id: 790,
                photo: [
                  {
                    file_id: "file_123",
                    file_size: attachmentBytes.byteLength,
                    file_unique_id: "photo_unique_123",
                    height: 20,
                    width: 20,
                  },
                ],
              },
            },
            userId: "member_telegram_attachment",
          },
          eventId: "evt_telegram_attachment",
          occurredAt: "2026-03-29T09:05:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-telegram-attachment-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        artifactResolver: async ({ ref }) => {
          const bytes = artifactBytesByUrl.get(`http://artifacts.worker/objects/${ref.sha256}`);
          if (!bytes) {
            throw new Error(`Missing artifact ${ref.sha256}.`);
          }

          return bytes;
        },
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const runtime = await openInboxRuntime({
        vaultRoot: restored.vaultRoot,
      });

      try {
        await rebuildRuntimeFromVault({
          runtime,
          vaultRoot: restored.vaultRoot,
        });
        const captureSummary = runtime.listCaptures({ limit: 1 })[0];
        expect(captureSummary).toBeDefined();
        const capture = runtime.getCapture(captureSummary!.captureId);
        const attachment = capture?.attachments[0];

        expect(result.result.summary).toContain("Persisted Telegram capture");
        expect(capture?.text).toBe("Photo from hosted Telegram.");
        expect(attachment?.byteSize).toBe(attachmentBytes.byteLength);
        expect(attachment?.fileName).toBe("photo-photo_unique_123.jpg");
        expect(attachment?.storedPath).toBeTruthy();
        await expect(readFile(path.join(restored.vaultRoot, attachment!.storedPath!))).resolves.toEqual(
          Buffer.from(attachmentBytes),
        );
      } finally {
        runtime.close();
      }

      const telegramFetchCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).startsWith("https://telegram-"),
      );
      expect(telegramFetchCalls).toHaveLength(2);
      expect(String(telegramFetchCalls[0]?.[0])).toBe(
        "https://telegram-api.example.test/bottelegram-token/getFile?file_id=file_123",
      );
      expect(String(telegramFetchCalls[1]?.[0])).toBe(
        "https://telegram-files.example.test/bottelegram-token/photos/file_123.jpg",
      );
    } finally {
      restoreEnvVar("TELEGRAM_API_BASE_URL", previousTelegramApiBaseUrl);
      restoreEnvVar("TELEGRAM_BOT_TOKEN", previousTelegramBotToken);
      restoreEnvVar("TELEGRAM_FILE_BASE_URL", previousTelegramFileBaseUrl);
      vi.unstubAllGlobals();
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

  it("restores externalized raw artifacts and skips re-uploading unchanged hashes", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_artifacts",
        },
        eventId: "evt_activation_artifacts",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });
    const activationWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-activation-"));
    cleanupPaths.push(activationWorkspaceRoot);
    const restoredActivation = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(activation.bundles.agentState),
      vaultBundle: Buffer.from(activation.bundles.vault!, "base64"),
      workspaceRoot: activationWorkspaceRoot,
    });
    const rawAttachmentPath = path.join(
      restoredActivation.vaultRoot,
      "raw",
      "inbox",
      "2026-03-28",
      "capture_123",
      "attachments",
      "report.pdf",
    );
    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));

    const artifacts = new Map<string, Uint8Array>();
    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot: restoredActivation.operatorHomeRoot,
      vaultRoot: restoredActivation.vaultRoot,
    });
    const [artifactHash] = [...artifacts.keys()];
    expect(artifactHash).toBeDefined();

    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      requests.push(`${request.method ?? "GET"} ${request.url ?? ""}`);

      if (request.method === "GET" && request.url === `/objects/${artifactHash}`) {
        response.statusCode = 200;
        response.setHeader("content-type", "application/octet-stream");
        response.end(Buffer.from(artifacts.get(artifactHash!) ?? []));
        return;
      }

      if (request.method === "PUT" && request.url === `/objects/${artifactHash}`) {
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
        throw new Error("Expected the hosted artifact test server to expose a TCP port.");
      }

      setHostedExecutionCallbackBaseUrlsForTests({
        artifactsBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const result = await runHostedExecutionJob({
        bundles: {
          agentState: encodeHostedBundleBase64(snapshot.agentStateBundle),
          vault: encodeHostedBundleBase64(snapshot.vaultBundle),
        },
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_artifacts",
          },
          eventId: "evt_artifact_tick",
          occurredAt: "2026-03-26T12:05:00.000Z",
        },
      });

      expect(requests).toEqual([]);

      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-restored-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        artifactResolver: async ({ ref }) => {
          const bytes = artifacts.get(ref.sha256);
          if (!bytes) {
            throw new Error(`Missing artifact ${ref.sha256}.`);
          }

          return bytes;
        },
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });

      await expect(readFile(path.join(
        restored.vaultRoot,
        "raw",
        "inbox",
        "2026-03-28",
        "capture_123",
        "attachments",
        "report.pdf",
      ))).resolves.toEqual(Buffer.from("pdf-binary-artifact\n", "utf8"));
    } finally {
      setHostedExecutionCallbackBaseUrlsForTests(null);
      server.close();
      await once(server, "close");
    }
  });

  it("fails hosted execution when an externalized artifact cannot be fetched", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_artifacts_missing",
        },
        eventId: "evt_activation_artifacts_missing",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
    });
    const activationWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-missing-"));
    cleanupPaths.push(activationWorkspaceRoot);
    const restoredActivation = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(activation.bundles.agentState),
      vaultBundle: Buffer.from(activation.bundles.vault!, "base64"),
      workspaceRoot: activationWorkspaceRoot,
    });
    const sourceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-missing-source-"));
    cleanupPaths.push(sourceRoot);
    const attachmentPath = path.join(sourceRoot, "missing-document.pdf");
    await writeFile(attachmentPath, Buffer.from("%PDF-1.4\nmissing artifact\n", "utf8"));

    const runtime = await openInboxRuntime({
      vaultRoot: restoredActivation.vaultRoot,
    });

    try {
      const pipeline = await createInboxPipeline({
        runtime,
        vaultRoot: restoredActivation.vaultRoot,
      });
      await pipeline.processCapture({
        accountId: "self",
        actor: {
          displayName: "Friend",
          id: "contact-404",
          isSelf: false,
        },
        attachments: [
          {
            externalId: "att-404",
            fileName: "missing-document.pdf",
            kind: "document",
            mime: "application/pdf",
            originalPath: attachmentPath,
          },
        ],
        externalId: "msg-404",
        occurredAt: "2026-03-28T12:00:00.000Z",
        raw: {},
        receivedAt: "2026-03-28T12:00:05.000Z",
        source: "imessage",
        text: "document inbound",
        thread: {
          id: "chat-404",
          isDirect: true,
          title: "Missing artifact",
        },
      });

      expect(runtime.listAttachmentParseJobs({ state: "pending" })).toHaveLength(1);
    } finally {
      runtime.close();
    }

    const artifacts = new Map<string, Uint8Array>();
    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot: restoredActivation.operatorHomeRoot,
      vaultRoot: restoredActivation.vaultRoot,
    });
    const [artifactHash] = [...artifacts.keys()];
    expect(artifactHash).toBeDefined();

    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url === `/objects/${artifactHash}`) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      response.statusCode = 500;
      response.end("Unexpected request");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted artifact test server to expose a TCP port.");
      }

      setHostedExecutionCallbackBaseUrlsForTests({
        artifactsBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      await expect(runHostedExecutionJob({
        bundles: {
          agentState: encodeHostedBundleBase64(snapshot.agentStateBundle),
          vault: encodeHostedBundleBase64(snapshot.vaultBundle),
        },
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_artifacts_missing",
          },
          eventId: "evt_artifact_missing_tick",
          occurredAt: "2026-03-26T12:05:00.000Z",
        },
      })).rejects.toThrow(
        `Hosted runner artifact fetch failed for ${artifactHash} with HTTP 404.`,
      );
    } finally {
      setHostedExecutionCallbackBaseUrlsForTests(null);
      server.close();
      await once(server, "close");
    }
  });

  it("imports a hosted share through a direct control-plane client when the share token is configured", async () => {
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-source-"));
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
      attachedProtocolIds: [creatine.record.entity.protocolId],
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
    let sharePayloadRequests = 0;
    let lastBoundUserIdHeader: string | null = null;
    let lastRequestBody = "";
    const sharePayloadServer = createServer((request, response) => {
      sharePayloadRequests += 1;
      lastBoundUserIdHeader = typeof request.headers["x-hosted-execution-user-id"] === "string"
        ? request.headers["x-hosted-execution-user-id"]
        : null;
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on("end", () => {
        lastRequestBody = Buffer.concat(chunks).toString("utf8");

        if (
          request.method === "POST"
          && request.url === "/api/hosted-share/internal/share_123/payload"
          && request.headers.authorization === "Bearer share-pack-token"
        ) {
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify({
            pack,
            shareId: "share_123",
          }));
          return;
        }

        response.statusCode = 404;
        response.end("Not found");
      });
    });
    await new Promise<void>((resolve) => {
      sharePayloadServer.listen(0, () => resolve());
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

    try {
      const address = sharePayloadServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted share payload test server to expose a TCP port.");
      }

      setHostedExecutionCallbackBaseUrlsForTests({
        sharePackBaseUrl: `http://127.0.0.1:${address.port}`,
        sharePackToken: "share-pack-token",
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        dispatch: {
          event: {
            kind: "vault.share.accepted",
            share: {
              shareCode: "share_code_123",
              shareId: "share_123",
            },
            userId: "member_456",
          },
          eventId: "evt_share_123",
          occurredAt: "2026-03-26T12:30:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-share-direct-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const importedFood = (await listFoods(restored.vaultRoot)).find((entry) => entry.title === "Morning Smoothie");

      expect(sharePayloadRequests).toBe(1);
      expect(lastBoundUserIdHeader).toBe("member_456");
      expect(lastRequestBody).toBe(JSON.stringify({
        shareCode: "share_code_123",
      }));
      expect(importedFood).toBeDefined();
      expect(result.result.summary).toContain(`Imported share pack "${pack.title}"`);
    } finally {
      setHostedExecutionCallbackBaseUrlsForTests(null);
      sharePayloadServer.close();
      await once(sharePayloadServer, "close");
    }
  });

  it("imports a hosted share through the worker proxy without exposing a runner share token", async () => {
    const previousHostedExecutionInternalToken = process.env.HOSTED_EXECUTION_INTERNAL_TOKEN;
    const previousHostedShareInternalToken = process.env.HOSTED_SHARE_INTERNAL_TOKEN;
    process.env.HOSTED_EXECUTION_INTERNAL_TOKEN = "worker-control-token";
    delete process.env.HOSTED_SHARE_INTERNAL_TOKEN;

    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-share-proxy-source-"));
    cleanupPaths.push(sourceVaultRoot);
    await initializeVault({ vaultRoot: sourceVaultRoot });

    const supplement = await upsertProtocolItem({
      vaultRoot: sourceVaultRoot,
      title: "Magnesium glycinate",
      kind: "supplement",
      group: "supplement",
      startedOn: "2026-03-01",
    });
    const food = await upsertFood({
      vaultRoot: sourceVaultRoot,
      title: "Proxy Smoothie",
      kind: "smoothie",
      attachedProtocolIds: [supplement.record.entity.protocolId],
      autoLogDaily: {
        time: "08:00",
      },
    });
    const pack = await buildSharePackFromVault({
      vaultRoot: sourceVaultRoot,
      foods: [{ id: food.record.foodId }],
      includeAttachedProtocols: true,
      logMeal: {
        food: { id: food.record.foodId },
      },
    });
    const fetchSpy = vi.fn(async (url: string | URL) => {
      if (String(url) !== "http://share-pack.worker/api/hosted-share/internal/share_proxy_123/payload") {
        throw new Error(`Unexpected fetch URL: ${String(url)}`);
      }

      return new Response(JSON.stringify({
        pack,
        shareId: "share_proxy_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const activation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_proxy",
          },
          eventId: "evt_activation_share_proxy",
          occurredAt: "2026-03-26T12:25:00.000Z",
        },
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        dispatch: {
          event: {
            kind: "vault.share.accepted",
            share: {
              shareCode: "share_code_proxy",
              shareId: "share_proxy_123",
            },
            userId: "member_proxy",
          },
          eventId: "evt_share_proxy_123",
          occurredAt: "2026-03-26T12:30:00.000Z",
        },
        forwardedEnv: {
          HOSTED_SHARE_INTERNAL_TOKEN: "bad-forwarded-share-token",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-share-proxy-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const importedFood = (await listFoods(restored.vaultRoot)).find((entry) => entry.title === "Proxy Smoothie");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://share-pack.worker/api/hosted-share/internal/share_proxy_123/payload",
        expect.objectContaining({
          body: JSON.stringify({
            shareCode: "share_code_proxy",
          }),
          method: "POST",
        }),
      );
      expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();
      expect(importedFood).toBeDefined();
      expect(importedFood?.attachedProtocolIds?.length).toBe(1);
      expect(result.result.summary).toContain(`Imported share pack "${pack.title}"`);
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_INTERNAL_TOKEN", previousHostedExecutionInternalToken);
      restoreEnvVar("HOSTED_SHARE_INTERNAL_TOKEN", previousHostedShareInternalToken);
    }
  });

  it("applies caller-supplied forwarded env when launching isolated jobs", async () => {
    setHostedExecutionRunModeForTests("isolated");

    await expect(
      runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_isolated_env",
          },
          eventId: "evt_isolated_env",
          occurredAt: "2026-03-29T10:00:00.000Z",
        },
        forwardedEnv: {
          NODE_OPTIONS: "--definitely-invalid-node-option",
        },
      }),
    ).rejects.toThrow("--definitely-invalid-node-option is not allowed in NODE_OPTIONS");
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
        XAI_API_KEY: "xai-user",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-test-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });

    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "hosted", "user-env.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("exports pending hosted AI usage through the worker proxy without exposing the internal web token", async () => {
    const previousHostedExecutionInternalToken = process.env.HOSTED_EXECUTION_INTERNAL_TOKEN;
    process.env.HOSTED_EXECUTION_INTERNAL_TOKEN = "worker-control-token";

    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_usage_proxy",
        },
        eventId: "evt_activation_usage_proxy",
        occurredAt: "2026-03-29T10:00:00.000Z",
      },
    });
    const activationWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-usage-proxy-seed-"));
    cleanupPaths.push(activationWorkspaceRoot);
    const restoredActivation = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(activation.bundles.agentState),
      vaultBundle: Buffer.from(activation.bundles.vault!, "base64"),
      workspaceRoot: activationWorkspaceRoot,
    });
    await writePendingAssistantUsageRecord({
      record: {
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
        inputTokens: 10,
        memberId: "member_usage_proxy",
        occurredAt: "2026-03-29T10:05:00.000Z",
        outputTokens: 4,
        provider: "codex-cli",
        providerMetadataJson: null,
        providerName: null,
        providerRequestId: null,
        providerSessionId: "sess_usage_proxy",
        rawUsageJson: null,
        reasoningTokens: null,
        requestedModel: "gpt-5.4",
        routeId: "primary",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5.4",
        sessionId: "asst_usage_proxy",
        totalTokens: 14,
        turnId: "turn_usage_proxy",
        usageId: "turn_usage_proxy.attempt-1",
      },
      vault: restoredActivation.vaultRoot,
    });
    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot: restoredActivation.operatorHomeRoot,
      vaultRoot: restoredActivation.vaultRoot,
    });
    const fetchSpy = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url) !== "http://usage.worker/api/internal/hosted-execution/usage/record") {
        throw new Error(`Unexpected fetch URL: ${String(url)}`);
      }

      expect(new Headers(init?.headers).get("authorization")).toBeNull();

      return new Response(JSON.stringify({
        recorded: 1,
        usageIds: ["turn_usage_proxy.attempt-1"],
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: encodeHostedBundleBase64(snapshot.agentStateBundle),
          vault: encodeHostedBundleBase64(snapshot.vaultBundle),
        },
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_usage_proxy",
          },
          eventId: "evt_usage_proxy_export",
          occurredAt: "2026-03-29T10:06:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-usage-proxy-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://usage.worker/api/internal/hosted-execution/usage/record",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("application/json");
      const usageRequest = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(typeof usageRequest?.body).toBe("string");
      expect(String(usageRequest?.body)).toContain("\"usageId\":\"turn_usage_proxy.attempt-1\"");
      await expect(listPendingAssistantUsageRecords({
        vault: restored.vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_INTERNAL_TOKEN", previousHostedExecutionInternalToken);
    }
  });

  it("restores the prior process env after per-user overrides are applied", async () => {
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS;
    const previousCustomApiKey = process.env.CUSTOM_API_KEY;
    const previousHome = process.env.HOME;
    const previousVault = process.env.VAULT;

    process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = "CUSTOM_API_KEY";
    process.env.CUSTOM_API_KEY = "custom-original-key";
    process.env.HOME = "/tmp/original-home";
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
      expect(process.env.VAULT).toBe("/tmp/original-vault");

      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS", previousAllowedUserEnvKeys);
      restoreEnvVar("CUSTOM_API_KEY", previousCustomApiKey);
      restoreEnvVar("HOME", previousHome);
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
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-"));
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
        schema: "murph.assistant-outbox-intent.v1",
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
        agentState: encodeHostedBundleBase64(initialSnapshot.agentStateBundle),
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

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-restored-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
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
    const previousAutomationEnabled = process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION;
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-journal-"));
    cleanupPaths.push(parent);
    process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION = "true";
    const intentId = "outbox_hosted_send";
    const createdAt = "2026-03-26T12:00:00.000Z";
    const sentAt = "2026-03-26T12:00:05.000Z";
    const delivery = {
      channel: "linq" as const,
      idempotencyKey: "assistant-outbox:outbox_hosted_send",
      sentAt,
      target: "chat_123",
      targetKind: "thread" as const,
      messageLength: "Queued the Linq reply.".length,
      providerMessageId: null,
      providerThreadId: null,
    };
    const writePendingIntent = async (vaultRoot: string) => {
      const statePaths = resolveAssistantStatePaths(vaultRoot);
      await mkdir(statePaths.outboxDirectory, { recursive: true });
      await writeFile(
        path.join(statePaths.outboxDirectory, `${intentId}.json`),
        `${JSON.stringify(assistantOutboxIntentSchema.parse({
          schema: "murph.assistant-outbox-intent.v1",
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

      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-journal-restored-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
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
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION", previousAutomationEnabled);
    }
  });

  it("keeps hosted assistant automation disabled when the worker env opts out explicitly", async () => {
    const previousAutomationEnabled = process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION;
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;

    process.env.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION = "off";
    process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID = "acct_123";
    process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN = "cf-token";
    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_email_disabled",
          },
          eventId: "evt_activation_email_disabled",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-disabled-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "automation.json"), "utf8"),
      ) as { autoReplyChannels: string[] };

      expect(result.result.summary).toContain("kept hosted email auto-reply unchanged");
      expect(automationState.autoReplyChannels).toEqual([]);
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION", previousAutomationEnabled);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID", previousHostedEmailAccountId);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_API_TOKEN", previousHostedEmailApiToken);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
    }
  });

  it("replays committed side effects on resume without rerunning compute or recommitting", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-resume-"));
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
      idempotencyKey: "assistant-outbox:outbox_hosted_resume",
      sentAt,
      target: "chat_123",
      targetKind: "thread" as const,
      messageLength: "Queued the Linq reply.".length,
      providerMessageId: null,
      providerThreadId: null,
    };
    await writeFile(
      path.join(statePaths.outboxDirectory, `${intentId}.json`),
      `${JSON.stringify(assistantOutboxIntentSchema.parse({
        schema: "murph.assistant-outbox-intent.v1",
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
        agentState: encodeHostedBundleBase64(initialSnapshot.agentStateBundle),
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

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-resume-restored-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
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
      expect(JSON.parse(String(finalizeInit?.body))).toMatchObject({
        bundles: result.bundles,
        gatewayProjectionSnapshot: {
          conversations: [],
          generatedAt: expect.any(String),
          messages: [],
          permissions: [],
          schema: "murph.gateway-projection-snapshot.v1",
        },
      });
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", previousCommitTimeout);
    }
  });

  it("prefers per-job forwarded env over ambient process env when deriving the commit timeout", async () => {
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
      await runHostedExecutionJob({
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
          eventId: "evt_commit_forwarded_timeout",
          occurredAt: "2026-03-26T12:10:00.000Z",
        },
        forwardedEnv: {
          HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "5000",
        },
      });

      expect(commitFetch).toHaveBeenCalledTimes(2);
      expect(timeoutSpy).toHaveBeenCalledWith(5_000);
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
