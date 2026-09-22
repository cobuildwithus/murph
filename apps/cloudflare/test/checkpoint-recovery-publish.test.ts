import { createHash } from "node:crypto";
import { HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES } from "@murphai/hosted-execution/browser-vault";
import { RECOVERY_REPLICA_ENVELOPE_MAX_BYTES } from "../scripts/checkpoint-recovery-replica.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { parseHostedCheckpointRecoveryRequest, HOSTED_CHECKPOINT_RECOVERY_PATH } from "@murphai/hosted-execution/runtime-resources";
import { publishPartialCheckpointRecovery } from "../scripts/checkpoint-recovery-publish.ts";
import { sealRecoveryAssessmentRequest } from "../scripts/checkpoint-recovery-envelope.ts";
import type { withPartialRecoverySnapshot } from "../scripts/checkpoint-recovery-snapshot.ts";
import { createHostedBrowserVaultReplicaStore } from "../src/browser-vault-store.ts";
import { verifyHostedWebCallbackSignatureHeaders } from "../src/web-callback-auth.ts";
import { createSyntheticBrowserVaultReplica } from "./fixtures/browser-vault-replica.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";
import { createTestHostedRuntimeCryptoContext, getTestHostedRuntimeRootKey } from "./hosted-runtime-crypto-fixtures.ts";
import { TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK, TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION, TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID } from "./hosted-execution-fixtures.ts";

const builder = vi.hoisted(() => vi.fn());
vi.mock("../scripts/checkpoint-recovery-snapshot.ts", () => ({ withPartialRecoverySnapshot: builder }));
const scratch: string[] = [];
afterEach(async () => { for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture(mode: "prepare-partial" | "recover-partial", rows = 4) {
  const userId = "synthetic-recovery-member";
  const rootKeyId = "udrk:runtime:test-root";
  const privateJwk = JSON.stringify(TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK);
  const context = await createTestHostedRuntimeCryptoContext(userId);
  const bucket = new MemoryEncryptedR2Bucket();
  const replica = createSyntheticBrowserVaultReplica(rows);
  const replicaRef = await createHostedBrowserVaultReplicaStore({ bucket, userId, rootKeyId,
    rootKey: getTestHostedRuntimeRootKey("runtime") }).writeBrowserVaultReplica({ replica, userId });
  const snapshotId = "synthetic-existing";
  const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId });
  const encrypted = Buffer.from("synthetic-encrypted-candidate");
  const source = parseHostedWorkspaceSnapshotV2Ref({ schema: "murph.hosted-workspace-snapshot.v2", userId, snapshotId, objectKey,
    createdAt: new Date().toISOString(), upload: "direct-r2-presigned-put",
    archive: { compression: "zstd", format: "tar", encryptedByteSize: encrypted.byteLength, encryptedObjectSha256: createHash("sha256").update(encrypted).digest("hex"),
      plaintextArchiveSha256: "b".repeat(64), fileCount: 5, totalPlainBytes: 256 },
    encryption: { scheme: "murph.hosted-workspace-snapshot-single-object.v1", rootKeyId, ivBase64: Buffer.alloc(12).toString("base64url"), wrappedDataKey: "synthetic",
      aad: { schema: "murph.hosted-workspace-snapshot.v2", purpose: "workspace-snapshot", userId, snapshotId, objectKey } } });
  const replacementId = "synthetic-replacement";
  const replacementKey = await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId: replacementId });
  const replacement = parseHostedWorkspaceSnapshotV2Ref({ ...source, snapshotId: replacementId, objectKey: replacementKey,
    encryption: { ...source.encryption, aad: { ...source.encryption.aad, snapshotId: replacementId, objectKey: replacementKey } } });
  const directory = await mkdtemp(path.join(tmpdir(), "synthetic-recovery-publish-"));
  scratch.push(directory);
  const encryptedFilePath = path.join(directory, "candidate.enc");
  await writeFile(encryptedFilePath, encrypted);
  builder.mockReset();
  builder.mockImplementation(async (input: Parameters<typeof withPartialRecoverySnapshot>[0]) => {
    expect(Buffer.from(input.rebuild.sourceBytes).equals(Buffer.from(JSON.stringify(replica)))).toBe(true);
    expect(input.rebuild.completedOnboarding).toBe(true);
    expect(input.rootKey).toEqual(getTestHostedRuntimeRootKey("runtime"));
    for await (const bytes of input.sourceEncryptedStream) expect(bytes).toEqual(encrypted);
    return input.useCandidate({ ref: replacement, encryptedFilePath,
      summary: { validVault: true, recoveredSourceBytes: 100, onboardingCompleted: true,
        coverage: { entities: 1, entitiesByFamily: { journal: 1 }, entitiesWithBodyPreviews: 1, metricRows: 4, labResultRows: 2,
          assistantSummaryHighlights: 0, experimentOnboardingCaptures: 0, completeFileBackup: false, restorationPerformed: false },
        originalFilesRestored: false, restorationPerformed: false, archiveValidated: true, preservedFiles: 1 } });
  });
  const operations: string[] = [];
  let published = false;
  let changed = false;
  let corrupt = false;
  let reads = 0;
  let oversizedEnvelope = false;
  const fetchImpl: typeof fetch = async (url, init) => {
    const target = new URL(String(url));
    if (target.origin === "https://www.withmurph.ai") {
      expect(await verifyHostedWebCallbackSignatureHeaders({ environment: { keyId: "test", privateKeyJwkJson: privateJwk },
        method: init?.method ?? "GET", nonceStore: { consume: async () => true }, path: target.pathname, search: target.search,
        payload: String(init?.body ?? ""), request: new Request(target, init), userId })).toBe(true);
      if (target.pathname.endsWith("/crypto-context/root")) return Response.json({
        schema: "murph.hosted-runtime-crypto-root.v1", userId, domain: "runtime", rootKeyId, envelope: context.envelopes.runtime });
      if (target.pathname === HOSTED_CHECKPOINT_RECOVERY_PATH) {
        const request = parseHostedCheckpointRecoveryRequest(JSON.parse(String(init?.body)));
        operations.push(request.operation);
        if (request.operation === "publish") published = true;
        return Response.json({ ok: true });
      }
      reads++;
      return Response.json({ fetchedAt: new Date().toISOString(), workspace: { userId,
        version: published || changed && reads > 1 ? "8" : "7", createdAt: replica.generatedAt, updatedAt: replica.generatedAt,
        snapshotRef: published ? replacement : source, browserVaultReplicaRef: replicaRef } });
    }
    expect(target.origin).toBe(`https://${"a".repeat(32)}.r2.cloudflarestorage.com`);
    expect(target.searchParams.get("X-Amz-Expires")).toBe("60");
    if (init?.method === "PUT") {
      operations.push("upload");
      expect(new Headers(init.headers).get("if-none-match")).toBe("*");
      expect(init.body).toEqual(new Uint8Array(encrypted));
      return new Response(null, { status: 200 });
    }
    const key = target.pathname.slice("/synthetic-bucket/".length);
    if (key === source.objectKey) return new Response(encrypted);
    if (key === replacement.objectKey) { operations.push("verify-upload"); return new Response(corrupt ? "bad" : encrypted); }
    if (oversizedEnvelope) return new Response("", { headers: { "content-length": String(RECOVERY_REPLICA_ENVELOPE_MAX_BYTES + 1) } });
    const object = await bucket.get(key);
    if (!object) throw new Error("Unexpected synthetic object");
    return new Response(await object.arrayBuffer());
  };
  const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "cobuildwithus/murph-cloud", GITHUB_REF: "refs/heads/main",
    RECOVERY_PROTECTED_ENVIRONMENT: "production", RECOVERY_MODE: mode,
    RECOVERY_SEALED_REQUEST: sealRecoveryAssessmentRequest({ schema: "murph.checkpoint-recovery-assessment.v1", userId,
      expectedWorkspaceVersion: "7", before: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      partialRecovery: { timezone: "UTC", completedOnboarding: true } }, TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK),
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CF_BUNDLES_ENAM_BUCKET: "synthetic-bucket",
    HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "test", HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: privateJwk,
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "synthetic-access", HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "synthetic-secret",
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: privateJwk, HOSTED_CRYPTO_ENV: "test" };
  return { env, fetchImpl, operations, oversizeEnvelope: () => { oversizedEnvelope = true; },
    oversizePlaintextReference: () => { replicaRef.byteLength = HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES + 1; }, changeWorkspace: () => { changed = true; }, corruptUpload: () => { corrupt = true; } };
}

it("prepares with no storage or runtime mutation", async () => {
  const f = await fixture("prepare-partial");
  expect(await publishPartialCheckpointRecovery(f.env, f.fetchImpl)).toMatchObject({ restorationPerformed: false, workspaceUnchanged: true });
  expect(f.operations).toEqual([]);
});
it("stages, uploads immutable bytes, verifies the upload, publishes, and reads back with bound signatures", async () => {
  const f = await fixture("recover-partial");
  expect(await publishPartialCheckpointRecovery(f.env, f.fetchImpl)).toMatchObject({ restorationPerformed: true, runtimeProgressVerified: false });
  expect(f.operations).toEqual(["stage", "upload", "verify-upload", "publish"]);
});
it("never publishes a changed source or corrupted upload", async () => {
  const f = await fixture("recover-partial");
  f.changeWorkspace();
  await expect(publishPartialCheckpointRecovery(f.env, f.fetchImpl)).rejects.toThrow("recovery_workspace_changed");
  expect(f.operations).toEqual([]);
  const other = await fixture("recover-partial");
  other.corruptUpload();
  await expect(publishPartialCheckpointRecovery(other.env, other.fetchImpl)).rejects.toThrow("upload_verification_failed");
  expect(other.operations).toEqual(["stage", "upload", "verify-upload"]);
});
it("refuses local recovery before touching a credential or network", async () => {
  const fetchImpl = vi.fn();
  await expect(publishPartialCheckpointRecovery({}, fetchImpl)).rejects.toThrow("hosted_recovery_boundary_required");
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("prepares a supported 28-MiB replica through the bounded encrypted response reader", async () => {
  const f = await fixture("prepare-partial", 25_000);
  expect(await publishPartialCheckpointRecovery(f.env, f.fetchImpl)).toMatchObject({ restorationPerformed: false, workspaceUnchanged: true });
  expect(f.operations).toEqual([]);
});

it("rejects oversized encrypted responses and plaintext references before rebuilding", async () => {
  for (const boundary of ["envelope", "plaintext"] as const) {
    const f = await fixture("prepare-partial");
    if (boundary === "envelope") f.oversizeEnvelope(); else f.oversizePlaintextReference();
    await expect(publishPartialCheckpointRecovery(f.env, f.fetchImpl)).rejects.toThrow();
    expect(builder).not.toHaveBeenCalled();
    expect(f.operations).toEqual([]);
  }
});
