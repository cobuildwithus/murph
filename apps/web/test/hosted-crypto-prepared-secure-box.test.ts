import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedSecureBoxAad,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  openHostedSecureBox,
  parseSerializedHostedSecureBoxEnvelope,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { beforeEach, expect, test, vi } from "vitest";

const runtimeImportMocks = vi.hoisted(() => ({
  databaseModuleLoads: vi.fn(),
  providerStoreModuleLoads: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  runtimeImportMocks.databaseModuleLoads();
  return {};
});

vi.mock("../src/lib/hosted-crypto/domain-root-store", () => {
  runtimeImportMocks.providerStoreModuleLoads();
  return {};
});

import {
  getHostedDomainRootUnwrapCache,
  runWithHostedDomainRootUnwrapCache,
} from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  sealHostedUserSecureBoxStringFromPreparedRoot,
  setHostedSecureBoxStringTestCodecForTests,
} from "../src/lib/hosted-crypto/secure-box";

beforeEach(() => {
  setHostedSecureBoxStringTestCodecForTests(null);
});

test("prepared secure-box sealing is an exact local cache hit with no provider or database import", async () => {
  const userId = "member-prepared-mailbox-seal";
  const rootKeyId = "udrk:ingress:prepared-mailbox-seal";
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const cachedRootKey = Uint8Array.from(rootKey);
  const metadata = {
    dedupeKey: "dedupe-prepared-mailbox-seal",
    itemId: "mailbox-prepared-seal",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 17n,
    occurredAt: "2026-08-11T18:30:00.000Z",
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    payloadStorage: "inline" as const,
    userId,
  };
  const aad = buildHostedMailboxPayloadSecureBoxAad(metadata);
  const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
  const envelope: HostedDomainRootKeyEnvelopeV1 = {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: "test-key-version",
      signedAt: "2026-08-11T18:00:00.000Z",
      signature: "test-signature",
    },
    createdAt: "2026-08-11T18:00:00.000Z",
    domain: "ingress",
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: "2026-08-11T18:00:00.000Z",
    userId,
    wraps: [],
  };

  await runWithHostedDomainRootUnwrapCache(async () => {
    const cache = getHostedDomainRootUnwrapCache();
    expect(cache).toBeDefined();
    const preparedRoot = Promise.resolve({
      envelope,
      rootKey: cachedRootKey,
    });
    cache?.set(`${userId}|ingress|${rootKeyId}`, preparedRoot);

    const ciphertext = await sealHostedUserSecureBoxStringFromPreparedRoot({
      aad,
      lane: "mailbox-payload",
      preparedRoot,
      preparedRootKeyId: rootKeyId,
      scope,
      userId,
      value: "prepared mailbox plaintext",
    });
    expect(ciphertext).toEqual(expect.any(String));
    expect(runtimeImportMocks.databaseModuleLoads).not.toHaveBeenCalled();
    expect(runtimeImportMocks.providerStoreModuleLoads).not.toHaveBeenCalled();
    expect([...cachedRootKey]).toEqual([...rootKey]);

    const plaintext = await openHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        ...aad,
        domain: "ingress",
        lane: "mailbox-payload",
        scope,
        tenant: "murph-hosted",
        userId,
      }),
      envelope: parseSerializedHostedSecureBoxEnvelope(ciphertext ?? ""),
      expectedDomain: "ingress",
      expectedLane: "mailbox-payload",
      expectedRootKeyId: rootKeyId,
      expectedScope: scope,
      rootKey,
    });
    try {
      expect(new TextDecoder().decode(plaintext)).toBe(
        "prepared mailbox plaintext",
      );
    } finally {
      plaintext.fill(0);
    }
  });

  expect(runtimeImportMocks.databaseModuleLoads).not.toHaveBeenCalled();
  expect(runtimeImportMocks.providerStoreModuleLoads).not.toHaveBeenCalled();
  expect([...cachedRootKey]).toEqual(Array.from({ length: 32 }, () => 0));
});
