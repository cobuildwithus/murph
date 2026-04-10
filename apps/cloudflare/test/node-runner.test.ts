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
  restoreHostedExecutionContext as restoreHostedExecutionContextActual,
  snapshotHostedExecutionContext as snapshotHostedExecutionContextActual,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";
import { assistantOutboxIntentSchema } from "@murphai/operator-config/assistant-cli-contracts";
import { HOSTED_ASSISTANT_CONFIG_ENV_NAMES } from "@murphai/operator-config/hosted-assistant-config";
import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import type { HostedExecutionBundlePayload } from "@murphai/hosted-execution";

const hostedCliMocks = vi.hoisted(() => ({
  dispatchAssistantOutboxIntent: vi.fn(),
  runAssistantAutomation: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
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
  buildHostedExecutionJobRuntimeForTests,
  runHostedExecutionJob as runHostedExecutionJobInternal,
  setHostedExecutionIsolatedRunnerForTests,
  setHostedExecutionRunModeForTests,
  setHostedExecutionRunStartHookForTests,
} from "../src/node-runner.ts";

const describe = baseDescribe.sequential;
const initialGlobalFetch = global.fetch;
const HOSTED_DEVICE_SYNC_ENV_PREFIXES = [
  "DEVICE_SYNC_",
  "GARMIN_",
  "OURA_",
  "WHOOP_",
] as const;

type NodeRunnerTestInput =
  Pick<
    HostedAssistantRuntimeConfig,
    "forwardedEnv" | "userEnv"
  > & {
    internalWorkerProxyToken?: string | null;
    bundles:
      | HostedAssistantRuntimeJobInput["request"]["bundle"]
      | {
        agentState: HostedExecutionBundlePayload;
        vault: HostedExecutionBundlePayload;
      };
    commit?: {
      bundleRef?: NonNullable<HostedAssistantRuntimeJobInput["request"]["commit"]>["bundleRef"] | null;
      bundleRefs?: {
        agentState: null;
        vault: NonNullable<HostedAssistantRuntimeJobInput["request"]["commit"]>["bundleRef"] | null;
      };
    };
  } & Omit<HostedAssistantRuntimeJobInput["request"], "bundle" | "commit">;

async function snapshotHostedExecutionContext(
  input: Parameters<typeof snapshotHostedExecutionContextActual>[0],
) {
  const snapshot = await snapshotHostedExecutionContextActual(input);

  return {
    agentStateBundle: snapshot.bundle,
    bundle: snapshot.bundle,
    vaultBundle: snapshot.bundle,
  };
}

async function restoreHostedExecutionContext(input: {
  agentStateBundle?: ArrayBuffer | Uint8Array | null;
  artifactResolver?: Parameters<typeof restoreHostedExecutionContextActual>[0]["artifactResolver"];
  bundle?: ArrayBuffer | Uint8Array | null;
  shouldRestoreArtifact?: Parameters<typeof restoreHostedExecutionContextActual>[0]["shouldRestoreArtifact"];
  vaultBundle?: ArrayBuffer | Uint8Array | null;
  workspaceRoot: string;
}) {
  return restoreHostedExecutionContextActual({
    ...(input.artifactResolver ? { artifactResolver: input.artifactResolver } : {}),
    bundle: input.bundle ?? input.vaultBundle ?? input.agentStateBundle ?? null,
    ...(input.shouldRestoreArtifact ? { shouldRestoreArtifact: input.shouldRestoreArtifact } : {}),
    workspaceRoot: input.workspaceRoot,
  });
}

async function readAssistantAutomationState(assistantStateRoot: string): Promise<{
  autoReplyChannels: string[];
}> {
  try {
    return JSON.parse(
      await readFile(path.join(assistantStateRoot, "automation.json"), "utf8"),
    ) as { autoReplyChannels: string[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        autoReplyChannels: [],
      };
    }

    throw error;
  }
}

async function runHostedExecutionJob(
  input: NodeRunnerTestInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<{
  finalGatewayProjectionSnapshot: HostedAssistantRuntimeJobResult["finalGatewayProjectionSnapshot"];
  bundles: {
    agentState: HostedExecutionBundlePayload;
    vault: HostedExecutionBundlePayload;
  };
  gatewayProjectionSnapshot: HostedAssistantRuntimeJobResult["finalGatewayProjectionSnapshot"];
  result: HostedAssistantRuntimeJobResult["result"]["result"];
  runnerResult: HostedAssistantRuntimeJobResult["result"];
}> {
  const {
    bundles,
    commit,
    forwardedEnv,
    internalWorkerProxyToken,
    userEnv,
    ...request
  } = input;
  const runtime: HostedAssistantRuntimeConfig = {
    ...(forwardedEnv === undefined ? {} : { forwardedEnv }),
    ...(userEnv === undefined ? {} : { userEnv }),
  };

  const result = await runHostedExecutionJobInternal({
    request: {
      ...request,
      bundle:
        bundles === null || typeof bundles === "string"
          ? bundles
          : (bundles.vault ?? bundles.agentState),
      ...(commit === undefined ? {} : {
        commit: {
          bundleRef: commit.bundleRef ?? commit.bundleRefs?.vault ?? null,
        },
      }),
    },
    ...(Object.keys(runtime).length === 0 ? {} : { runtime }),
  }, {
    ...(internalWorkerProxyToken === undefined ? {} : { internalWorkerProxyToken }),
    ...options,
  });

  return {
    finalGatewayProjectionSnapshot: result.finalGatewayProjectionSnapshot,
    bundles: {
      agentState: result.result.bundle,
      vault: result.result.bundle,
    },
    gatewayProjectionSnapshot: result.finalGatewayProjectionSnapshot,
    result: result.result.result,
    runnerResult: result.result,
  };
}

function installHostedFetchBaseUrlProxy(input: {
  artifactsBaseUrl?: string;
  resultsBaseUrl?: string;
}): () => void {
  const previousFetch = global.fetch;
  const delegateFetch = previousFetch ?? fetch;
  const baseUrlByHost = new Map<string, string>();

  if (input.artifactsBaseUrl) {
    baseUrlByHost.set("artifacts.worker", input.artifactsBaseUrl);
  }
  if (input.resultsBaseUrl) {
    baseUrlByHost.set("results.worker", input.resultsBaseUrl);
  }

  global.fetch = async (requestInput, init) => {
    const request = requestInput instanceof Request ? requestInput : new Request(requestInput, init);
    const url = new URL(request.url);
    const overrideBaseUrl = baseUrlByHost.get(url.host);

    if (!overrideBaseUrl) {
      return await delegateFetch(request);
    }

    const proxiedUrl = new URL(`${url.pathname}${url.search}`, overrideBaseUrl);
    return await delegateFetch(new Request(proxiedUrl.toString(), request));
  };

  return () => {
    if (previousFetch) {
      global.fetch = previousFetch;
      return;
    }

    delete (globalThis as { fetch?: typeof fetch }).fetch;
  };
}

describe("runHostedExecutionJob", () => {
  const cleanupPaths: string[] = [];
  let previousHostedDeviceSyncEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    vi.restoreAllMocks();
    setHostedExecutionIsolatedRunnerForTests(null);
    setHostedExecutionRunModeForTests("in-process");
    previousHostedDeviceSyncEnv = captureEnvVarsWithPrefixes(HOSTED_DEVICE_SYNC_ENV_PREFIXES);
    for (const key of Object.keys(previousHostedDeviceSyncEnv)) {
      restoreEnvVar(key, undefined);
    }
    const actualAssistantCore = await vi.importActual<typeof import("@murphai/assistant-engine")>(
      "@murphai/assistant-engine",
    );
    hostedCliMocks.dispatchAssistantOutboxIntent.mockImplementation((input) =>
      actualAssistantCore.dispatchAssistantOutboxIntent(input));
    hostedCliMocks.runAssistantAutomation.mockImplementation((input) =>
      actualAssistantCore.runAssistantAutomation(input));
  });

  afterEach(async () => {
    setHostedExecutionIsolatedRunnerForTests(null);
    setHostedExecutionRunModeForTests(null);
    setHostedExecutionRunStartHookForTests(null);
    restoreEnvVars(previousHostedDeviceSyncEnv);
    if (initialGlobalFetch) {
      global.fetch = initialGlobalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { force: true, recursive: true })));
  });

  it("bootstraps a new hosted member context only during activation and records the result explicitly", async () => {
    const previousHostedAssistantEnv = clearHostedAssistantSeedEnv();

    try {
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
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toContain("Processed member activation");
      expect(result.result.summary).toContain("created the canonical vault");
      expect(result.result.summary).toContain("hosted assistant config missing");
      expect(result.result.summary).toContain("hosted email auto-reply unavailable");
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
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("reuses the existing hosted member bootstrap on repeated activation", async () => {
    const previousHostedAssistantEnv = clearHostedAssistantSeedEnv();

    try {
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
      expect(secondActivation.result.summary).toContain("hosted assistant config missing");
      expect(secondActivation.result.summary).toContain("hosted email auto-reply unavailable");
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });


  it("does not bootstrap hosted email auto-reply when ingress is configured but send credentials are missing", async () => {
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

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
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toContain("seeded explicit hosted assistant config (openai-compatible)");
      expect(result.result.summary).toContain("hosted email auto-reply unavailable");
      expect(automationState.autoReplyChannels).not.toContain("email");
    } finally {
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
      restoreEnvVars(previousHostedAssistantEnv);
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
          kind: "telegram.message.received",
          telegramMessage: {
            messageId: "1",
            schema: "murph.hosted-telegram-message.v1",
            text: "hello from Telegram",
            threadId: "123",
          },
          userId: "member_telegram_ingress",
        },
        eventId: "evt_telegram_ingress",
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
      expect(capture?.actor.id).toBeNull();
      expect(capture?.actor.displayName).toBeNull();
      expect(capture?.text).toBe("hello from Telegram");
      expect(capture?.thread.title).toBeNull();
      expect(capture?.thread.isDirect).toBe(true);
      expect(capture?.thread.id).toBe("123");
      expect(capture?.externalId).toBe("evt_telegram_ingress");
      expect(capture?.raw).toEqual({
        message_id: "1",
        schema: "murph.telegram-capture.v1",
      });
    } finally {
      runtime.close();
    }
  });

  it("bootstraps hosted email auto-reply when the hosted email bridge is configured", async () => {
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

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
      expect(result.result.summary).toContain("seeded explicit hosted assistant config (openai-compatible)");
      expect(result.result.summary).toContain("hosted email auto-reply ready");
    } finally {
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID", previousHostedEmailAccountId);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_API_TOKEN", previousHostedEmailApiToken);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("does not bootstrap hosted email auto-reply when sender credentials exist without a hosted email domain", async () => {
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailFromAddress = process.env.HOSTED_EMAIL_FROM_ADDRESS;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

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
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toContain("seeded explicit hosted assistant config (openai-compatible)");
      expect(result.result.summary).toContain("hosted email auto-reply unavailable");
      expect(automationState.autoReplyChannels).not.toContain("email");
    } finally {
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID", previousHostedEmailAccountId);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_API_TOKEN", previousHostedEmailApiToken);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_FROM_ADDRESS", previousHostedEmailFromAddress);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("does not enable hosted auto-reply on non-activation events after bootstrap", async () => {
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousHostedAssistantEnv = clearHostedAssistantSeedEnv();

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
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toContain("Processed assistant cron tick");
      expect(automationState.autoReplyChannels).not.toContain("email");
      await expect(
        readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
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
      const restoreFetch = installHostedFetchBaseUrlProxy({
        resultsBaseUrl: `http://127.0.0.1:${address.port}`,
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
      restoreFetch();
    } finally {
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
      const restoreFetch = installHostedFetchBaseUrlProxy({
        resultsBaseUrl: `http://127.0.0.1:${address.port}`,
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
        restoreFetch();
      } finally {
        runtime.close();
      }
    } finally {
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
          kind: "telegram.message.received",
          telegramMessage: {
            messageId: "789",
            schema: "murph.hosted-telegram-message.v1",
            text: "Hello from hosted Telegram.",
            threadId: "456",
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
      expect(capture?.externalId).toBe("evt_telegram");
      expect(capture?.text).toBe("Hello from hosted Telegram.");
      expect(capture?.actor.id).toBeNull();
      expect(capture?.thread.title).toBeNull();
      expect(capture?.raw).toEqual({
        message_id: "789",
        schema: "murph.telegram-capture.v1",
      });
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

          return new Response(Buffer.from(storedBytes), {
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
            kind: "telegram.message.received",
            telegramMessage: {
              attachments: [
                {
                  fileId: "file_123",
                  fileSize: attachmentBytes.byteLength,
                  fileUniqueId: "photo_unique_123",
                  height: 20,
                  kind: "photo",
                  width: 20,
                },
              ],
              messageId: "790",
              schema: "murph.hosted-telegram-message.v1",
              text: "Photo from hosted Telegram.",
              threadId: "456",
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
      const telegramFetchUrls = telegramFetchCalls.map(([url]) => String(url));
      const telegramGetFileUrl =
        "https://telegram-api.example.test/bottelegram-token/getFile?file_id=file_123";
      const telegramFileDownloadUrl =
        "https://telegram-files.example.test/bottelegram-token/photos/file_123.jpg";
      expect(telegramFetchUrls.filter((url) => url === telegramGetFileUrl)).toHaveLength(1);
      expect(telegramFetchUrls.filter((url) => url === telegramFileDownloadUrl)).toHaveLength(1);
      expect(telegramFetchUrls.indexOf(telegramGetFileUrl)).toBeLessThan(
        telegramFetchUrls.indexOf(telegramFileDownloadUrl),
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
      const restoreFetch = installHostedFetchBaseUrlProxy({
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
      restoreFetch();
    } finally {
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
      const restoreFetch = installHostedFetchBaseUrlProxy({
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
        `Hosted runner artifact fetch failed for ${artifactHash}.`,
      );
      restoreFetch();
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("imports a hosted share from the inline dispatch pack", async () => {
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
          share: {
            ownerUserId: "member_sender",
            shareId: "share_123",
          },
          userId: "member_456",
        },
        eventId: "evt_share_123",
        occurredAt: "2026-03-26T12:30:00.000Z",
      },
      sharePack: {
        ownerUserId: "member_sender",
        pack,
        shareId: "share_123",
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

    expect(importedFood).toBeDefined();
    expect(result.result.summary).toContain(`Imported share pack "${pack.title}"`);
  });

  it("ignores hosted web env when importing a runner-hydrated share pack", async () => {
    const previousHostedWebBaseUrl = process.env.HOSTED_WEB_BASE_URL;
    process.env.HOSTED_WEB_BASE_URL = "https://join.example.test";

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
    const fetchSpy = vi.fn(async () => {
      throw new Error("Inline share imports should not fetch through the removed share proxy route.");
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
              ownerUserId: "member_sender",
              shareId: "share_proxy_123",
            },
            userId: "member_proxy",
          },
          eventId: "evt_share_proxy_123",
          occurredAt: "2026-03-26T12:30:00.000Z",
        },
        sharePack: {
          ownerUserId: "member_sender",
          pack,
          shareId: "share_proxy_123",
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

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(importedFood).toBeDefined();
      expect(importedFood?.attachedProtocolIds?.length).toBe(1);
      expect(result.result.summary).toContain(`Imported share pack "${pack.title}"`);
    } finally {
      restoreEnvVar("HOSTED_WEB_BASE_URL", previousHostedWebBaseUrl);
      vi.stubGlobal("fetch", initialGlobalFetch);
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
    ).rejects.toThrow("Hosted assistant runtime child did not emit a result payload.");
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
    const previousHostedWebBaseUrl = process.env.HOSTED_WEB_BASE_URL;
    delete process.env.HOSTED_WEB_BASE_URL;

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

      const [usageUrl, usageRequest] = fetchSpy.mock.calls[0] ?? [];
      expect(String(usageUrl)).toBe("http://usage.worker/api/internal/hosted-execution/usage/record");
      expect((usageRequest as RequestInit | undefined)?.method).toBe("POST");
      expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("application/json; charset=utf-8");
      const usageRequestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(typeof usageRequestInit?.body).toBe("string");
      expect(String(usageRequestInit?.body)).toContain("\"usageId\":\"turn_usage_proxy.attempt-1\"");
      await expect(listPendingAssistantUsageRecords({
        vault: restored.vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      restoreEnvVar("HOSTED_WEB_BASE_URL", previousHostedWebBaseUrl);
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
    const seenApiKeys = new Map<string, string | undefined>();
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
    setHostedExecutionIsolatedRunnerForTests(async (input) => {
      const userId = input.job.request.dispatch.event.userId;
      const runtime = input.job.runtime ?? {};
      seenApiKeys.set(userId, runtime.userEnv?.CUSTOM_API_KEY);
      const commitBaseUrl = runtime.forwardedEnv?.HOSTED_EXECUTION_TEST_COMMIT_BASE_URL;

      if (typeof commitBaseUrl !== "string") {
        throw new Error("Expected the isolated test runner to receive the commit callback base URL.");
      }

      const response = await fetch(`${commitBaseUrl}/commit`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Expected the isolated test commit callback to succeed, got HTTP ${response.status}.`);
      }

      return {
        finalGatewayProjectionSnapshot: null,
        result: {
          bundle: null,
          result: {
            eventsHandled: 1,
            summary: `ok:${userId}`,
          },
        },
      };
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
        forwardedEnv: {
          HOSTED_EXECUTION_TEST_COMMIT_BASE_URL: `http://127.0.0.1:${address.port}`,
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
        forwardedEnv: {
          HOSTED_EXECUTION_TEST_COMMIT_BASE_URL: `http://127.0.0.1:${address.port}`,
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
      expect(seenApiKeys).toEqual(new Map([
        ["member_1", "user-one-key"],
        ["member_2", "user-two-key"],
      ]));
    } finally {
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

        if (String(url).startsWith("http://results.worker/events/")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (
          String(url).startsWith(
            "http://results.worker/effects/",
          )
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: {
              delivery: {
                channel: "linq",
                idempotencyKey: `assistant-outbox:${intentId}`,
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
              state: "sent",
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
      "POST http://results.worker/events/evt_outbox/commit",
      "GET http://results.worker/effects/outbox_hosted_reconcile?fingerprint=dedupe_hosted",
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
    expect(savedIntent.status).toBe("sent");
    expect(savedIntent.delivery?.target).toBe("chat_123");
  });

  it("journals hosted assistant deliveries after the durable commit before finalizing returned bundles", async () => {
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-journal-"));
    cleanupPaths.push(parent);
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
          === "http://results.worker/events/evt_outbox_send/commit"
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
          === "http://results.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send"
          && (init?.method ?? "GET") === "GET"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: null,
          }), { status: 200 });
        }

        if (
          String(url)
          === "http://results.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send"
          && init?.method === "PUT"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: JSON.parse(String(init?.body)),
          }), { status: 200 });
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
        "POST http://results.worker/events/evt_outbox_send/commit",
        "GET http://results.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send",
        "PUT http://results.worker/effects/outbox_hosted_send?fingerprint=dedupe_hosted_send",
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
      expect(savedIntent.status).toBe("sent");
      expect(savedIntent.delivery).toEqual(delivery);
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
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
          === "http://results.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume"
          && (init?.method ?? "GET") === "GET"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: null,
          }), { status: 200 });
        }

        if (
          String(url)
          === "http://results.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume"
          && init?.method === "PUT"
        ) {
          return new Response(JSON.stringify({
            effectId: intentId,
            record: JSON.parse(String(init?.body)),
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
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_outbox_resume",
        occurredAt: "2026-03-26T12:00:00.000Z",
      },
      resume: {
        committedResult: {
          assistantDeliveryEffects: [
            {
              effectId: intentId,
              fingerprint: "dedupe_hosted_resume",
              intentId,
              kind: "assistant.delivery",
            },
          ],
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
      "GET http://results.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume",
      "PUT http://results.worker/effects/outbox_hosted_resume?fingerprint=dedupe_hosted_resume",
    ]);
    expect(fetchCalls).not.toContain("POST http://results.worker/events/evt_outbox_resume/commit");
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
    expect(savedIntent.status).toBe("sent");
    expect(savedIntent.delivery).toEqual(delivery);
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

      expect(commitFetch).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(15_000);
      const [commitUrl, commitInit] = commitFetch.mock.calls[0] ?? [];
      expect(String(commitUrl)).toBe(
        "http://results.worker/events/evt_commit/commit",
      );
      expect(commitInit?.headers).toMatchObject({
        "content-type": "application/json; charset=utf-8",
      });
      expect(JSON.parse(String(commitInit?.body))).toMatchObject({
        currentBundleRef: null,
        result: result.result,
        bundle: result.bundles.vault,
      });
      expect(result.gatewayProjectionSnapshot).toMatchObject({
        conversations: [],
        generatedAt: expect.any(String),
        messages: [],
        permissions: [],
        schema: "murph.gateway-projection-snapshot.v1",
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

      expect(commitFetch).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", previousCommitTimeout);
    }
  });

  it("keeps worker-only runtime overrides out of forwarded child env while still applying them", () => {
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS;
    const previousCommitTimeout = process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS;
    process.env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = "OPENAI_API_KEY";
    process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS = "15000";

    try {
      const runtime = buildHostedExecutionJobRuntimeForTests({
        forwardedEnv: {
          HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "CUSTOM_API_KEY",
          HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "5000",
          OPENAI_API_KEY: "sk-worker",
        },
        userEnv: {
          CUSTOM_API_KEY: "custom-user",
          OPENAI_API_KEY: "sk-user",
        },
      });

      expect(runtime.commitTimeoutMs).toBe(5_000);
      expect(runtime.forwardedEnv).toMatchObject({
        OPENAI_API_KEY: "sk-worker",
      });
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
      );
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
      );
      expect(runtime.userEnv).toMatchObject({
        CUSTOM_API_KEY: "custom-user",
      });
      expect(runtime.resolvedConfig).toEqual({
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      });
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS", previousAllowedUserEnvKeys);
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", previousCommitTimeout);
    }
  });

  it("derives explicit runtime capabilities from the forwarded runner env", () => {
    const runtime = buildHostedExecutionJobRuntimeForTests({
      forwardedEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "secret_123",
        HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
        HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        WHOOP_CLIENT_ID: "whoop-client",
        WHOOP_CLIENT_SECRET: "whoop-secret",
      },
    });

    expect(runtime.resolvedConfig).toMatchObject({
      channelCapabilities: {
        emailSendReady: true,
        telegramBotConfigured: true,
      },
      deviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "whoop-client",
            clientSecret: "whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
    });
  });

  it("recomputes hosted email readiness from ambient env plus per-job overrides instead of keeping synthetic false defaults", () => {
    const previousHostedEmailAccountId = process.env.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID;
    const previousHostedEmailApiToken = process.env.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN;
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;

    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const runtime = buildHostedExecutionJobRuntimeForTests({
        forwardedEnv: {
          HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
          HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
          HOSTED_EMAIL_INGRESS_READY: "false",
          HOSTED_EMAIL_SEND_READY: "false",
        },
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: false,
            telegramBotConfigured: false,
          },
          deviceSync: null,
        },
      });

      expect(runtime.forwardedEnv).toMatchObject({
        HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
        HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_SEND_READY: "true",
      });
      expect(runtime.resolvedConfig).toEqual({
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      });
    } finally {
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID", previousHostedEmailAccountId);
      restoreEnvVar("HOSTED_EMAIL_CLOUDFLARE_API_TOKEN", previousHostedEmailApiToken);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
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
        "Hosted runner durable commit failed for member_123/evt_commit.",
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

function setHostedAssistantSeedEnv(): Record<string, string | undefined> {
  const previousEnv = captureEnvVars(HOSTED_ASSISTANT_CONFIG_ENV_NAMES);
  process.env.HOSTED_ASSISTANT_MODEL = "gpt-4.1-mini";
  process.env.HOSTED_ASSISTANT_PROVIDER = "openai";
  return previousEnv;
}

function clearHostedAssistantSeedEnv(): Record<string, string | undefined> {
  const previousEnv = captureEnvVars(HOSTED_ASSISTANT_CONFIG_ENV_NAMES);
  for (const key of HOSTED_ASSISTANT_CONFIG_ENV_NAMES) {
    restoreEnvVar(key, undefined);
  }
  return previousEnv;
}

function captureEnvVars(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function captureEnvVarsWithPrefixes(prefixes: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .map((key) => [key, process.env[key]]),
  );
}

function restoreEnvVars(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    restoreEnvVar(key, value);
  }
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
