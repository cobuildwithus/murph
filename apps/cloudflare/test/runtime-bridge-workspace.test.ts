import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedSecureBoxAad,
  sealHostedSecureBox,
  serializeHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";
import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedMailboxEncryptionEnvironmentFromIngressRoot,
} from "../src/hosted-mailbox-encryption.ts";
import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "../src/runtime-bridge-workspace.ts";

const cleanupPaths: string[] = [];

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

  it("decrypts sidecar mailbox payloads through the bridge using the sidecar payload schema", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const rootKeyId = "udrk:ingress:bridge-sidecar";
    const item = {
      createdAt: "2026-05-01T00:00:00.000Z",
      dedupeKey: "event:member-channels-sidecar",
      expiresAt: null,
      id: "mailbox_item_bridge_sidecar",
      kind: "member.channels.updated" as const,
      lane: "system" as const,
      laneSeq: "1",
      occurredAt: "2026-05-01T00:00:00.000Z",
      payloadBytes: 128,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_bridge_sidecar",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_bridge_sidecar",
    };
    const metadata = {
      dedupeKey: item.dedupeKey,
      itemId: item.id,
      kind: item.kind,
      lane: item.lane,
      laneSeq: item.laneSeq,
      occurredAt: item.occurredAt,
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadStorage: "sidecar" as const,
      userId: item.userId,
    };
    const payload = {
      eventId: item.dedupeKey,
      kind: item.kind,
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      occurredAt: item.occurredAt,
      userId: item.userId,
    };
    const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
    const payloadCiphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        ...buildHostedMailboxPayloadSecureBoxAad(metadata),
        domain: "ingress",
        lane: "mailbox-payload",
        scope,
        userId: item.userId,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode(JSON.stringify(payload)),
      rootKey,
      rootKeyId,
      scope,
    }));
    const readEncryptionUsers: string[] = [];
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: async () => {} }),
      readEncryptionEnvironment: ({ userId }) => {
        readEncryptionUsers.push(userId);
        return createHostedMailboxEncryptionEnvironmentFromIngressRoot({
          rootKey,
          rootKeyId,
        });
      },
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        reason: "nudge",
        userId: item.userId,
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.importItem({
      item,
      payload: {
        payloadCiphertext,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_bridge_sidecar",
        source: "sidecar",
        status: "resolved",
      },
      route: {
        action: "apply-member-channels-update",
        advanceProgress: true,
        itemRef: {
          id: item.id,
          kind: item.kind,
          lane: item.lane,
          laneSeq: item.laneSeq,
        },
        state: "route",
      },
    })).resolves.toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });
    expect(readEncryptionUsers).toEqual([item.userId]);
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
