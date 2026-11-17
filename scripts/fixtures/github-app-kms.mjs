import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateEncrypt } from "node:crypto";
import { crc32c, createKmsGitHubAppJwtSigner, GITHUB_WIF_AUDIENCE } from "../github-app-token.mjs";

export const keyVersion = "projects/test-project/locations/global/keyRings/apps/cryptoKeys/test-app/cryptoKeyVersions/1";
export const oidcEnv = {
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.test/token?job=fixture",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-request-token",
};

export function fakeKms({ now = Date.now, mutateSignature = (value) => value } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls = [];
  let subjects = 0;
  let exchanges = 0;
  let googleExpiresAt = 0;
  const fetchImpl = async (url, init) => {
    url = String(url);
    calls.push(url);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    let result;
    if (url.startsWith("https://oidc.example.test/")) {
      assert.equal(new URL(url).searchParams.get("audience"), GITHUB_WIF_AUDIENCE);
      assert.equal(init.headers.authorization, "Bearer fixture-request-token");
      result = { value: `subject-${++subjects}` };
    } else if (url === "https://sts.googleapis.com/v1/token") {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("subject_token"), `subject-${subjects}`);
      assert.equal(body.get("audience"), GITHUB_WIF_AUDIENCE);
      assert.equal(body.get("scope"), "https://www.googleapis.com/auth/cloud-platform");
      assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
      assert.equal(body.get("requested_token_type"), "urn:ietf:params:oauth:token-type:access_token");
      assert.equal(body.get("subject_token_type"), "urn:ietf:params:oauth:token-type:jwt");
      googleExpiresAt = now() + 5 * 60_000;
      result = { access_token: `google-${++exchanges}`, token_type: "Bearer", expires_in: 300 };
    } else {
      assert.equal(url, `https://cloudkms.googleapis.com/v1/${keyVersion}:asymmetricSign`);
      assert.ok(now() < googleExpiresAt, "expired Google credentials must not be reused");
      assert.equal(init.headers.authorization, `Bearer google-${exchanges}`);
      const body = JSON.parse(init.body);
      const digest = Buffer.from(body.digest.sha256, "base64");
      assert.equal(body.digestCrc32c, String(crc32c(digest)));
      // KMS signs SHA-256 DigestInfo with RSA PKCS#1 v1.5, without rehashing it.
      const signature = privateEncrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        Buffer.concat([Buffer.from("3031300d060960864801650304020105000420", "hex"), digest]));
      result = mutateSignature({ name: keyVersion, verifiedDigestCrc32c: true,
        signature: signature.toString("base64"), signatureCrc32c: String(crc32c(signature)) });
    }
    return Response.json(result);
  };
  return { calls, fetchImpl, publicKey,
    createJwt: createKmsGitHubAppJwtSigner({ keyVersion, env: oidcEnv, fetchImpl }),
    get subjects() { return subjects; }, get exchanges() { return exchanges; },
  };
}
