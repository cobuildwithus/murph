import { describe, expect, it } from "vitest";

import {
  buildHostedConnectionTokenCipherOptions,
  buildHostedSecretAad,
  createHostedSecretCodec,
} from "@/src/lib/device-sync/crypto";

describe("hosted device-sync secret scoping", () => {
  it("keeps scoped access-token ciphertexts distinct from refresh-token scope", () => {
    const codec = createHostedSecretCodec({
      key: Buffer.alloc(32, 7),
      keyVersion: "v1",
    });
    const accessOptions = buildHostedConnectionTokenCipherOptions({
      connectionId: "conn_1",
      provider: "oura",
      purpose: "device-sync-access-token",
    });
    const refreshOptions = buildHostedConnectionTokenCipherOptions({
      connectionId: "conn_1",
      provider: "oura",
      purpose: "device-sync-refresh-token",
    });
    const ciphertext = codec.encrypt("access-secret", accessOptions);

    expect(codec.decrypt(ciphertext, accessOptions)).toBe("access-secret");
    expect(() => codec.decrypt(ciphertext, refreshOptions)).toThrow();
    expect(() => codec.decrypt(ciphertext, {
      aad: buildHostedSecretAad({
        connectionId: "conn_1",
        provider: "oura",
        purpose: "device-sync-access-token",
      }),
    })).toThrow();
  });

  it("still decrypts legacy unscoped ciphertext when callers now provide a scope", () => {
    const codec = createHostedSecretCodec({
      key: Buffer.alloc(32, 9),
      keyVersion: "v1",
    });
    const legacyCiphertext = codec.encrypt("legacy-refresh-token", {
      aad: buildHostedSecretAad({
        connectionId: "conn_2",
        provider: "whoop",
        purpose: "device-sync-refresh-token",
      }),
    });

    expect(codec.decrypt(legacyCiphertext, buildHostedConnectionTokenCipherOptions({
      connectionId: "conn_2",
      provider: "whoop",
      purpose: "device-sync-refresh-token",
    }))).toBe("legacy-refresh-token");
  });
});
