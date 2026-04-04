import { describe, expect, it } from "vitest";

import type { HostedUserRootKeyEnvelope } from "@murphai/runtime-state";

import {
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
});
