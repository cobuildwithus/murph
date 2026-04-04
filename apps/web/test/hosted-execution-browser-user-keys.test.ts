import { describe, expect, it } from "vitest";

import {
  findHostedWrappedRootKeyRecipient,
  parseHostedUserRecipientPrivateKeyJwk,
} from "@murphai/runtime-state";

import {
  createHostedBrowserGeneratedRootKeyEnvelope,
  createHostedUserRecipientUpsertPayload,
  generateHostedBrowserRecipientKeyPair,
  unwrapHostedUserRootKeyForBrowser,
} from "../src/lib/hosted-execution/browser-user-keys";

describe("hosted execution browser user keys", () => {
  it("builds the managed-recipient upsert payload from a browser recipient JWK", async () => {
    const recipient = await generateHostedBrowserRecipientKeyPair();

    expect(createHostedUserRecipientUpsertPayload({
      keyId: "browser:v1",
      metadata: {
        label: "passkey",
      },
      publicKeyJwk: recipient.publicKeyJwk,
    })).toEqual({
      metadata: {
        label: "passkey",
      },
      recipientKeyId: "browser:v1",
      recipientPublicKeyJwk: recipient.publicKeyJwk,
    });
  });

  it("creates a browser-generated root-key envelope that browser recipients can unwrap", async () => {
    const automationRecipient = await generateHostedBrowserRecipientKeyPair();
    const browserRecipient = await generateHostedBrowserRecipientKeyPair();

    const result = await createHostedBrowserGeneratedRootKeyEnvelope({
      automationRecipient: {
        keyId: "automation:v1",
        publicKeyJwk: automationRecipient.publicKeyJwk,
      },
      userId: "member_123",
      userUnlockRecipient: {
        keyId: "browser:v1",
        metadata: {
          label: "primary",
        },
        publicKeyJwk: browserRecipient.publicKeyJwk,
      },
    });

    expect(result.rootKey).toHaveLength(32);
    expect(result.envelope.schema).toBe("murph.hosted-user-root-key-envelope.v2");
    expect(result.envelope.userId).toBe("member_123");
    expect(findHostedWrappedRootKeyRecipient(result.envelope, "automation")).toMatchObject({
      keyId: "automation:v1",
      kind: "automation",
    });
    expect(findHostedWrappedRootKeyRecipient(result.envelope, "user-unlock")).toMatchObject({
      keyId: "browser:v1",
      kind: "user-unlock",
      metadata: {
        label: "primary",
      },
    });

    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope: result.envelope,
      kind: "user-unlock",
      recipientPrivateKeyJwk: browserRecipient.privateKeyJwk,
    })).resolves.toEqual(result.rootKey);
  });

  it("binds wrapped root keys to the envelope identity", async () => {
    const automationRecipient = await generateHostedBrowserRecipientKeyPair();
    const browserRecipient = await generateHostedBrowserRecipientKeyPair();
    const { envelope } = await createHostedBrowserGeneratedRootKeyEnvelope({
      automationRecipient: {
        keyId: "automation:v1",
        publicKeyJwk: automationRecipient.publicKeyJwk,
      },
      rootKeyId: "urk:test",
      userId: "member_123",
      userUnlockRecipient: {
        keyId: "browser:v1",
        publicKeyJwk: browserRecipient.publicKeyJwk,
      },
    });

    const alternateRecipient = await generateHostedBrowserRecipientKeyPair();
    const alternatePrivateKey = parseHostedUserRecipientPrivateKeyJwk(
      {
        ...alternateRecipient.privateKeyJwk,
      },
      "alternate recipient private key",
    );

    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope: {
        ...envelope,
        rootKeyId: "urk:tampered",
      },
      kind: "user-unlock",
      recipientPrivateKeyJwk: browserRecipient.privateKeyJwk,
    })).rejects.toThrow();

    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope: {
        ...envelope,
        userId: "member_456",
      },
      kind: "user-unlock",
      recipientPrivateKeyJwk: browserRecipient.privateKeyJwk,
    })).rejects.toThrow();

    await expect(unwrapHostedUserRootKeyForBrowser({
      envelope,
      kind: "user-unlock",
      recipientPrivateKeyJwk: alternatePrivateKey,
    })).rejects.toThrow();
  });
});
