import { describe, expect, it } from "vitest";

import type {
  HostedUserRootKeyEnvelope,
  HostedUserManagedRootKeyRecipientKind,
} from "@murphai/runtime-state";
import {
  buildHostedWrappedRootKeyRecipientAadFields,
  buildLegacyHostedWrappedRootKeyRecipientAadFields,
} from "@murphai/runtime-state";

import {
  buildHostedBrowserStorageAad,
  createHostedUserRecipientUpsertPayload,
  unwrapHostedUserRootKeyForBrowser,
} from "../src/lib/hosted-execution/browser-user-keys";

describe("hosted execution browser user keys", () => {
  it("rejects recipient upsert payload keys that are not 32 bytes", () => {
    expect(() =>
      createHostedUserRecipientUpsertPayload({
        key: new Uint8Array(16),
        keyId: "browser:v1",
      })).toThrow(/32 bytes/u);
  });

  it("rejects wrapped root key unwrap inputs that are not 32 bytes", async () => {
    const envelope: HostedUserRootKeyEnvelope = {
      createdAt: "2026-04-04T00:00:00.000Z",
      recipients: [{
        ciphertext: "ciphertext",
        iv: "iv",
        keyId: "browser:v1",
        kind: "user-unlock",
      }],
      rootKeyId: "root-key:v1",
      schema: "murph.hosted-user-root-key-envelope.v1",
      updatedAt: "2026-04-04T00:00:00.000Z",
      userId: "member_123",
    };

    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope,
      kind: "user-unlock",
      recipientKey: new Uint8Array(16),
    })).rejects.toThrow(/32 bytes/u);
  });

  it("unwraps legacy wrapped root keys for backward compatibility", async () => {
    const recipientKey = new Uint8Array(32).fill(7);
    const rootKey = new Uint8Array(32).fill(9);
    const envelope = await createWrappedRecipientEnvelope({
      kind: "user-unlock",
      recipientKey,
      rootKey,
      rootKeyId: "root-key:v1",
      userId: "member_123",
      useLegacyAad: true,
    });

    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope,
      kind: "user-unlock",
      recipientKey,
    })).resolves.toEqual(rootKey);
  });

  it("binds wrapped root keys to the envelope user and root-key identity", async () => {
    const recipientKey = new Uint8Array(32).fill(11);
    const rootKey = new Uint8Array(32).fill(13);
    const envelope = await createWrappedRecipientEnvelope({
      kind: "user-unlock",
      recipientKey,
      rootKey,
      rootKeyId: "root-key:v1",
      userId: "member_123",
    });

    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope,
      kind: "user-unlock",
      recipientKey,
    })).resolves.toEqual(rootKey);
    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope: {
        ...envelope,
        rootKeyId: "root-key:v2",
      },
      kind: "user-unlock",
      recipientKey,
    })).rejects.toThrow();
    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope: {
        ...envelope,
        userId: "member_456",
      },
      kind: "user-unlock",
      recipientKey,
    })).rejects.toThrow();
  });
});

async function createWrappedRecipientEnvelope(input: {
  kind: HostedUserManagedRootKeyRecipientKind;
  recipientKey: Uint8Array;
  rootKey: Uint8Array;
  rootKeyId: string;
  useLegacyAad?: boolean;
  userId: string;
}): Promise<HostedUserRootKeyEnvelope> {
  const aadFields = input.useLegacyAad
    ? buildLegacyHostedWrappedRootKeyRecipientAadFields({
        keyId: "browser:v1",
        kind: input.kind,
      })
    : buildHostedWrappedRootKeyRecipientAadFields({
        keyId: "browser:v1",
        kind: input.kind,
        rootKeyId: input.rootKeyId,
        userId: input.userId,
      });
  const wrappedRecipient = await encryptRecipientForBrowserTest({
    aad: buildHostedBrowserStorageAad(aadFields),
    keyId: "browser:v1",
    recipientKey: input.recipientKey,
    plaintext: input.rootKey,
    scope: "root-key-recipient",
  });

  return {
    createdAt: "2026-04-04T00:00:00.000Z",
    recipients: [{
      ciphertext: wrappedRecipient.ciphertext,
      iv: wrappedRecipient.iv,
      keyId: wrappedRecipient.keyId,
      kind: input.kind,
    }],
    rootKeyId: input.rootKeyId,
    schema: "murph.hosted-user-root-key-envelope.v1",
    updatedAt: "2026-04-04T00:00:00.000Z",
    userId: input.userId,
  };
}

async function encryptRecipientForBrowserTest(input: {
  aad: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  recipientKey: Uint8Array;
  scope: string;
}): Promise<{ ciphertext: string; iv: string; keyId: string }> {
  const scopedKey = await deriveHostedBrowserStorageKeyForTest(input.recipientKey, input.scope);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(scopedKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        additionalData: toArrayBuffer(input.aad),
        iv: toArrayBuffer(iv),
        name: "AES-GCM",
      },
      cryptoKey,
      toArrayBuffer(input.plaintext),
    ),
  );

  return {
    ciphertext: encodeBase64ForTest(ciphertext),
    iv: encodeBase64ForTest(iv),
    keyId: input.keyId,
  };
}

async function deriveHostedBrowserStorageKeyForTest(rootKey: Uint8Array, scope: string): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      info: new TextEncoder().encode(scope),
      salt: new TextEncoder().encode("murph.cloudflare.hosted.storage.v2"),
    },
    baseKey,
    256,
  );

  return new Uint8Array(derived);
}

function encodeBase64ForTest(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
