import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOSTED_AI_USAGE_BILLING_MODE_ENV,
  parseHostedAiUsageBillingMode,
  readHostedAiUsageBillingMode,
} from "../src/ai-usage-billing-mode.ts";
import {
  encodeHostedExecutionSignedRequestPayload,
  readHostedExecutionSignatureHeaders,
} from "../src/auth.ts";
import {
  parseHostedBrowserVaultReplicaRef,
} from "../src/browser-vault.ts";
import {
  HOSTED_EXECUTION_EVENT_KINDS,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_WAKE_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
} from "../src/contracts.ts";
import {
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "../src/env.ts";
import {
  parseHostedExecutionSnapshotRef,
} from "../src/parsers.ts";

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

describe("hosted execution coverage gaps", () => {
  it("exposes a browser-vault-only parser surface without runtime-control helpers", () => {
    const ref = {
      byteLength: 128,
      dataVersion: "browser-data-v1",
      generatedAt: "2026-04-27T00:00:00.000Z",
      keyId: "browser-vault-replica:key",
      objectKey: "users/browser-vault-replicas/user/replica.json",
      replicaSchema: "murph.browser-vault-replica.v1",
      runtimeRootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: "sha256:source",
    };

    expect(parseHostedBrowserVaultReplicaRef(ref)).toEqual(ref);
    expect(parseHostedBrowserVaultReplicaRef(null)).toBeNull();
    expect(parseHostedExecutionSnapshotRef(undefined)).toBeNull();
    expect(() => parseHostedBrowserVaultReplicaRef({
      ...ref,
      replicaSchema: "murph.other-replica.v1",
    })).toThrow(/replicaSchema/u);
    expect(() => parseHostedBrowserVaultReplicaRef({
      ...ref,
      schema: "murph.other-browser-vault-replica-ref.v1",
    })).toThrow(
      new RegExp(HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  });

  it("parses hosted AI usage billing mode with a disabled default", () => {
    expect(readHostedAiUsageBillingMode({})).toBe("disabled");
    expect(readHostedAiUsageBillingMode({
      [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "stripe_meter",
    })).toBe("stripe_meter");
    expect(readHostedAiUsageBillingMode({
      [HOSTED_AI_USAGE_BILLING_MODE_ENV]: "usage_allowance",
    })).toBe("disabled");
    expect(() => parseHostedAiUsageBillingMode("usage_allowance")).toThrow(
      /HOSTED_AI_USAGE_BILLING_MODE/u,
    );
  });

  it("reads signature headers and normalizes signed request payloads", () => {
    const headers = new Headers({
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: "sig_123",
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: "2026-04-07T00:00:00.000Z",
      [HOSTED_EXECUTION_NONCE_HEADER]: "nonce_123",
      [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "key_123",
    });

    expect(readHostedExecutionSignatureHeaders(headers)).toEqual({
      keyId: "key_123",
      nonce: "nonce_123",
      signature: "sig_123",
      timestamp: "2026-04-07T00:00:00.000Z",
    });

    expect(
      decodeUtf8(
        encodeHostedExecutionSignedRequestPayload({
          method: " patch ",
          nonce: "  nonce_abc  ",
          path: "internal/hosted-mailbox",
          payload: "{\"ok\":true}",
          search: "limit=10&sort=desc",
          timestamp: "2026-04-07T00:00:00.000Z",
          userId: "  user_123  ",
        }),
      ),
    ).toBe(JSON.stringify([
      "2026-04-07T00:00:00.000Z",
      "PATCH",
      "/internal/hosted-mailbox",
      "?limit=10&sort=desc",
      "user_123",
      "nonce_abc",
      "{\"ok\":true}",
    ]));

    expect(
      decodeUtf8(
        encodeHostedExecutionSignedRequestPayload({
          method: undefined,
          nonce: "   ",
          path: undefined,
          payload: "payload",
          search: "   ",
          timestamp: "2026-04-07T00:00:00.000Z",
          userId: null,
        }),
      ),
    ).toBe(JSON.stringify([
      "2026-04-07T00:00:00.000Z",
      "POST",
      "/",
      "",
      "",
      "",
      "payload",
    ]));
  });

  it("normalizes hosted execution base URLs and string inputs", () => {
    expect(normalizeHostedExecutionString(null)).toBeNull();
    expect(normalizeHostedExecutionString("  ")).toBeNull();
    expect(normalizeHostedExecutionString("  abc  ")).toBe("abc");

    expect(
      normalizeHostedExecutionBaseUrl(" Example.com/root/?q=1#frag "),
    ).toBe("https://example.com/root");

    expect(
      normalizeHostedExecutionBaseUrl(" https://Example.com/root/?q=1#frag "),
    ).toBe("https://example.com/root");

    expect(
      normalizeHostedExecutionBaseUrl("http://LOCALHOST:8787/api/?q=1", {
        allowHttpLocalhost: true,
      }),
    ).toBe("http://localhost:8787/api");

    expect(
      normalizeHostedExecutionBaseUrl("http://[::1]:8787/api/?q=1", {
        allowHttpLocalhost: true,
      }),
    ).toBe("http://[::1]:8787/api");

    expect(
      normalizeHostedExecutionBaseUrl("http://api.example.com/v1/?q=1", {
        allowHttpHosts: ["API.EXAMPLE.COM"],
      }),
    ).toBe("http://api.example.com/v1");
    expect(() => normalizeHostedExecutionBaseUrl("http://example.com")).toThrow(
      /HTTPS unless the host is explicitly allowlisted/i,
    );
    expect(() => normalizeHostedExecutionBaseUrl("https://user:pass@example.com")).toThrow(
      /embedded credentials/i,
    );
  });

  it("exports canonical hosted execution contracts without staged payload helpers", async () => {
    expect(HOSTED_EXECUTION_EVENT_KINDS).toEqual([
      "member.activated",
      "member.channels.updated",
      "assistant.notification.requested",
      "device-sync.wake",
    ]);
    expect(HOSTED_EXECUTION_WAKE_NOT_CONFIGURED_ERROR).toBe(
      "Hosted execution wake handling is not configured.",
    );
    expect(HOSTED_EXECUTION_SIGNATURE_HEADER).toBe("x-hosted-execution-signature");
    expect(HOSTED_EXECUTION_TIMESTAMP_HEADER).toBe("x-hosted-execution-timestamp");
    expect(HOSTED_EXECUTION_NONCE_HEADER).toBe("x-hosted-execution-nonce");
    expect(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER).toBe(
      "x-hosted-execution-signing-key-id",
    );
    expect(HOSTED_EXECUTION_USER_ID_HEADER).toBe("x-hosted-execution-user-id");
    expect(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER).toBe(
      "x-hosted-execution-runner-proxy-token",
    );

    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };

    const exportKeys = Object.keys(packageJson.exports ?? {}).sort();

    expect(exportKeys).toEqual([
      ".",
      "./assistant-identifiers",
      "./auth",
      "./browser-vault",
      "./bundles",
      "./contracts",
      "./env",
      "./hosted-email",
      "./parsers",
      "./routes",
      "./runtime-control",
      "./side-effects",
    ]);
    expect(exportKeys.filter((key) => key.startsWith("./") && key.slice(2).includes("/")))
      .toEqual([]);
    expect(exportKeys).not.toContain("./dispatch-ref");
    expect(exportKeys).not.toContain("./client");
    expect(exportKeys).not.toContain("./outbox-payload");

    const rootModule = await import("@murphai/hosted-execution");
    const browserVaultModule = await import("../src/browser-vault.ts") as Record<string, unknown>;
    const routeModule = await import("@murphai/hosted-execution/routes") as Record<string, unknown>;
    const runtimeControlModule = await import("@murphai/hosted-execution/runtime-control") as Record<
      string,
      unknown
    >;

    expect("createHostedExecutionDispatchClient" in rootModule).toBe(false);
    expect("buildHostedExecutionOutboxPayload" in rootModule).toBe(false);
    expect("buildHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedRuntimeLogRequest" in browserVaultModule).toBe(false);
    expect(typeof browserVaultModule.parseHostedBrowserVaultReplicaRef).toBe("function");
    expect("HOSTED_MAILBOX_LANES" in rootModule).toBe(false);
    expect("parseHostedWorkspaceCheckpointRequest" in rootModule).toBe(false);
    expect(runtimeControlModule.HOSTED_MAILBOX_LANES).toEqual(["system", "conversation"]);
    expect(runtimeControlModule.HOSTED_WORKSPACE_INVOCATION_REASONS).toEqual([
      "nudge",
      "alarm",
      "retry",
      "manual",
    ]);
    expect(runtimeControlModule.HOSTED_WORKSPACE_INVOCATION_STATUSES).toEqual([
      "idle",
      "budget_exhausted",
      "scheduled",
      "failed",
    ]);
    expect("HOSTED_RUN_STATUSES" in runtimeControlModule).toBe(false);
    expect("HOSTED_RUN_TRIGGER_KINDS" in runtimeControlModule).toBe(false);
    expect("HOSTED_RUN_EXECUTOR_KINDS" in runtimeControlModule).toBe(false);
    expect("HOSTED_RUN_LOG_LEVELS" in runtimeControlModule).toBe(false);
    expect("HOSTED_EXECUTION_RUNNER_TURN_INPUT_REFRESH_PATH" in routeModule).toBe(false);
    expect("HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH" in routeModule).toBe(false);
    expect(Object.keys(routeModule).sort()).toEqual([
      "HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH",
      "HOSTED_RUNTIME_CRYPTO_ROOT_PATH",
      "HOSTED_RUNTIME_ISSUE_RECORD_PATH",
      "HOSTED_RUNTIME_LOG_PATH",
      "HOSTED_RUNTIME_MAILBOX_FETCH_PATH",
      "HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH",
      "HOSTED_RUNTIME_STATUS_PATH",
      "HOSTED_RUNTIME_USAGE_RECORD_PATH",
      "HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH",
      "HOSTED_RUNTIME_WORKSPACE_PATH",
    ]);
    expect(routeModule.HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH).toBe(
      "/api/internal/hosted-mailbox/payload/fetch",
    );
    expect(routeModule.HOSTED_RUNTIME_USAGE_RECORD_PATH).toBe(
      "/api/internal/hosted-execution/usage/record",
    );
    expect(routeModule.HOSTED_RUNTIME_ISSUE_RECORD_PATH).toBe(
      "/api/internal/hosted-execution/issues/record",
    );
    expect(routeModule.HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH).toBe(
      "/api/internal/hosted-runtime/crypto-context",
    );
    expect("HOSTED_RUNTIME_SHARE_IMPORT_PATH" in routeModule).toBe(false);
    expect("buildHostedRuntimeSharePayloadPath" in routeModule).toBe(false);
  });
});
