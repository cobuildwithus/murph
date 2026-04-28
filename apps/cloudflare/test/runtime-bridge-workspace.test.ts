import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";

import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "../src/runtime-bridge-workspace.ts";

const cleanupPaths: string[] = [];
const HOSTED_MAILBOX_SCOPE_SALT = new TextEncoder().encode("murph.hosted.device-sync.secret.v1");
const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
});

describe("createHostedWorkspaceRuntimeBridgeJobOptions", () => {
  it("writes local workspace snapshots through the artifact store", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput());

    expect(result.snapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      key: expect.stringMatching(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u),
      size: expect.any(Number),
    }));
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: result.snapshotRef!.hash,
    }));
  });

  it("lets web CAS own workspace version conflicts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "6",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput());

    expect(result.snapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(putArtifact).toHaveBeenCalled();
  });

  it("queues vault-sync mailbox imports for the runtime after the import checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const key = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
    const occurredAt = "2026-04-21T00:00:00.000Z";
    const wake = buildHostedExecutionVaultSyncImportWake({
      eventId: "vault-sync.import:vsi_runtime",
      memberId: "member_123",
      occurredAt,
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: "murph.vault.v1",
      },
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: vi.fn(async () => {}) }),
      readEncryptionEnvironment: () => ({
        key,
        keyVersion: "v1",
        keysByVersion: {
          v1: key,
        },
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_123",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });
    const payloadCiphertext = await encryptHostedMailboxPayload({
      key,
      userId: "member_123",
      value: wake,
    });

    const result = await options.importItem({
      item: {
        createdAt: occurredAt,
        dedupeKey: wake.eventId,
        expiresAt: null,
        id: "mailbox_item_1",
        kind: "vault.sync.import",
        lane: "system",
        laneSeq: "1",
        occurredAt,
        payloadBytes: payloadCiphertext.length,
        payloadInlineCiphertext: payloadCiphertext,
        payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1",
        updatedAt: occurredAt,
        userId: "member_123",
      },
      payload: {
        payloadCiphertext,
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        requestId: null,
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "import-vault-sync",
        advanceProgress: true,
        itemRef: {
          id: "mailbox_item_1",
          kind: "vault.sync.import",
          lane: "system",
          laneSeq: "1",
        },
        state: "route",
      },
    });

    expect(result).toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });
  });

  it("reads mailbox encryption from runtime platform env instead of process env", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const key = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
    const wrongProcessKey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 101));
    vi.stubEnv("HOSTED_WAKE_ENCRYPTION_KEY", Buffer.from(wrongProcessKey).toString("base64url"));
    const occurredAt = "2026-04-21T00:00:00.000Z";
    const wake = buildHostedExecutionVaultSyncImportWake({
      eventId: "vault-sync.import:vsi_platform_env",
      memberId: "member_123",
      occurredAt,
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_platform_env",
        sourceSchemaVersion: "murph.vault.v1",
      },
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: vi.fn(async () => {}) }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_123",
        workspaceVersion: "7",
      },
      runtime: {
        platformEnv: {
          HOSTED_WAKE_ENCRYPTION_KEY: Buffer.from(key).toString("base64url"),
          HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "v1",
        },
      },
      vaultRoot,
    });
    const payloadCiphertext = await encryptHostedMailboxPayload({
      key,
      userId: "member_123",
      value: wake,
    });

    const result = await options.importItem({
      item: {
        createdAt: occurredAt,
        dedupeKey: wake.eventId,
        expiresAt: null,
        id: "mailbox_item_1",
        kind: "vault.sync.import",
        lane: "system",
        laneSeq: "1",
        occurredAt,
        payloadBytes: payloadCiphertext.length,
        payloadInlineCiphertext: payloadCiphertext,
        payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1",
        updatedAt: occurredAt,
        userId: "member_123",
      },
      payload: {
        payloadCiphertext,
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        requestId: null,
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "import-vault-sync",
        advanceProgress: true,
        itemRef: {
          id: "mailbox_item_1",
          kind: "vault.sync.import",
          lane: "system",
          laneSeq: "1",
        },
        state: "route",
      },
    });

    expect(result).toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });
  });

  it("fails closed when a runtime envelope omits mailbox platform env", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const key = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
    vi.stubEnv("HOSTED_WAKE_ENCRYPTION_KEY", Buffer.from(key).toString("base64url"));
    const occurredAt = "2026-04-21T00:00:00.000Z";
    const wake = buildHostedExecutionVaultSyncImportWake({
      eventId: "vault-sync.import:vsi_missing_platform_env",
      memberId: "member_123",
      occurredAt,
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_missing_platform_env",
        sourceSchemaVersion: "murph.vault.v1",
      },
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: vi.fn(async () => {}) }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_123",
        workspaceVersion: "7",
      },
      runtime: {
        forwardedEnv: {
          VERCEL_AI_API_KEY: "vercel-secret",
        },
      },
      vaultRoot,
    });
    const payloadCiphertext = await encryptHostedMailboxPayload({
      key,
      userId: "member_123",
      value: wake,
    });

    await expect(options.importItem({
      item: {
        createdAt: occurredAt,
        dedupeKey: wake.eventId,
        expiresAt: null,
        id: "mailbox_item_1",
        kind: "vault.sync.import",
        lane: "system",
        laneSeq: "1",
        occurredAt,
        payloadBytes: payloadCiphertext.length,
        payloadInlineCiphertext: payloadCiphertext,
        payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1",
        updatedAt: occurredAt,
        userId: "member_123",
      },
      payload: {
        payloadCiphertext,
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        requestId: null,
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "import-vault-sync",
        advanceProgress: true,
        itemRef: {
          id: "mailbox_item_1",
          kind: "vault.sync.import",
          lane: "system",
          laneSeq: "1",
        },
        state: "route",
      },
    })).rejects.toThrow(/HOSTED_WAKE_ENCRYPTION_KEY is required/u);
  });

  it("blocks decrypted mailbox payloads that do not match the item dedupe key", async () => {
    const key = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
    const occurredAt = "2026-04-21T00:00:00.000Z";
    const wake = buildHostedExecutionVaultSyncImportWake({
      eventId: "vault-sync.import:vsi_runtime",
      memberId: "member_123",
      occurredAt,
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: "murph.vault.v1",
      },
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: vi.fn(async () => {}) }),
      readEncryptionEnvironment: () => ({
        key,
        keyVersion: "v1",
        keysByVersion: {
          v1: key,
        },
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: "member_123",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot: "/tmp/unused-vault",
    });
    const payloadCiphertext = await encryptHostedMailboxPayload({
      key,
      userId: "member_123",
      value: wake,
    });

    const result = await options.importItem({
      item: {
        createdAt: occurredAt,
        dedupeKey: "vault-sync.import:other-event",
        expiresAt: null,
        id: "mailbox_item_1",
        kind: "vault.sync.import",
        lane: "system",
        laneSeq: "1",
        occurredAt,
        payloadBytes: payloadCiphertext.length,
        payloadInlineCiphertext: payloadCiphertext,
        payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1",
        updatedAt: occurredAt,
        userId: "member_123",
      },
      payload: {
        payloadCiphertext,
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        requestId: null,
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "import-vault-sync",
        advanceProgress: true,
        itemRef: {
          id: "mailbox_item_1",
          kind: "vault.sync.import",
          lane: "system",
          laneSeq: "1",
        },
        state: "route",
      },
    });

    expect(result).toEqual({
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    });
  });
});

function createCheckpointInput() {
  const state = {
    recentStatuses: [],
    watermarks: {
      conversation: "0",
      system: "0",
    },
  };

  return {
    importResult: {
      blocked: [],
      fetchedCount: 0,
      importedCount: 0,
      state,
    },
    previousState: state,
    reason: "idle" as const,
    redactedStatus: {},
    state,
  };
}

function createPlatform(input: {
  putArtifact: (payload: { bytes: Uint8Array; sha256: string }) => Promise<void>;
}) {
  return {
    artifactStore: {
      get: async () => null,
      put: input.putArtifact,
    },
    effectsPort: {
      readRawEmailMessage: async () => null,
      sendEmail: async () => undefined,
    },
  };
}

async function encryptHostedMailboxPayload(input: {
  key: Uint8Array;
  userId: string;
  value: unknown;
}): Promise<string> {
  const iv = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const scopedKey = await deriveHostedMailboxScopeKey(
    input.key,
    `hosted-mailbox-payload:${HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD}`,
  );
  const keyHandle = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(scopedKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    {
      additionalData: toArrayBuffer(new TextEncoder().encode(JSON.stringify({
        field: HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD,
        memberId: input.userId,
        purpose: "hosted-mailbox-payload",
      }))),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
      tagLength: 128,
    },
    keyHandle,
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(input.value))),
  ));
  const ciphertext = encrypted.subarray(0, encrypted.byteLength - 16);
  const tag = encrypted.subarray(encrypted.byteLength - 16);

  return [
    "hbds",
    "v1",
    encodeBase64Url(iv),
    encodeBase64Url(tag),
    encodeBase64Url(ciphertext),
  ].join(":");
}

async function deriveHostedMailboxScopeKey(rootKey: Uint8Array, scope: string): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      info: toArrayBuffer(new TextEncoder().encode(scope)),
      name: "HKDF",
      salt: toArrayBuffer(HOSTED_MAILBOX_SCOPE_SALT),
    },
    keyMaterial,
    256,
  );

  return new Uint8Array(derivedBits);
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
