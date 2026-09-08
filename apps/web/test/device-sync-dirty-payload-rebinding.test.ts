import { zstdCompress, zstdDecompress } from "node:zlib";

import { expect, it, vi } from "vitest";

vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return {
    ...actual,
    zstdCompress: vi.fn(actual.zstdCompress),
    zstdDecompress: vi.fn(actual.zstdDecompress),
  };
});

import {
  openHostedDeviceSyncDirtyPayloadJson,
  prepareHostedDeviceSyncDirtyPayloadCrypto,
  rebindHostedDeviceSyncDirtyPayloadRevision,
  sealHostedDeviceSyncDirtyPayloadJsonFromPreparedCrypto,
} from "@/src/lib/device-sync/prisma-store/dirty-payloads";

it("rebinds only the encrypted compressed envelope without recompressing the payload", async () => {
  const identity = {
    connectionId: "synthetic-connection",
    dirtyRevision: 3n,
    payloadId: "synthetic-payload",
    provider: "junction",
    userId: "synthetic-member",
  };
  // The normal test codec bypasses external root provisioning. The separate
  // real-crypto proof authenticates revision, connection, and prepared root.
  const prepared = await prepareHostedDeviceSyncDirtyPayloadCrypto({
    prisma: {} as never,
    userId: identity.userId,
  });
  const resource = { payload: { webhookDataJson: JSON.stringify({ value: 321 }) } };
  const value = await sealHostedDeviceSyncDirtyPayloadJsonFromPreparedCrypto({
    ...identity, prepared, value: resource,
  });
  expect(zstdCompress).toHaveBeenCalledTimes(1);
  const rebound = await rebindHostedDeviceSyncDirtyPayloadRevision({
    ...identity, prepared, value, nextDirtyRevision: 8n,
  });
  expect(zstdCompress).toHaveBeenCalledTimes(1);
  expect(zstdDecompress).not.toHaveBeenCalled();
  expect(await openHostedDeviceSyncDirtyPayloadJson({
    ...identity, dirtyRevision: 8n, value: rebound,
  })).toEqual(resource);
});
