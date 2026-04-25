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
  buildHostedExecutionVaultSyncImportWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_EVENT_KINDS,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  HOSTED_RUN_STATUSES,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_INGRESS_LIFECYCLE_STATES,
  HOSTED_EXECUTION_WAKE_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "../src/contracts.ts";
import {
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "../src/env.ts";
import {
  parseHostedExecutionRunnerVaultSyncImport,
  parseHostedIngressEnvelope,
  parseHostedRuntimeDrainEvent,
  parseHostedRunTurnInputAdoptRequest,
  parseHostedRunTurnInputAdoptResponse,
  parseHostedRunTurnInputPeekRequest,
  parseHostedRunTurnInputPeekResponse,
} from "../src/parsers.ts";

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

describe("hosted execution coverage gaps", () => {
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
          path: "internal/hosted-ingress",
          payload: "{\"ok\":true}",
          search: "limit=10&sort=desc",
          timestamp: "2026-04-07T00:00:00.000Z",
          userId: "  user_123  ",
        }),
      ),
    ).toBe(JSON.stringify([
      "2026-04-07T00:00:00.000Z",
      "PATCH",
      "/internal/hosted-ingress",
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
      "vault.share.accepted",
      "vault.sync.import",
    ]);
    expect(HOSTED_INGRESS_LIFECYCLE_STATES).toEqual([
      "queued",
      "backpressured",
      "completed",
      "replaced",
      "quarantined",
    ]);
    expect(HOSTED_RUN_STATUSES).toEqual([
      "acquired",
      "running",
      "finalizing",
      "committed_needs_finalize",
      "finalized",
      "failed",
      "superseded",
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

    expect(Object.keys(packageJson.exports ?? {}).sort()).not.toContain("./dispatch-ref");
    expect(Object.keys(packageJson.exports ?? {}).sort()).not.toContain("./client");
    expect(Object.keys(packageJson.exports ?? {}).sort()).not.toContain("./outbox-payload");

    const rootModule = await import("@murphai/hosted-execution");
    const routeModule = await import("@murphai/hosted-execution/routes") as Record<string, unknown>;

    expect("createHostedExecutionDispatchClient" in rootModule).toBe(false);
    expect("buildHostedExecutionOutboxPayload" in rootModule).toBe(false);
    expect("buildHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    expect(Object.keys(routeModule).sort()).toEqual([
      "HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH",
      "HOSTED_EXECUTION_RUNNER_MESSAGING_ACTIVITY_STOP_PATH",
      "HOSTED_EXECUTION_RUNNER_TURN_INPUT_REFRESH_PATH",
    ]);
  });

  it("parses hosted run turn-input peek and adopt contracts", () => {
    const event = {
      behavior: "ordered",
      createdAt: "2026-04-23T00:00:00.000Z",
      id: "wake_11",
      kind: "conversation.message",
      occurredAt: "2026-04-23T00:00:00.000Z",
      payloadCiphertext: "ciphertext",
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      seq: "11",
      updatedAt: "2026-04-23T00:00:00.000Z",
      userId: "member_123",
    };

    expect(parseHostedRunTurnInputPeekRequest({
      afterSeq: "10",
      limit: 2,
      runId: "run_123",
      runToken: "run-token",
    })).toEqual({
      afterSeq: "10",
      limit: 2,
      runId: "run_123",
      runToken: "run-token",
    });
    expect(parseHostedRunTurnInputPeekResponse({
      events: [event],
      run: null,
    })).toEqual({
      events: [event],
      run: null,
    });
    expect(parseHostedRunTurnInputAdoptRequest({
      ingressEventIds: ["wake_11"],
      runId: "run_123",
      runToken: "run-token",
    })).toEqual({
      ingressEventIds: ["wake_11"],
      runId: "run_123",
      runToken: "run-token",
    });
    expect(parseHostedRunTurnInputAdoptResponse({
      adopted: true,
      events: [event],
      run: null,
    })).toEqual({
      adopted: true,
      events: [event],
      run: null,
    });

    expect(() => parseHostedRunTurnInputPeekRequest({
      afterSeq: "not-a-seq",
      runId: "run_123",
      runToken: "run-token",
    })).toThrow(/base-10 integer string/iu);
  });

  it("builds and parses hosted vault sync import side-input contracts", () => {
    const wake = buildHostedExecutionVaultSyncImportWake({
      eventId: "evt_vault_sync",
      memberId: "member_vault_sync",
      occurredAt: "2026-04-21T00:00:00.000Z",
      vaultSync: {
        localManifestHash: "sha256:local",
        sessionId: "vsi_contract",
        sourceSchemaVersion: "murph.vault.v1",
        sourceVaultId: "vault_local",
        sourceVaultTitle: "Local Vault",
      },
    });

    expect(parseHostedIngressEnvelope(wake)).toEqual(wake);
    expect(
      buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync_minimal",
        memberId: "member_vault_sync",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:minimal",
          sessionId: "vsi_minimal",
        },
      }),
    ).toEqual({
      eventId: "evt_vault_sync_minimal",
      kind: "vault.sync.import",
      occurredAt: "2026-04-21T00:00:00.000Z",
      userId: "member_vault_sync",
      vaultSync: {
        localManifestHash: "sha256:minimal",
        sessionId: "vsi_minimal",
      },
    });

    const runnerPayload = {
      bundleBase64: "AAAA",
      sessionId: "vsi_contract",
      sourceSchemaVersion: "murph.vault.v1",
    };
    expect(parseHostedExecutionRunnerVaultSyncImport(runnerPayload)).toEqual(runnerPayload);
    expect(parseHostedRuntimeDrainEvent({
      ingressEventId: "ingress_vault_sync",
      seq: "12",
      vaultSyncImport: runnerPayload,
      wake,
    })).toEqual({
      ingressEventId: "ingress_vault_sync",
      seq: "12",
      vaultSyncImport: runnerPayload,
      wake,
    });

    expect(() => parseHostedRuntimeDrainEvent({
      seq: "12",
      vaultSyncImport: runnerPayload,
      wake,
      wakeId: "ingress_vault_sync",
    })).toThrow(/ingressEventId/u);
    expect(() => parseHostedRuntimeDrainEvent({
      ingressEventId: "ingress_vault_sync",
      seq: "12",
      vaultSyncImport: runnerPayload,
      wake,
      wakeId: "ingress_vault_sync",
    })).toThrow(/wakeId/u);
  });
});
