import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import { HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH } from "@murphai/hosted-execution/routes";
import {
  encodeHostedWorkspaceSnapshotV2DataKey,
  unwrapHostedWorkspaceSnapshotV2DataKey,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
} from "@murphai/runtime-state";

import { clearHostedRuntimeCryptoContextEnvelopeCacheForTests } from "../../src/hosted-crypto/runtime-user-crypto-context.ts";
import { restoreEncryptedWorkspaceSnapshot } from "../../src/workspace-snapshot-local.ts";
import {
  createHostedExecutionTestEnv,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
} from "../hosted-execution-fixtures.ts";
import { uploadHostedLocalWorkspaceSnapshot } from "./hosted-local-workspace-snapshot.ts";

const testkit = vi.hoisted(() => ({
  createDeps: vi.fn(),
  disconnect: vi.fn(),
  ensureWorkspace: vi.fn(),
}));
vi.mock("#hosted-web-testing", () => ({
  createHostedWebTestkitDeps: testkit.createDeps,
}));

const userId = "member_snapshot_fixture";
const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rootKeyId = "udrk:runtime:snapshot-fixture";
const paths: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  testkit.createDeps.mockResolvedValue({
    hostedWorkspaceStore: { ensureHostedWorkspace: testkit.ensureWorkspace },
    prisma: { $disconnect: testkit.disconnect },
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  await Promise.all(paths.splice(0).map((entry) => rm(entry, { force: true, recursive: true })));
});

describe("hosted-local v2 workspace snapshot fixture", () => {
  it.each([
    { endpoint: "http://127.0.0.1:9100", bridgeHost: undefined },
    { endpoint: "http://172.17.0.1:9100", bridgeHost: "172.17.0.1" },
  ])("verifies, uploads, and restores canonical bytes through $endpoint", async ({ endpoint, bridgeHost }) => {
    const fixture = await createFixture();
    const envelope = await createSignedRuntimeEnvelope();
    const calls: string[] = [];
    let workspaceProvisioned = false;
    testkit.ensureWorkspace.mockImplementation(async ({ userId: memberId }) => {
      expect(memberId).toBe(userId);
      calls.push("workspace");
      workspaceProvisioned = true;
    });
    let encryptedBytes = new Uint8Array();
    const request = vi.fn(async (pathname: string, init?: RequestInit) => {
      calls.push("locator");
      expect(pathname).toBe(`/__test/users/${userId}/direct-r2-locator-marker`);
      expect(new Headers(init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(userId);
      const marker = JSON.parse(String(init?.body));
      expect(marker.objectKey).toBe(uploadedObjectKey);
      return Response.json({ ok: true });
    });
    let uploadedObjectKey = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const outgoing = new Request(input, init);
      const url = new URL(outgoing.url);
      if (url.pathname === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH) {
        calls.push("crypto");
        if (!workspaceProvisioned) {
          return Response.json({ error: "hosted_workspace_not_provisioned" }, { status: 403 });
        }
        expect(outgoing.headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(userId);
        expect(outgoing.headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
        return Response.json({
          envelopes: { runtime: envelope },
          schema: "murph.hosted-runtime-crypto-context.v1",
          userId,
        });
      }
      calls.push("upload");
      expect(outgoing.method).toBe("PUT");
      expect(url.origin).toBe(endpoint);
      encryptedBytes = new Uint8Array(await outgoing.arrayBuffer());
      uploadedObjectKey = decodeURIComponent(url.pathname).replace(/^\/fixture-bucket\//u, "");
      const sha256 = createHash("sha256").update(encryptedBytes).digest("hex");
      expect(outgoing.headers.get("x-amz-meta-encryptedsha256")).toBe(sha256);
      expect(outgoing.headers.get("x-amz-checksum-sha256")).toBe(Buffer.from(sha256, "hex").toString("base64"));
      expect(outgoing.headers.get("x-amz-meta-schema")).toBe("murph.hosted-workspace-snapshot.v2");
      expect(outgoing.headers.get("if-none-match")).toBe("*");
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const ref = await uploadHostedLocalWorkspaceSnapshot({
      ...fixture,
      harness: {
        request,
        workerRuntimeEnv: localEnvironment({
          HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: endpoint,
          HOSTED_R2_PRESIGN_ENDPOINT: endpoint,
          MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: bridgeHost,
        }),
      },
      userId,
    });
    expect(calls).toEqual(["workspace", "crypto", "upload", "locator"]);
    expect(testkit.createDeps).toHaveBeenCalledWith(fixture.environment);
    expect(testkit.disconnect).toHaveBeenCalledOnce();
    expect(ref.encryption.aad.objectKey).toBe(ref.objectKey);
    expect(ref.archive.encryptedByteSize).toBe(encryptedBytes.byteLength);
    const dataKey = await unwrapHostedWorkspaceSnapshotV2DataKey({
      aad: ref.encryption.aad,
      rootKey,
      wrappedDataKey: ref.encryption.wrappedDataKey,
    });
    const encryptedFilePath = path.join(fixture.root, "snapshot.enc");
    await writeFile(encryptedFilePath, encryptedBytes);
    const restoredRoot = path.join(fixture.root, "restored");
    await restoreEncryptedWorkspaceSnapshot({
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
      durableRoot: restoredRoot,
      encryptedFilePath,
      ref,
    });
    expect(await readFile(path.join(restoredRoot, "vault", "fixture-note.md"), "utf8"))
      .toBe("Synthetic canonical fixture note.\n");
    expect(await readFile(path.join(restoredRoot, "vault", "vault.json"), "utf8"))
      .toBe(await readFile(path.join(fixture.vaultRoot, "vault.json"), "utf8"));
    // Real restore rejects mismatched metadata; it does not merely accept the schema label.
    await expect(restoreEncryptedWorkspaceSnapshot({
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
      durableRoot: path.join(fixture.root, "tampered"),
      encryptedFilePath,
      ref: { ...ref, archive: { ...ref.archive, encryptedObjectSha256: "0".repeat(64) } },
    })).rejects.toThrow();
    dataKey.fill(0);
  });

  it.each([
    { HOSTED_WEB_BASE_URL: "https://web.example.test" },
    { HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "0" },
    { HOSTED_CRYPTO_ENV: "production" },
    { HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://172.17.0.1:9100" },
    { HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "https://objects.example.test" },
    {
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://172.17.0.1:9100",
      MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: "172.17.0.2",
    },
    {
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://172.17.0.1:9100",
      MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: "172.17.0.1",
      HOSTED_CRYPTO_ENV: "production",
    },
  ])("rejects non-local settings before reading keys or uploading", async (overrides) => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(uploadHostedLocalWorkspaceSnapshot({
      environment: {},
      harness: { request: vi.fn(), workerRuntimeEnv: localEnvironment(overrides) },
      operatorHomeRoot: "/unused/operator-home",
      userId,
      vaultRoot: "/unused/vault",
    })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(testkit.createDeps).not.toHaveBeenCalled();
  });

  it("stops before reading keys or uploading if workspace provisioning fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const request = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    testkit.ensureWorkspace.mockRejectedValueOnce(new Error("workspace provisioning failed"));
    await expect(uploadHostedLocalWorkspaceSnapshot({
      environment: {},
      harness: { request, workerRuntimeEnv: localEnvironment() },
      operatorHomeRoot: "/unused/operator-home",
      userId,
      vaultRoot: "/unused/vault",
    })).rejects.toThrow("workspace provisioning failed");
    expect(testkit.disconnect).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not publish a locator after an object upload failure", async () => {
    const fixture = await createFixture();
    const envelope = await createSignedRuntimeEnvelope();
    const request = vi.fn();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH
        ? Response.json({ envelopes: { runtime: envelope }, schema: "murph.hosted-runtime-crypto-context.v1", userId })
        : new Response(null, { status: 503 })
    ));
    await expect(uploadHostedLocalWorkspaceSnapshot({
      ...fixture,
      harness: { request, workerRuntimeEnv: localEnvironment() },
      userId,
    })).rejects.toThrow("Snapshot fixture upload failed with HTTP 503.");
    expect(request).not.toHaveBeenCalled();
  });
});

function localEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return createHostedExecutionTestEnv({
    HOSTED_WEB_BASE_URL: "http://127.0.0.1:3100",
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "synthetic-access-key",
    HOSTED_R2_PRESIGN_ACCOUNT_ID: "fixture-account",
    HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
    HOSTED_R2_PRESIGN_BUCKET_NAME: "fixture-bucket",
    HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9100",
    HOSTED_R2_PRESIGN_ENDPOINT: "http://127.0.0.1:9100",
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "synthetic-secret-key",
    MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    NODE_ENV: "test",
    ...overrides,
  });
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "snapshot-fixture-proof-"));
  paths.push(root);
  const vaultRoot = path.join(root, "durable", "vault");
  const operatorHomeRoot = path.join(root, "durable", "operator-home");
  await mkdir(operatorHomeRoot, { recursive: true });
  await initializeVault({ createdAt: "2026-09-01T00:00:00.000Z", vaultRoot });
  await writeFile(path.join(vaultRoot, "fixture-note.md"), "Synthetic canonical fixture note.\n");
  return { environment: { NODE_ENV: "test" }, operatorHomeRoot, root, vaultRoot };
}

async function createSignedRuntimeEnvelope() {
  const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext: buildHostedDomainRootWrapContext({
      domain: "runtime", env: "test", recipient: "cloudflare-automation-secret", rootKeyId, userId,
    }),
    recipient: "cloudflare-automation-secret",
    recipientKeyId: TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    recipientPublicJwk: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    rootKey,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: "2026-09-01T00:00:00.000Z",
    domain: "runtime",
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: "2026-09-01T00:00:00.000Z",
    userId,
    wraps: [wrap],
  };
  const signer = await crypto.subtle.importKey(
    "jwk", { ...TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK, key_ops: ["sign"] },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signer,
    new Uint8Array(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  return attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    signature: Buffer.from(signature).toString("base64"),
    signedAt: body.updatedAt,
  });
}
