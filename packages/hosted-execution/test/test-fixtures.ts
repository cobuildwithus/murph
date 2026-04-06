import type { SharePack } from "@murphai/contracts";

export const TEST_HOSTED_SHARE_PACK: SharePack = {
  createdAt: "2026-03-28T09:20:00.000Z",
  entities: [
    {
      kind: "food",
      payload: {
        kind: "smoothie",
        status: "active",
        title: "Shared breakfast",
      },
      ref: "food.shared-breakfast",
    },
  ],
  schemaVersion: "murph.share-pack.v1",
  title: "Shared breakfast",
};

export const TEST_HOSTED_RECIPIENT_PUBLIC_JWK = {
  crv: "P-256",
  ext: true,
  key_ops: [] as string[],
  kty: "EC",
  x: "xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao",
  y: "8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY",
} as const;

export const TEST_HOSTED_RECIPIENT_PRIVATE_JWK = {
  ...TEST_HOSTED_RECIPIENT_PUBLIC_JWK,
  d: "HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ",
  key_ops: ["deriveBits"] as string[],
} as const;
