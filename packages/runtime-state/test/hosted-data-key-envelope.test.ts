import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import {
  createHostedDataKeyEnvelopeWithDomainRoot,
  decodeHostedDataKeyEnvelopeWrap,
  parseHostedDataKeyEnvelope,
  unwrapHostedDataKeyWithDomainRoot,
} from "../src/hosted-data-key-envelope.ts";

const ROOT_KEY_V1 = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const ROOT_KEY_V2 = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const RESOURCE = {
  objectKey: "users/hsn_test/browser-vault-replicas/replica.json",
  purpose: "browser-vault-replica",
  userId: "user_123",
} as const;

test("hosted data-key envelope round-trips through its primary domain-root wrap", async () => {
  const { dataKey, envelope } = await createHostedDataKeyEnvelopeWithDomainRoot({
    domain: "runtime",
    lane: "browser-vault-replica",
    resource: RESOURCE,
    rootKey: ROOT_KEY_V1,
    rootKeyId: "udrk:runtime:v1",
  });

  const decode = vi.spyOn(globalThis, "atob");
  try {
    const decoded = decodeHostedDataKeyEnvelopeWrap({ envelope, rootKeyId: "udrk:runtime:v1" });
    const unwrapped = await unwrapHostedDataKeyWithDomainRoot({ decoded, rootKey: ROOT_KEY_V1 });
    assert.deepEqual(unwrapped, dataKey);
    expect(decode.mock.calls).toEqual([[envelope.wraps[0]!.iv], [envelope.wraps[0]!.ciphertext]]);
  } finally {
    decode.mockRestore();
  }
  assert.equal(envelope.rootKeyId, "udrk:runtime:v1");
  assert.equal(envelope.wraps.length, 1);
});

test("hosted data-key envelope can decrypt with a non-primary domain-root wrap", async () => {
  const primary = await createHostedDataKeyEnvelopeWithDomainRoot({
    domain: "runtime",
    lane: "browser-vault-replica",
    resource: RESOURCE,
    rootKey: ROOT_KEY_V1,
    rootKeyId: "udrk:runtime:v1",
  });
  const rewrapped = await createHostedDataKeyEnvelopeWithDomainRoot({
    dataKey: primary.dataKey,
    dataKeyId: primary.envelope.dataKeyId,
    domain: "runtime",
    lane: "browser-vault-replica",
    resource: RESOURCE,
    rootKey: ROOT_KEY_V2,
    rootKeyId: "udrk:runtime:v2",
  });
  const multiWrapEnvelope = parseHostedDataKeyEnvelope({
    ...primary.envelope,
    wraps: [...primary.envelope.wraps, rewrapped.envelope.wraps[0]!],
  });

  const unwrapped = await unwrapHostedDataKeyWithDomainRoot({
    decoded: decodeHostedDataKeyEnvelopeWrap({ envelope: multiWrapEnvelope, rootKeyId: "udrk:runtime:v2" }),
    rootKey: ROOT_KEY_V2,
  });

  assert.deepEqual(unwrapped, primary.dataKey);
  expect(() =>
    decodeHostedDataKeyEnvelopeWrap({ envelope: multiWrapEnvelope, rootKeyId: "udrk:runtime:missing" }),
  ).toThrow(/missing domain-root wrap udrk:runtime:missing/u);
});
