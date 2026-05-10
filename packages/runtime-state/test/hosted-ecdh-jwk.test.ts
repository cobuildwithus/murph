import assert from "node:assert/strict";

import { test } from "vitest";

import {
  parseHostedUserRecipientPrivateKeyJwk,
  parseHostedUserRecipientPublicKeyJwk,
} from "../src/hosted-ecdh-jwk.ts";

const PUBLIC_JWK = {
  crv: "P-256",
  kty: "EC",
  x: "public-x",
  y: "public-y",
} as const;

test("hosted ECDH JWK parsers validate optional fields and fail closed on malformed keys", () => {
  assert.deepEqual(parseHostedUserRecipientPublicKeyJwk({
    ...PUBLIC_JWK,
    ext: true,
    key_ops: ["deriveBits"],
  }), {
    ...PUBLIC_JWK,
    ext: true,
    key_ops: ["deriveBits"],
  });
  assert.deepEqual(parseHostedUserRecipientPrivateKeyJwk({
    ...PUBLIC_JWK,
    d: "private-d",
  }), {
    ...PUBLIC_JWK,
    d: "private-d",
  });

  assert.throws(
    () => parseHostedUserRecipientPublicKeyJwk({ ...PUBLIC_JWK, ext: "yes" }, "publicKey"),
    /publicKey\.ext must be a boolean\./u,
  );
  assert.throws(
    () => parseHostedUserRecipientPublicKeyJwk({ ...PUBLIC_JWK, key_ops: "deriveBits" }, "publicKey"),
    /publicKey\.key_ops must be an array\./u,
  );
  assert.throws(
    () => parseHostedUserRecipientPublicKeyJwk({ ...PUBLIC_JWK, crv: "P-384" }, "publicKey"),
    /publicKey must be an EC P-256 public JWK\./u,
  );
  assert.throws(
    () => parseHostedUserRecipientPrivateKeyJwk({ ...PUBLIC_JWK, d: "" }, "privateKey"),
    /privateKey\.d must be a non-empty string\./u,
  );
});
