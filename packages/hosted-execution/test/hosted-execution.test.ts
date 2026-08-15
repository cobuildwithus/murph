import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
} from "@murphai/contracts/browser-vault";

import {
  encodeHostedExecutionSignedRequestPayload,
  readHostedExecutionSignatureHeaders,
} from "../src/auth.ts";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  parseHostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaRef,
} from "../src/browser-vault.ts";
import {
  HOSTED_EXECUTION_EVENT_KINDS,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_WAKE_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
} from "../src/contracts.ts";
import {
  buildHostedLocalCodexSubscriptionSeedAuth,
  parseHostedLocalCodexSubscriptionSeedAuth,
} from "../src/hosted-codex-subscription-auth.ts";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
} from "../src/bundles.ts";
import {
  buildHostedComputerRunOperationPath,
  HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH,
  HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
  HOSTED_COMPUTER_RUNS_PATH,
  isHostedComputerWebControlRequest,
  parseHostedComputerActRequest,
  parseHostedComputerFinishRunRequest,
  parseHostedComputerOpenRunRequest,
  parseHostedComputerPauseForUserRequest,
  readHostedComputerRunOperationRoute,
} from "../src/computer-use.ts";
import {
  parseHostedRuntimeProviderSetupContinuationValidateRequest,
  parseHostedRuntimeProviderSetupToolRequest,
} from "../src/provider-setup.ts";
import {
  assessBrowserVaultReplicaFreshness,
  getBrowserVaultReplicaFreshness,
  shouldScheduleBrowserVaultRefresh,
} from "../src/browser-vault.ts";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
  isHostedRuntimeProcessEnv,
  isMurphAndroidAppEnabled,
  MURPH_ANDROID_APP_ENABLED_ENV,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "../src/env.ts";
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  parseHostedExecutionSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "../src/parsers.ts";

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

describe("hosted execution coverage gaps", () => {
  it("normalizes hosted-local Codex subscription auth into external-token seed auth", () => {
    const idToken = buildFakeJwtPayload({ iss: "https://auth.openai.com", sub: "user-1" });
    const seed = buildHostedLocalCodexSubscriptionSeedAuth({
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      last_refresh: "2026-06-11T00:00:00.000Z",
      tokens: {
        access_token: "access-token",
        account_id: "account-id",
        id_token: idToken,
        refresh_token: "host-refresh-token",
      },
    });

    expect(seed).toEqual({
      OPENAI_API_KEY: null,
      auth_mode: "chatgptAuthTokens",
      last_refresh: "2026-06-11T00:00:00.000Z",
      tokens: {
        access_token: "access-token",
        account_id: "account-id",
        id_token: idToken,
        refresh_token: "",
      },
    });
    expect(parseHostedLocalCodexSubscriptionSeedAuth(seed)).toEqual(seed);
    expect(
      parseHostedLocalCodexSubscriptionSeedAuth({
        ...seed,
        last_refresh: "2026-06-11T00:00:00Z",
      }).last_refresh,
    ).toBe("2026-06-11T00:00:00Z");
    expect(() =>
      parseHostedLocalCodexSubscriptionSeedAuth({
        ...seed,
        auth_mode: "chatgpt",
      })
    ).toThrow(/auth_mode/);
    expect(() =>
      parseHostedLocalCodexSubscriptionSeedAuth({
        ...seed,
        tokens: {
          ...seed.tokens,
          account_id: "",
        },
      })
    ).toThrow(/account_id/);
    expect(() =>
      parseHostedLocalCodexSubscriptionSeedAuth({
        ...seed,
        last_refresh: "2026-06-11",
      })
    ).toThrow(/RFC3339/);
    expect(() =>
      parseHostedLocalCodexSubscriptionSeedAuth({
        ...seed,
        tokens: {
          ...seed.tokens,
          id_token: "id-token",
        },
      })
    ).toThrow(/JWT/);
  });

  it("exposes a browser-vault-only parser surface without runtime-control helpers", () => {
    const ref = {
      byteLength: 128,
      dataVersion: "browser-data-v1",
      generatedAt: "2026-04-27T00:00:00.000Z",
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
      keyId: "browser-vault-replica:key",
      objectKey: "users/browser-vault-replicas/user/replica.json",
      replicaSchema: "murph.browser-vault-replica",
      runtimeRootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: "sha256:source",
    } satisfies HostedBrowserVaultReplicaRef;

    expect(parseHostedBrowserVaultReplicaRef(ref)).toEqual(ref);
    expect(getHostedBrowserVaultReplicaStorageKeyId(ref)).toBe(ref.keyId);
    const dataKeyRef = {
      ...ref,
      dataKeyEnvelope: {
        alg: "AES-256-GCM-HKDF-SHA256" as const,
        dataKeyId: "hdk:browser-vault-replica:test",
        domain: "runtime" as const,
        lane: "browser-vault-replica" as const,
        resource: {
          objectKey: ref.objectKey,
          purpose: "browser-vault-replica",
          userId: "user-1",
        },
        rootKeyId: ref.runtimeRootKeyId,
        schema: "murph.hosted-data-key-envelope.v1" as const,
        wraps: [{
          ciphertext: "ciphertext",
          iv: "iv",
          kind: "domain-root" as const,
          rootKeyId: ref.runtimeRootKeyId,
        }],
      },
    } satisfies HostedBrowserVaultReplicaRef;
    expect(parseHostedBrowserVaultReplicaRef(dataKeyRef)).toEqual(dataKeyRef);
    expect(getHostedBrowserVaultReplicaStorageKeyId(dataKeyRef)).toBe(
      dataKeyRef.dataKeyEnvelope.dataKeyId,
    );
    expect(parseHostedBrowserVaultReplicaRef(null)).toBeNull();
    const legacyRef: Record<string, unknown> = { ...ref };
    delete legacyRef.generation;
    expect(parseHostedBrowserVaultReplicaRef(legacyRef)).toEqual(legacyRef);
    expect(() => parseHostedBrowserVaultReplicaRef({
      ...ref,
      generation: 0,
    })).toThrow(/generation must be a positive safe integer/u);
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
    expect(() => parseHostedBrowserVaultReplicaRef({
      ...ref,
      runtimeRootKeyId: undefined,
    })).toThrow(/runtimeRootKeyId/u);
  });

  it("parses latest-hot layered and working snapshot refs without losing old full refs", () => {
    const base = {
      hash: "a".repeat(64),
      key: "cloudflare-workspace-snapshots/base.bundle",
      size: 100,
      updatedAt: "2026-05-04T00:00:00.000Z",
    };
    const hot = {
      hash: "b".repeat(64),
      key: "cloudflare-workspace-hot-state/hot.bundle",
      size: 42,
      updatedAt: "2026-05-04T00:01:00.000Z",
    };
    const delta = {
      hash: "c".repeat(64),
      key: "cloudflare-workspace-deltas/delta.bundle",
      size: 50,
      updatedAt: "2026-05-04T00:02:00.000Z",
    };
    const layered = buildHostedExecutionLayeredSnapshotRef({
      base,
      hot,
    });
    const working = buildHostedExecutionWorkingSnapshotRef({
      base,
      delta,
    });

    expect(layered).toEqual({
      base,
      hot,
      schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
    });
    expect(working).toEqual({
      base,
      delta,
      schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
    });
    expect(parseHostedExecutionSnapshotRef(base)).toEqual(base);
    expect(readHostedExecutionSnapshotBaseRef(parseHostedExecutionSnapshotRef(base))).toEqual(base);
    expect(readHostedExecutionSnapshotHotRef(parseHostedExecutionSnapshotRef(base))).toBeNull();
    expect(readHostedExecutionSnapshotDeltaRef(parseHostedExecutionSnapshotRef(base))).toBeNull();
    expect(parseHostedExecutionSnapshotRef(layered)).toEqual(layered);
    expect(readHostedExecutionSnapshotBaseRef(parseHostedExecutionSnapshotRef(layered))).toEqual(base);
    expect(readHostedExecutionSnapshotHotRef(parseHostedExecutionSnapshotRef(layered))).toEqual(hot);
    expect(readHostedExecutionSnapshotDeltaRef(parseHostedExecutionSnapshotRef(layered))).toBeNull();
    expect(parseHostedExecutionSnapshotRef(working)).toEqual(working);
    expect(readHostedExecutionSnapshotBaseRef(parseHostedExecutionSnapshotRef(working))).toEqual(base);
    expect(readHostedExecutionSnapshotHotRef(parseHostedExecutionSnapshotRef(working))).toBeNull();
    expect(readHostedExecutionSnapshotDeltaRef(parseHostedExecutionSnapshotRef(working))).toEqual(delta);
    expect(parseHostedExecutionSnapshotRef({
      base: null,
      hot: null,
      schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
    })).toEqual({
      base: null,
      hot: null,
      schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
    });
    expect(() => parseHostedExecutionSnapshotRef({
      hot,
      schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
    })).toThrow(/base is required/u);
    expect(() => parseHostedExecutionSnapshotRef({
      base,
      schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
    })).toThrow(/hot is required/u);
    expect(() => parseHostedExecutionSnapshotRef({
      delta,
      schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
    })).toThrow(/base is required/u);
    expect(() => parseHostedExecutionSnapshotRef({
      base,
      schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
    })).toThrow(/delta is required/u);
    expect(() => parseHostedExecutionSnapshotRef({
      base: null,
      delta,
      schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
    })).toThrow(/Hosted execution snapshot ref\.base/u);
  });

  it("centralizes browser-vault replica source hash and refresh decisions", () => {
    expect(BROWSER_VAULT_REPLICA_CURRENT_GENERATION).toBe(8);
    const base = {
      hash: "a".repeat(64),
      key: "cloudflare-workspace-snapshots/base.bundle",
      size: 100,
      updatedAt: "2026-05-04T00:00:00.000Z",
    };
    const delta = {
      hash: "c".repeat(64),
      key: "cloudflare-workspace-deltas/delta.bundle",
      size: 50,
      updatedAt: "2026-05-04T00:02:00.000Z",
    };
    const working = buildHostedExecutionWorkingSnapshotRef({
      base,
      delta,
    });
    const freshReplica = {
      byteLength: 128,
      dataVersion: "browser-data-v1",
      generatedAt: "2026-05-04T00:03:00.000Z",
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
      keyId: "browser-vault-replica:key",
      objectKey: "users/browser-vault-replicas/user/replica.json",
      replicaSchema: "murph.browser-vault-replica",
      runtimeRootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: delta.hash,
    } satisfies HostedBrowserVaultReplicaRef;

    expect(assessBrowserVaultReplicaFreshness({
      currentSourceHash: delta.hash,
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: freshReplica,
    })).toMatchObject({
      freshness: "fresh",
      reason: "current",
      shouldRefresh: false,
    });
    expect(assessBrowserVaultReplicaFreshness({
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: { ...freshReplica, generation: 1 },
    })).toMatchObject({
      freshness: "stale",
      reason: "generation_mismatch",
      shouldRefresh: true,
    });
    expect(assessBrowserVaultReplicaFreshness({
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: { ...freshReplica, generation: undefined },
    })).toMatchObject({
      freshness: "stale",
      reason: "generation_mismatch",
      shouldRefresh: true,
    });
    expect(assessBrowserVaultReplicaFreshness({
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: {
        ...freshReplica,
        generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION + 1,
      },
    })).toMatchObject({
      freshness: "stale",
      reason: "generation_mismatch",
      shouldRefresh: true,
    });
    expect(assessBrowserVaultReplicaFreshness({
      currentSourceHash: base.hash,
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: freshReplica,
    })).toMatchObject({
      freshness: "stale",
      reason: "source_mismatch",
      shouldRefresh: true,
    });
    expect(assessBrowserVaultReplicaFreshness({
      now: "2026-05-06T00:03:30.000Z",
      replicaRef: freshReplica,
    })).toMatchObject({
      freshness: "stale",
      reason: "max_age_exceeded",
      shouldRefresh: true,
    });
    expect(assessBrowserVaultReplicaFreshness({
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: { ...freshReplica, generatedAt: "not-a-date" },
    })).toMatchObject({
      freshness: "stale",
      reason: "invalid_generated_at",
      shouldRefresh: true,
    });
    expect(assessBrowserVaultReplicaFreshness({
      now: "not-a-date",
      replicaRef: freshReplica,
    })).toMatchObject({
      freshness: "stale",
      reason: "invalid_now",
      shouldRefresh: true,
    });
    expect(getBrowserVaultReplicaFreshness({
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: freshReplica,
    })).toBe("fresh");
    expect(getBrowserVaultReplicaFreshness({
      currentSourceHash: delta.hash,
      now: "2026-05-04T00:03:30.000Z",
      replicaRef: { ...freshReplica, sourceBundleHash: base.hash },
    })).toBe("stale");
    expect(shouldScheduleBrowserVaultRefresh({
      currentReplicaRef: null,
    })).toEqual({
      reason: "missing",
      refresh: true,
    });
    expect(shouldScheduleBrowserVaultRefresh({
      currentReplicaRef: freshReplica,
      currentSourceHash: delta.hash,
      now: "2026-05-04T00:03:30.000Z",
    })).toBeNull();
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

  it("exposes stable hosted runtime environment contracts", () => {
    expect(HOSTED_RUNTIME_PROCESS_ENV).toBe("MURPH_HOSTED_RUNTIME_PROCESS");
    expect(HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV).toBe(
      "MURPH_HOSTED_CODEX_APP_SERVER_COMMAND",
    );
    expect(HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV).toBe(
      "MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON",
    );
    expect(MURPH_ANDROID_APP_ENABLED_ENV).toBe("MURPH_ANDROID_APP_ENABLED");
    expect(
      isHostedRuntimeProcessEnv({ [HOSTED_RUNTIME_PROCESS_ENV]: " 1 " }),
    ).toBe(true);
    expect(isHostedRuntimeProcessEnv({ [HOSTED_RUNTIME_PROCESS_ENV]: "0" })).toBe(false);
    expect(isHostedRuntimeProcessEnv({})).toBe(false);
    expect(
      isMurphAndroidAppEnabled({ [MURPH_ANDROID_APP_ENABLED_ENV]: " 1 " }),
    ).toBe(false);
    expect(
      isMurphAndroidAppEnabled({ [MURPH_ANDROID_APP_ENABLED_ENV]: "1" }),
    ).toBe(true);
    expect(
      isMurphAndroidAppEnabled({ [MURPH_ANDROID_APP_ENABLED_ENV]: "true" }),
    ).toBe(false);
    expect(isMurphAndroidAppEnabled({})).toBe(false);
  });

  it("exports canonical hosted execution contracts without staged payload helpers", async () => {
    expect(HOSTED_EXECUTION_EVENT_KINDS).toEqual([
      "member.activated",
      "member.channels.updated",
      "member.preferences.updated",
      "assistant.notification.requested",
      "assistant.ask.requested",
      "assistant.ask.completed",
      "clinical-records.sync-requested",
      "device-sync.wake",
      "runtime.manual-requested",
      "runtime.pending-effects-reconcile-requested",
      "runtime.maintenance-requested",
      "runtime.browser-vault-refresh-requested",
      "runtime.provider-setup-continuation-requested",
      "runtime.codex-auth-requested",
      "runtime.device-sync-recovery-requested",
      "runtime.mailbox-lag-observed",
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

    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };

    const exportKeys = Object.keys(packageJson.exports ?? {}).sort();

    expect(packageJson.dependencies?.zod).toBe("^4.4.3");
    expect(packageJson.devDependencies?.zod).toBeUndefined();
    expect(exportKeys).toEqual([
      ".",
      "./action-approval",
      "./assistant-capabilities",
      "./assistant-identifiers",
      "./assistant-inference",
      "./assistant-model",
      "./assistant-permissions",
      "./assistant-personalization",
      "./assistant-usage",
      "./auth",
      "./browser-vault",
      "./bundles",
      "./clinical-records",
      "./clinical-records-boundary",
      "./computer-use",
      "./connected-apps",
      "./contracts",
      "./dashboard-replica",
      "./env",
      "./hosted-codex-subscription-auth",
      "./hosted-email",
      "./labs",
      "./legacy-dashboard-replica",
      "./orchestration-control",
      "./parsers",
      "./pending-group-setup",
      "./phone-calls",
      "./physical-notes",
      "./plan-usage",
      "./provider-setup",
      "./return-contact",
      "./routes",
      "./runtime-control",
      "./side-effects",
      "./subscription",
      "./temporal-env",
      "./vault-share",
      "./workspace-snapshot-v2",
    ]);
    expect(exportKeys.filter((key) => key.startsWith("./") && key.slice(2).includes("/")))
      .toEqual([]);
    expect(exportKeys).not.toContain("./dispatch-ref");
    expect(exportKeys).not.toContain("./client");
    expect(exportKeys).not.toContain("./outbox-payload");

    const rootModule = await import("@murphai/hosted-execution");
    const assistantCapabilitiesModule =
      await import("@murphai/hosted-execution/assistant-capabilities") as Record<string, unknown>;
    const assistantModelModule =
      await import("@murphai/hosted-execution/assistant-model") as Record<string, unknown>;
    const assistantUsageModule =
      await import("@murphai/hosted-execution/assistant-usage") as Record<string, unknown>;
    const browserVaultModule =
      await import("@murphai/hosted-execution/browser-vault") as Record<string, unknown>;
    const clinicalRecordsModule =
      await import("@murphai/hosted-execution/clinical-records") as Record<string, unknown>;
    const legacyDashboardReplicaModule =
      await import("@murphai/hosted-execution/legacy-dashboard-replica");
    const legacyDashboardReplicaCompatibilityModule =
      await import("@murphai/hosted-execution/dashboard-replica");
    const routeModule = await import("@murphai/hosted-execution/routes") as Record<string, unknown>;
    const labsModule =
      await import("@murphai/hosted-execution/labs") as Record<string, unknown>;
    const subscriptionModule =
      await import("@murphai/hosted-execution/subscription") as Record<string, unknown>;
    const runtimeControlModule = await import("@murphai/hosted-execution/runtime-control") as Record<
      string,
      unknown
    >;
    expect("createHostedExecutionDispatchClient" in rootModule).toBe(false);
    expect("buildHostedExecutionOutboxPayload" in rootModule).toBe(false);
    expect("buildHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    expect(assistantModelModule.HOSTED_ASSISTANT_PRODUCT_MODELS).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
    ]);
    expect("parseHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    expect("HOSTED_ASSISTANT_CAPABILITY_IDS" in rootModule).toBe(false);
    expect("HOSTED_ASSISTANT_CAPABILITY_IDS" in assistantCapabilitiesModule).toBe(false);
    expect("parseHostedClinicalRecordsRunDescriptor" in rootModule).toBe(false);
    expect(clinicalRecordsModule.parseHostedClinicalRecordsRunDescriptor).toBeTypeOf("function");
    expect(assistantCapabilitiesModule.HOSTED_ELEVENLABS_ENV_NAMES).toEqual([
      "ELEVENLABS_API_KEY",
      "MURPH_ELEVENLABS_MODEL_ID",
      "MURPH_ELEVENLABS_VOICE_ID",
    ]);
    expect(rootModule.parseAssistantUsageRecord).toBeTypeOf("function");
    expect(assistantUsageModule.parseAssistantUsageRecord).toBeTypeOf("function");
    expect("parseHostedRuntimeLogRequest" in browserVaultModule).toBe(false);
    expect(typeof browserVaultModule.getHostedBrowserVaultReplicaStorageKeyId).toBe("function");
    expect(typeof browserVaultModule.parseHostedBrowserVaultReplicaRef).toBe("function");
    expect(typeof browserVaultModule.getBrowserVaultReplicaFreshness).toBe("function");
    expect(typeof browserVaultModule.shouldScheduleBrowserVaultRefresh).toBe("function");
    expect(typeof legacyDashboardReplicaModule.getDashboardReplicaFreshness).toBe("function");
    expect(legacyDashboardReplicaModule.getDashboardReplicaFreshness({
      replicaRef: null,
      snapshotRef: null,
    })).toBe("stale");
    expect(legacyDashboardReplicaModule.shouldScheduleDashboardReplicaRefresh({
      currentReplicaRef: null,
      currentSnapshotRef: null,
    })).toBeNull();
    expect(legacyDashboardReplicaModule.readDashboardReplicaSourceStateHash(null)).toBeNull();
    expect(typeof legacyDashboardReplicaCompatibilityModule.getDashboardReplicaFreshness)
      .toBe("function");
    expect("getDashboardReplicaFreshness" in rootModule).toBe(false);
    expect("shouldScheduleDashboardReplicaRefresh" in rootModule).toBe(false);
    expect("HOSTED_MAILBOX_LANES" in rootModule).toBe(false);
    expect("parseHostedWorkspaceCheckpointRequest" in rootModule).toBe(false);
    expect(rootModule.HOSTED_USER_RUNTIME_WORKFLOW_TYPE).toBe("hostedUserRuntimeWorkflow");
    expect(runtimeControlModule.HOSTED_MAILBOX_LANES).toEqual(["system", "conversation"]);
    expect("HOSTED_WORKSPACE_INVOCATION_REASONS" in runtimeControlModule).toBe(false);
    expect(subscriptionModule.parseHostedSubscriptionControlRequest).toBeTypeOf("function");
    expect(subscriptionModule.parseHostedRuntimeSubscriptionToolResponse).toBeTypeOf("function");
    expect(labsModule.parseHostedRuntimeLabsToolRequest).toBeTypeOf("function");
    expect(labsModule.parseHostedRuntimeLabsToolResponse).toBeTypeOf("function");
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
      "HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID",
      "HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH",
      "HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH",
      "HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH",
      "HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH",
      "HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_BODY_MAX_BYTES",
      "HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH",
      "HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH",
      "HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH",
      "HOSTED_RUNTIME_CODEX_AUTH_PATH",
      "HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH",
      "HOSTED_RUNTIME_CRYPTO_ROOT_PATH",
      "HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH",
      "HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH",
      "HOSTED_RUNTIME_GROUP_TOOL_PATH",
      "HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH",
      "HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH",
      "HOSTED_RUNTIME_ISSUE_RECORD_PATH",
      "HOSTED_RUNTIME_LABS_TOOL_PATH",
      "HOSTED_RUNTIME_LATENCY_TRACE_PATH",
      "HOSTED_RUNTIME_LINQ_DELIVERY_BLOCK_CODES",
      "HOSTED_RUNTIME_LINQ_DELIVERY_POSTURES",
      "HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH",
      "HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH",
      "HOSTED_RUNTIME_LOG_PATH",
      "HOSTED_RUNTIME_MAILBOX_FETCH_PATH",
      "HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH",
      "HOSTED_RUNTIME_OWNER_RELEASED_PATH",
      "HOSTED_RUNTIME_OWNER_RELEASE_IMMEDIATE_RECHECK_QUERY",
      "HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH",
      "HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH",
      "HOSTED_RUNTIME_STATUS_PATH",
      "HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH",
      "HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH",
      "HOSTED_RUNTIME_USAGE_RECORD_PATH",
      "HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH",
      "HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH",
      "HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH",
      "HOSTED_RUNTIME_WORKSPACE_PATH",
    ]);
    expect(routeModule.HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH).toBe(
      "/api/internal/hosted-mailbox/payload/fetch",
    );
    expect(routeModule.HOSTED_RUNTIME_USAGE_RECORD_PATH).toBe(
      "/api/internal/hosted-execution/usage/record",
    );
    expect(routeModule.HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH).toBe(
      "/api/internal/hosted-runtime/email-egress/recipient",
    );
    expect(routeModule.HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH).toBe(
      "/api/internal/hosted-execution/assistant-configuration/tool",
    );
    expect(routeModule.HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH).toBe(
      "/api/internal/hosted-execution/subscription/tool",
    );
    expect(routeModule.HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH).toBe(
      "/api/internal/hosted-execution/imessage-contact/tool",
    );
    expect(routeModule.HOSTED_RUNTIME_LABS_TOOL_PATH).toBe(
      "/api/internal/hosted-execution/labs/tool",
    );
    expect(routeModule.HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH).toBe(
      "/api/internal/hosted-runtime/vault-share/active-kinds",
    );
    expect(routeModule.HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH).toBe(
      "/api/internal/hosted-runtime/action-approvals/consume",
    );
    expect(routeModule.HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH).toBe(
      "/api/internal/hosted-runtime/action-approvals/read",
    );
    expect(routeModule.HOSTED_RUNTIME_ISSUE_RECORD_PATH).toBe(
      "/api/internal/hosted-execution/issues/record",
    );
    expect(routeModule.HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH).toBe(
      "/api/internal/device-sync/recovery-sweep",
    );
    expect(routeModule.HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH).toBe(
      "/api/internal/hosted-runtime/crypto-context",
    );
    expect("HOSTED_RUNTIME_SHARE_IMPORT_PATH" in routeModule).toBe(false);
    expect("buildHostedRuntimeSharePayloadPath" in routeModule).toBe(false);
  });

  it("defines hosted computer-use routes and the generic pause checkpoint contract", () => {
    expect(HOSTED_COMPUTER_RUNS_PATH).toBe("/api/internal/computer/runs");

    const pausePath = buildHostedComputerRunOperationPath({
      operation: "pause-for-user",
      runId: "run_abc123",
    });

    expect(pausePath).toBe("/api/internal/computer/runs/run_abc123/pause-for-user");
    expect(readHostedComputerRunOperationRoute(pausePath)).toEqual({
      operation: "pause-for-user",
      runId: "run_abc123",
    });
    expect(isHostedComputerWebControlRequest({
      method: "POST",
      path: HOSTED_COMPUTER_RUNS_PATH,
    })).toBe(true);
    expect(isHostedComputerWebControlRequest({
      method: "POST",
      path: pausePath,
    })).toBe(true);
    expect(isHostedComputerWebControlRequest({
      method: "GET",
      path: pausePath,
    })).toBe(false);
    expect(readHostedComputerRunOperationRoute(
      "/api/internal/computer/runs/run_abc123/observe",
    )).toBe(null);
    expect(isHostedComputerWebControlRequest({
      method: "POST",
      path: "/api/internal/computer/runs/run_abc123/observe",
    })).toBe(false);

    expect(() => parseHostedComputerOpenRunRequest({
      profileKey: "appointments",
      startUrl: "https://example.test/start",
    })).toThrow(TypeError);
    expect(() => parseHostedComputerOpenRunRequest({
      legacyProfileKey: "appointments",
      startUrl: "https://example.test/start",
    })).toThrow(TypeError);
    expect(() => parseHostedComputerOpenRunRequest({
      memberScopedProfileRequired: true,
      startUrl: "https://example.test/start",
    })).toThrow(TypeError);
    expect(() => parseHostedComputerOpenRunRequest({
      resumeRunId: "hcr_paused_run",
      startUrl: "https://example.test/start",
    })).toThrow(TypeError);
    expect(parseHostedComputerOpenRunRequest({
      goal: "Runner goal.",
    })).toEqual({
      resumeAfterMailboxItemId: null,
      resumeDeliveryContext: null,
      runId: null,
      startUrl: null,
    });
    expect(parseHostedComputerOpenRunRequest({
    })).toEqual({
      resumeAfterMailboxItemId: null,
      resumeDeliveryContext: null,
      runId: null,
      startUrl: null,
    });
    expect(parseHostedComputerFinishRunRequest({
      outcome: "failed",
      summary: "Legacy runner summary.",
    })).toEqual({
      outcome: "failed",
    });

    expect(parseHostedComputerActRequest({
      code: "await page.getByRole('button', { name: 'Add to cart' }).click();",
    })).toEqual({
      code: "await page.getByRole('button', { name: 'Add to cart' }).click();",
      timeoutMs: 15000,
    });
    expect(parseHostedComputerActRequest({
      code: "const buttons = page.locator('[data-testid=\"SPC_selectPlaceOrder\"]'); await buttons.last().click(); return { count: await buttons.count() };",
      timeoutMs: HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
    })).toEqual({
      code: "const buttons = page.locator('[data-testid=\"SPC_selectPlaceOrder\"]'); await buttons.last().click(); return { count: await buttons.count() };",
      timeoutMs: HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
    });
    expect(parseHostedComputerActRequest({
      steps: [{
        action: "click",
        target: {
          kind: "selector",
          value: 'button[data-testid="create-app"]',
        },
      }],
    })).toEqual({
      steps: [{
        action: "click",
        target: {
          kind: "selector",
          value: 'button[data-testid="create-app"]',
        },
      }],
      timeoutMs: 15000,
    });
    expect(() => parseHostedComputerActRequest({
      steps: [{
        action: "click",
        target: {
          kind: "selector",
          value: 'body:has(input[value^="secret-prefix"]) button',
        },
      }],
    })).toThrow(/Hosted computer act request is invalid/u);
    expect(() => parseHostedRuntimeProviderSetupToolRequest({
      action: "capture",
      applicationName: "Cobalt Trail 482731",
      applicationNameSelector: 'input[name="name"]',
      clientIdSelector: 'input[value^="secret-prefix"]',
      clientSecretSelector: 'input[name="client_secret"]',
      provider: "strava",
      revealSecretSelector: null,
      runId: "hcr_setup",
      setupId: "dps_setup",
      submitSelector: 'button[type="submit"]',
    })).toThrow();
    expect(() => parseHostedRuntimeProviderSetupToolRequest({
      action: "capture",
      applicationName: "A Member Name 123456",
      applicationNameSelector: 'input[name="name"]',
      clientIdSelector: '[data-client-id]',
      clientSecretSelector: 'input[name="client_secret"]',
      provider: "strava",
      revealSecretSelector: null,
      runId: "hcr_setup",
      setupId: "dps_setup",
      submitSelector: 'button[type="submit"]',
    })).toThrow();
    const deleteRequest = {
      action: "delete",
      confirmSelector: null,
      deleteSelector: "button.delete",
      provider: "strava",
      runId: "hcr_setup",
      setupId: "dps_setup",
    } as const;
    expect(parseHostedRuntimeProviderSetupToolRequest(deleteRequest)).toMatchObject({
      action: "delete",
    });
    expect(() => parseHostedRuntimeProviderSetupToolRequest({
      ...deleteRequest,
      clientIdSelector: "[data-client-id]",
    })).toThrow();
    expect(parseHostedRuntimeProviderSetupContinuationValidateRequest({
      provider: "strava",
      setupId: "dps_setup",
      setupVersion: 2,
    })).toEqual({
      provider: "strava",
      setupId: "dps_setup",
      setupVersion: 2,
    });
    expect(() => parseHostedRuntimeProviderSetupContinuationValidateRequest({
      provider: "strava",
      setupId: "dps_setup",
      setupVersion: 0,
    })).toThrow();
    expect(parseHostedComputerOpenRunRequest({
      startUrl: "about:blank",
    })).toEqual({
      resumeAfterMailboxItemId: null,
      resumeDeliveryContext: null,
      runId: null,
      startUrl: "about:blank",
    });
    expect(parseHostedComputerOpenRunRequest({
      startUrl: "http://127.0.0.1:3000",
    })).toEqual({
      resumeAfterMailboxItemId: null,
      resumeDeliveryContext: null,
      runId: null,
      startUrl: "http://127.0.0.1:3000",
    });
    expect(() => parseHostedComputerActRequest({
      action: "click",
      selector: "button[type=submit]",
    })).toThrow(/Hosted computer act request is invalid/u);
    expect(() => parseHostedComputerActRequest({
      code: "",
    })).toThrow(/Hosted computer act request is invalid/u);
    expect(() => parseHostedComputerActRequest({
      code: "x".repeat(HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH + 1),
    })).toThrow(/Hosted computer act request is invalid/u);
    expect(() => parseHostedComputerActRequest({
      code: "return true;",
      timeoutMs: HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS + 1,
    })).toThrow(/Hosted computer act request is invalid/u);

    expect(parseHostedComputerPauseForUserRequest({
      handoffPurpose: "managed_login",
      reason: "login_needed",
      suggestedReply: "done",
    })).toEqual({
      handoffPurpose: "managed_login",
      pauseDeliveryContext: null,
      reason: "login_needed",
      suggestedReply: "done",
    });
    expect(parseHostedComputerPauseForUserRequest({
      handoffPurpose: "manual_browser_help",
      reason: "final_confirmation",
      suggestedReply: "done",
    })).toEqual({
      handoffPurpose: "manual_browser_help",
      pauseDeliveryContext: null,
      reason: "final_confirmation",
      suggestedReply: "done",
    });
    expect(parseHostedComputerPauseForUserRequest({
      message: "Please log in.",
      reason: "login_needed",
    })).toEqual({
      handoffPurpose: null,
      pauseDeliveryContext: null,
      reason: "login_needed",
      suggestedReply: null,
    });
    expect(() => parseHostedComputerPauseForUserRequest({
      awaitingMessage: "Please log in.",
      reason: "login_needed",
    })).toThrow(/Hosted computer pause-for-user request is invalid/u);
  });
});

function buildFakeJwtPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url"),
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
    "signature",
  ].join(".");
}
