import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import { HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH } from "@murphai/hosted-execution/routes";
import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  createHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  wrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
} from "@murphai/runtime-state";
import { collectHostedWorkspaceSnapshotArchivePlan } from "@murphai/runtime-state/node";

import { clearHostedRuntimeCryptoContextEnvelopeCacheForTests } from "../../src/hosted-crypto/runtime-user-crypto-context.ts";
import { hostedWorkspaceSnapshotObjectKey } from "../../src/storage-paths.ts";
import { createEncryptedWorkspaceSnapshotFile } from "../../src/workspace-snapshot-local.ts";
import {
  createHostedExecutionTestEnv,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
} from "../hosted-execution-fixtures.ts";
import { withHostedLocalWorkspaceSnapshot } from "./hosted-local-workspace-snapshot-restore.ts";

const userId = "member_snapshot_reader_fixture";
const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rootKeyId = "udrk:runtime:snapshot-reader-fixture";
const createdAt = "2026-09-01T00:00:00.000Z";
const protectedFiles = {
  "bank/experiments/fixture.md": "Synthetic experiment baseline.\n",
  "bank/goals/fixture.md": "Synthetic goal baseline.\n",
  "bank/automations/fixture.md": "Synthetic automation baseline.\n",
};
const paths: string[] = [];
let fixture: Awaited<ReturnType<typeof createSnapshotFixture>>;
let envelope: Awaited<ReturnType<typeof createSignedRuntimeEnvelope>>;

beforeAll(async () => {
  [fixture, envelope] = await Promise.all([
    createSnapshotFixture(),
    createSignedRuntimeEnvelope(),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
});

afterAll(async () => {
  await Promise.all(paths.splice(0).map((entry) => rm(entry, { force: true, recursive: true })));
});

describe("hosted-local committed v2 snapshot inspection", () => {
  it("unwraps and restores protected files from the control endpoint and observes changed content", async () => {
    const fetchImpl = mockSnapshotDownload(fixture);
    let restoredVaultRoot = "";
    const baseline = await withHostedLocalWorkspaceSnapshot({
      harness: { workerRuntimeEnv: localEnvironment() },
      read: async ({ vaultRoot }) => {
        restoredVaultRoot = vaultRoot;
        expect(await readFile(path.join(vaultRoot, "vault.json"), "utf8"))
          .toBe(await readFile(path.join(fixture.vaultRoot, "vault.json"), "utf8"));
        return readProtectedFiles(vaultRoot);
      },
      status: createStatus(),
      userId,
    });
    expect(baseline).toEqual(protectedFiles);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(restoredVaultRoot).not.toBe("");
    await expect(access(path.dirname(path.dirname(restoredVaultRoot))))
      .rejects.toMatchObject({ code: "ENOENT" });

    const changedFiles = { ...protectedFiles, "bank/automations/fixture.md": "Synthetic changed automation.\n" };
    const changed = await createSnapshotFixture({ files: changedFiles });
    mockSnapshotDownload(changed);
    const actualChanged = await withHostedLocalWorkspaceSnapshot({
      harness: { workerRuntimeEnv: localEnvironment() },
      read: ({ vaultRoot }) => readProtectedFiles(vaultRoot),
      status: createStatus(changed.ref),
      userId,
    });
    expect(actualChanged).toEqual(changedFiles);
    expect(actualChanged).not.toEqual(baseline);
  });

  it("accepts an empty protected-file set only after restoring a valid canonical vault", async () => {
    const empty = await createSnapshotFixture({ files: {} });
    mockSnapshotDownload(empty);
    const read = vi.fn(async ({ vaultRoot }: { vaultRoot: string }) => {
      expect(await readFile(path.join(vaultRoot, "vault.json"), "utf8"))
        .toBe(await readFile(path.join(empty.vaultRoot, "vault.json"), "utf8"));
      return (await readdir(path.join(vaultRoot, "bank"), { recursive: true }))
        .filter((entry) => entry.endsWith("fixture.md"));
    });
    await expect(withHostedLocalWorkspaceSnapshot({
      harness: { workerRuntimeEnv: localEnvironment() },
      read,
      status: createStatus(empty.ref),
      userId,
    })).resolves.toEqual([]);
    expect(read).toHaveBeenCalledOnce();
  });

  it.each(["missing workspace", "missing ref", "legacy ref", "malformed v2 ref"])(
    "rejects %s before HTTP or inspection",
    async (kind) => {
      const status: HostedRunnerStatusResponse = createStatus();
      if (kind === "missing workspace") status.workspace = null;
      if (kind === "missing ref") status.workspace = createStatus(null).workspace;
      if (kind === "legacy ref") {
        status.workspace = createStatus({
          hash: "a".repeat(64), key: "snapshot/legacy-fixture", size: 128, updatedAt: createdAt,
        }).workspace;
      }
      if (kind === "malformed v2 ref") {
        status.workspace = createStatus({
          ...fixture.ref,
          encryption: { ...fixture.ref.encryption, ivBase64: "invalid-iv" },
        }).workspace;
      }
      const fetchImpl = vi.fn<typeof fetch>();
      const read = vi.fn();
      vi.stubGlobal("fetch", fetchImpl);
      await expect(withHostedLocalWorkspaceSnapshot({
        harness: { workerRuntimeEnv: localEnvironment() }, read, status, userId,
      })).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(["requested member", "status member", "workspace member", "snapshot member"])(
    "rejects a mismatched %s before HTTP or inspection",
    async (kind) => {
      const status = createStatus();
      const otherUserId = "member_other_snapshot_fixture";
      if (kind === "status member") status.userId = otherUserId;
      if (kind === "workspace member") status.workspace.userId = otherUserId;
      if (kind === "snapshot member") {
        status.workspace.snapshotRef = {
          ...fixture.ref,
          userId: otherUserId,
          encryption: {
            ...fixture.ref.encryption,
            aad: { ...fixture.ref.encryption.aad, userId: otherUserId },
          },
        };
      }
      const fetchImpl = vi.fn<typeof fetch>();
      const read = vi.fn();
      vi.stubGlobal("fetch", fetchImpl);
      await expect(withHostedLocalWorkspaceSnapshot({
        harness: { workerRuntimeEnv: localEnvironment() },
        read,
        status,
        userId: kind === "requested member" ? otherUserId : userId,
      })).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    { HOSTED_WEB_BASE_URL: "https://web.example.test" },
    { HOSTED_WEB_BASE_URL: "http://synthetic:credential@127.0.0.1:3100" },
    { HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "0" },
    { HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: undefined },
    { HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "https://objects.example.test" },
    { HOSTED_R2_PRESIGN_ENDPOINT: "https://objects.example.test" },
    { HOSTED_CRYPTO_ENV: "production" },
    { NODE_ENV: "production" },
    { MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: "172.17.0.2" },
  ])("rejects non-local environments before HTTP or inspection", async (overrides) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const read = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(withHostedLocalWorkspaceSnapshot({
      harness: { workerRuntimeEnv: localEnvironment(overrides) },
      read,
      status: createStatus(),
      userId,
    })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects an absent Worker environment before HTTP or inspection", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const read = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(withHostedLocalWorkspaceSnapshot({
      harness: { workerRuntimeEnv: null }, read, status: createStatus(), userId,
    })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects corrupted authenticated ciphertext before inspecting plaintext", async () => {
    const bytes = new Uint8Array(fixture.bytes);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    // Keep the transport digest consistent so authenticated decryption must reject the altered tag.
    const ref = {
      ...fixture.ref,
      archive: {
        ...fixture.ref.archive,
        encryptedObjectSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
    mockSnapshotDownload({ ...fixture, bytes, ref });
    const read = vi.fn();
    await expect(withHostedLocalWorkspaceSnapshot({
      harness: { workerRuntimeEnv: localEnvironment() }, read, status: createStatus(ref), userId,
    })).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["missing", "invalid"] as const)(
    "rejects %s canonical vault metadata before inspection",
    async (metadata) => {
      const invalid = await createSnapshotFixture({ metadata });
      mockSnapshotDownload(invalid);
      const read = vi.fn();
      await expect(withHostedLocalWorkspaceSnapshot({
        harness: { workerRuntimeEnv: localEnvironment() },
        read,
        status: createStatus(invalid.ref),
        userId,
      })).rejects.toThrow();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("propagates the reader failure and removes its entire temporary workspace", async () => {
    mockSnapshotDownload(fixture);
    const failure = new Error("Synthetic snapshot assertion failed.");
    let temporaryRoot = "";
    await expect(withHostedLocalWorkspaceSnapshot({
      harness: { workerRuntimeEnv: localEnvironment() },
      read: async ({ vaultRoot }) => {
        temporaryRoot = path.dirname(path.dirname(vaultRoot));
        expect(await readProtectedFiles(vaultRoot)).toEqual(protectedFiles);
        throw failure;
      },
      status: createStatus(),
      userId,
    })).rejects.toBe(failure);
    expect(temporaryRoot).not.toBe("");
    await expect(access(temporaryRoot)).rejects.toMatchObject({ code: "ENOENT" });
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
    HOSTED_R2_PRESIGN_ENDPOINT: "http://172.17.0.1:9100",
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "synthetic-secret-key",
    MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: "172.17.0.1",
    NODE_ENV: "test",
    ...overrides,
  });
}

function createStatus(
  snapshotRef: NonNullable<HostedRunnerStatusResponse["workspace"]>["snapshotRef"] = fixture.ref,
) {
  return {
    inFlight: false,
    mailboxLag: [],
    userId,
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: createdAt,
      createdAt,
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef,
      updatedAt: createdAt,
      userId,
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
}

async function readProtectedFiles(vaultRoot: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.keys(protectedFiles).map(async (relativePath) => [
    relativePath,
    await readFile(path.join(vaultRoot, relativePath), "utf8"),
  ])));
}

function mockSnapshotDownload(input: { bytes: Uint8Array; ref: HostedWorkspaceSnapshotV2Ref }) {
  const fetchImpl = vi.fn<typeof fetch>(async (resource, init) => {
    const request = new Request(resource, init);
    const url = new URL(request.url);
    if (url.pathname === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH) {
      expect(url.origin).toBe("http://127.0.0.1:3100");
      expect(request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(userId);
      expect(request.headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
      return Response.json({
        envelopes: { runtime: envelope },
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId,
      });
    }
    expect(request.method).toBe("GET");
    // The reader runs on the host; the container-facing endpoint is deliberately different.
    expect(url.origin).toBe("http://127.0.0.1:9100");
    expect(decodeURIComponent(url.pathname)).toBe(`/fixture-bucket/${input.ref.objectKey}`);
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const midpoint = Math.floor(input.bytes.length / 2);
        controller.enqueue(input.bytes.slice(0, midpoint));
        controller.enqueue(input.bytes.slice(midpoint));
        controller.close();
      },
    }));
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

async function createSnapshotFixture(input: {
  files?: Readonly<Record<string, string>>;
  metadata?: "missing" | "invalid";
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "snapshot-reader-proof-"));
  paths.push(root);
  const durableRoot = path.join(root, "durable");
  const vaultRoot = path.join(durableRoot, "vault");
  const operatorHomeRoot = path.join(durableRoot, "operator-home");
  await mkdir(operatorHomeRoot, { recursive: true });
  await initializeVault({ createdAt, vaultRoot });
  for (const [relativePath, content] of Object.entries(input.files ?? protectedFiles)) {
    const target = path.join(vaultRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (input.metadata === "missing") await rm(path.join(vaultRoot, "vault.json"));
  if (input.metadata === "invalid") await writeFile(path.join(vaultRoot, "vault.json"), "{}\n");
  const snapshotId = `snapshot-${randomUUID()}`;
  const objectKey = await hostedWorkspaceSnapshotObjectKey({ snapshotId, userId });
  const aad = buildHostedWorkspaceSnapshotV2Aad({ objectKey, snapshotId, userId });
  const dataKey = createHostedWorkspaceSnapshotV2DataKey();
  try {
    const wrappedDataKey = await wrapHostedWorkspaceSnapshotV2DataKey({
      aad, dataKey, rootKey, rootKeyId,
    });
    const plan = await collectHostedWorkspaceSnapshotArchivePlan({
      durableRoot, operatorHomeRoot, vaultRoot,
    });
    const encrypted = await createEncryptedWorkspaceSnapshotFile({
      aad,
      archiveEntries: plan.entries,
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
      durableRoot,
      ivBase64: randomBytes(12).toString("base64url"),
      maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      outputDir: path.join(root, "encrypted"),
    });
    const ref: HostedWorkspaceSnapshotV2Ref = {
      archive: {
        compression: encrypted.compression,
        encryptedByteSize: encrypted.encryptedByteSize,
        encryptedObjectSha256: encrypted.encryptedObjectSha256,
        fileCount: encrypted.fileCount,
        format: "tar",
        plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
        totalPlainBytes: encrypted.totalPlainBytes,
      },
      createdAt,
      encryption: {
        aad,
        ivBase64: encrypted.ivBase64,
        rootKeyId,
        scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
        wrappedDataKey,
      },
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      snapshotId,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
      userId,
    };
    return { bytes: new Uint8Array(await readFile(encrypted.encryptedFilePath)), ref, vaultRoot };
  } finally {
    dataKey.fill(0);
  }
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
    createdAt,
    domain: "runtime",
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: createdAt,
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
