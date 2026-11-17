import assert from "node:assert/strict";
import { verify } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createGitHubAppTokenSupplier, createKmsGitHubAppJwtSigner, credentialJson, crc32c, revokeGitHubAppToken } from "./github-app-token.mjs";
import { runTokenAction, cleanupTokenAction } from "./github-app-token-action.mjs";
import { fakeKms, keyVersion, oidcEnv } from "./fixtures/github-app-kms.mjs";

test("KMS RS256 signature verifies with test key and binds GitHub JWT claims", async () => {
  const now = () => 2_000_000_000_000;
  const kms = fakeKms({ now });
  for (const appId of ["123", "Iv1.testclient", "Iv23testclient"]) {
    const jwt = await kms.createJwt({ appId, now });
    const [header, payload, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(claims.iss, appId);
    assert.equal(claims.iat, now() / 1000 - 60);
    assert.ok(claims.exp > now() / 1000 && claims.exp <= now() / 1000 + 600);
    assert.equal(Buffer.from(signature, "base64url").length, 256);
    assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), kms.publicKey, Buffer.from(signature, "base64url")));
  }
  assert.equal(crc32c(Buffer.from("123456789")), 0xe3069283);
});

for (const [field, value] of [["name", `${keyVersion}0`], ["verifiedDigestCrc32c", false], ["signatureCrc32c", "0"], ["signature", "invalid"]]) {
  test(`KMS rejects incorrect ${field}`, async () => {
    const kms = fakeKms({ mutateSignature: (result) => ({ ...result, [field]: value }) });
    await assert.rejects(kms.createJwt({ appId: "123" }), /integrity/u);
  });
}

test("federation failure is sanitized and never falls back to a static key", async () => {
  const calls = [];
  const signer = createKmsGitHubAppJwtSigner({ keyVersion,
    env: { ...oidcEnv, GITHUB_APP_PRIVATE_KEY: "unused-fixture" },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return Response.json({ value: "subject-fixture" });
      throw new Error("sensitive-provider-response");
    },
  });
  await assert.rejects(signer({ appId: "123" }), { message: "Google STS exchange failed; no credential response was exposed." });
  assert.equal(calls.length, 2);
});

test("credential transport bounds requests, rejects redirects, and hides failed bodies", async () => {
  await assert.rejects(credentialJson("https://example.test", {}, "Test", async (_url, init) => {
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    return new Response("sensitive-body", { status: 403 });
  }), { message: "Test failed; no credential response was exposed." });
});

test("supplier coalesces concurrent refresh, retains scope, and retries signing after failure", async () => {
  let time = 2_000_000_000_000;
  let signatures = 0;
  let fail = false;
  const bodies = [];
  const permissions = { contents: "read", actions: "write" };
  const repositories = ["target"];
  const supplier = createGitHubAppTokenSupplier({ appId: "123", repository: "example/target", permissions, repositories,
    now: () => time,
    createJwt: async () => { signatures += 1; if (fail) throw new Error("signing unavailable"); return "jwt-fixture"; },
    fetchJsonImpl: async (url, init) => {
      if (url.endsWith("/installation")) return { id: 12 };
      bodies.push(JSON.parse(init.body));
      return { token: `fixture-${bodies.length}`, expires_at: new Date(time + 60 * 60_000).toISOString() };
    },
  });
  permissions.contents = "write";
  repositories.push("unrelated");
  assert.deepEqual(await Promise.all([supplier(), supplier()]), ["fixture-1", "fixture-1"]);
  assert.equal(signatures, 1);
  time += 59 * 60_000;
  fail = true;
  await assert.rejects(supplier(), /signing unavailable/u);
  fail = false;
  assert.equal(await supplier(), "fixture-2");
  assert.deepEqual(bodies, Array(2).fill({ permissions: { contents: "read", actions: "write" }, repositories: ["target"] }));
});

test("supplier rejects implicit broad scope", () => {
  const base = { appId: "123", repository: "example/target", createJwt: async () => "jwt-fixture" };
  assert.throws(() => createGitHubAppTokenSupplier(base), /repositories/u);
  assert.throws(() => createGitHubAppTokenSupplier({ ...base, repositories: ["target"] }), /permissions/u);
});

for (const jobResult of ["success", "failure"]) {
  test(`action masks, saves cleanup state, and revokes after job ${jobResult}`, async () => {
    const calls = [];
    const env = { "INPUT_APP-ID": "123", "INPUT_KEY-VERSION": keyVersion, INPUT_OWNER: "example",
      INPUT_REPOSITORIES: "target", INPUT_PERMISSIONS: '{"contents":"read"}',
      GITHUB_STATE: "state-file", GITHUB_OUTPUT: "output-file" };
    await runTokenAction({ env,
      createSupplier: (options) => {
        assert.deepEqual(options.repositories, ["target"]);
        assert.deepEqual(options.permissions, { contents: "read" });
        assert.equal(options.repository, "example/target");
        assert.equal(options.keyVersion, keyVersion);
        return async () => "fixture-token";
      },
      log: (line) => calls.push(line), append: (file, value) => calls.push([file, value]),
    });
    assert.deepEqual(calls, ["::add-mask::fixture-token", ["state-file", "token=fixture-token\n"], ["output-file", "token=fixture-token\n"]]);
    await cleanupTokenAction({ env: { STATE_token: "fixture-token", JOB_STATUS: jobResult },
      revoke: async (token) => calls.push(["revoked", token]),
    });
    assert.deepEqual(calls.at(-1), ["revoked", "fixture-token"]);
    const action = await readFile(new URL("../.github/actions/github-app-token/action.yml", import.meta.url), "utf8");
    assert.match(action, /post-if: always\(\)/u);
    assert.match(action, /using: node24/u);
  });
}

test("action revokes if output or cleanup-state persistence fails", async () => {
  const revoked = [];
  await assert.rejects(runTokenAction({
    env: { GITHUB_STATE: "state", GITHUB_OUTPUT: "output", INPUT_PERMISSIONS: "{}" },
    createSupplier: () => async () => "fixture-token", log: () => {},
    append: () => { throw new Error("disk full"); }, revoke: async (token) => revoked.push(token),
  }), /output failed/u);
  assert.deepEqual(revoked, ["fixture-token"]);
});

test("post action skips absent tokens and reports revocation failure", async () => {
  await cleanupTokenAction({ env: {}, revoke: () => { assert.fail("no token to revoke"); } });
  await assert.rejects(cleanupTokenAction({ env: { STATE_token: "fixture-token" },
    revoke: async () => { throw new Error("revoke failed"); },
  }), /revoke failed/u);
});

test("revocation uses the installation token, has a deadline, and handles expired tokens", async () => {
  for (const status of [204, 401, 403, 500]) {
    const result = revokeGitHubAppToken("fixture-token", { fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.github.com/installation/token");
      assert.equal(init.method, "DELETE");
      assert.equal(init.headers.authorization, "Bearer fixture-token");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      return new Response(null, { status });
    } });
    if ([204, 401].includes(status)) await result;
    else await assert.rejects(result, { message: "GitHub App token revocation failed." });
  }
});

test("OIDC permission is confined to each trusted minting job", async () => {
  const jobs = {
    "friction-log": "friction-log",
    "temporal-compatibility": "compatibility",
    "temporal-web-deployment-admission": "admission",
    "junction-wearable-canary": "connect",
    "native-android-hosted-e2e": "production-canary",
    "native-ios-hosted-e2e": "production-canary",
  };
  for (const [workflow, mintingJob] of Object.entries(jobs)) {
    const source = await readFile(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), "utf8");
    const [beforeJobs, jobSource] = source.split("\njobs:\n");
    assert.doesNotMatch(beforeJobs, /id-token:/u);
    const blocks = jobSource.split(/^  ([a-z][a-z-]+):\n/gmu);
    for (let index = 1; index < blocks.length; index += 2) {
      assert.equal(blocks[index + 1].includes("      id-token: write"), blocks[index] === mintingJob, workflow);
    }
    assert.doesNotMatch(source, /APP_PRIVATE_KEY|create-github-app-token@|pull_request_target:|pull_request:/u);
    assert.match(source, /persist-credentials: false/u);
  }
});

test("an unusable minted token is revoked before the supplier rejects its expiry", async () => {
  const revoked = [];
  const supplier = createGitHubAppTokenSupplier({ appId: "123", createJwt: async () => "jwt-fixture",
    repository: "example/target", repositories: ["target"], permissions: { contents: "read" },
    fetchJsonImpl: async (url) => url.endsWith("/installation") ? { id: 12 }
      : { token: "fixture-token", expires_at: "invalid" },
    fetchImpl: async (_url, init) => { revoked.push(init.headers.authorization); return new Response(null, { status: 204 }); },
  });
  await assert.rejects(supplier(), /expiry/u);
  assert.deepEqual(revoked, ["Bearer fixture-token"]);
});
