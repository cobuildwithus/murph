import type { HostedExecutionBundleKind, HostedExecutionBundleRef } from "@murphai/runtime-state/node/hosted-bundle-codec";
import { sha256HostedBundleHex } from "@murphai/runtime-state/node/hosted-bundle-codec";
import { createHostedBundleStore } from "../src/bundle-store.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { writeEncryptedR2Payload } from "../src/crypto.js";
import { hostedBundleObjectKey } from "../src/storage-paths.js";

// Legacy bundle production belongs only to fixtures; production keeps the reader.
export function createLegacyHostedBundleFixtureStore(
  input: Parameters<typeof createHostedBundleStore>[0],
) {
  return {
    ...createHostedBundleStore(input),
    async writeBundle(kind: HostedExecutionBundleKind, plaintext: Uint8Array): Promise<HostedExecutionBundleRef> {
      const hash = sha256HostedBundleHex(plaintext);
      const key = await hostedBundleObjectKey({
        hash,
        kind,
        userId: input.userId ?? null,
      });
      await writeEncryptedR2Payload({
        aad: buildHostedStorageAad({
          hash,
          key,
          kind,
          purpose: "bundle",
          size: plaintext.byteLength,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        plaintext,
        scope: "bundle",
      });

      return {
        hash,
        key,
        size: plaintext.byteLength,
        updatedAt: new Date().toISOString(),
      };
    },
  };
}
