import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseHostedWorkspaceReadResponse, isHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { buildHostedWorkspaceSnapshotV2FingerprintSha256 as fingerprint, HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { fingerprintRecoveryReplica, HOSTED_CHECKPOINT_RECOVERY_PATH, type HostedCheckpointRecoveryRequest } from "@murphai/hosted-execution/runtime-resources";
import { HOSTED_RUNTIME_WORKSPACE_PATH } from "@murphai/hosted-execution/routes";
import { HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION, HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION_QUERY } from "@murphai/hosted-execution/assistant-inference";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { readHostedWebCallbackSigningEnvironment } from "../src/web-callback-auth.ts";
import { createHostedR2PresignedGetUrl, createHostedR2PresignedPutUrl } from "../src/r2-presigned-url.ts";
import { fetchHostedWorkerRuntimeRootByRootKeyId, type HostedWorkerCryptoEnv } from "../src/hosted-crypto/runtime-crypto-context.ts";
import { requireHostedRecoveryBoundary, readRecoveryResponse } from "./checkpoint-recovery-assessment.ts";
import { openRecoveryAssessmentRequest } from "./checkpoint-recovery-envelope.ts";
import { readRecoveryReplica, RECOVERY_REPLICA_ENVELOPE_MAX_BYTES } from "./checkpoint-recovery-replica.ts";
import { withPartialRecoverySnapshot } from "./checkpoint-recovery-snapshot.ts";

type Env = Readonly<Record<string, string | undefined>>;
function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error("missing_recovery_configuration");
  return value;
}

export async function publishPartialCheckpointRecovery(env: Env, fetchImpl: typeof fetch = fetch) {
  requireHostedRecoveryBoundary(env);
  if (env.RECOVERY_MODE !== "prepare-partial" && env.RECOVERY_MODE !== "recover-partial") throw new Error("invalid_recovery_mode");
  const privateJwk = required(env, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK");
  const request = openRecoveryAssessmentRequest(required(env, "RECOVERY_SEALED_REQUEST"), privateJwk);
  if (!request.partialRecovery) throw new Error("partial_recovery_instruction_required");
  const signal = AbortSignal.timeout(25 * 60_000);
  const boundedFetch: typeof fetch = (url, init) => fetchImpl(url, {
    ...init, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  const callbackSigning = readHostedWebCallbackSigningEnvironment(env);
  const base = { baseUrl: "https://www.withmurph.ai", boundUserId: request.userId,
    callbackSigning, timeoutMs: 30_000, fetchImpl: boundedFetch };
  async function readWorkspace() {
    const response = await fetchHostedExecutionWebControlPlaneResponse({ ...base, method: "GET", path: HOSTED_RUNTIME_WORKSPACE_PATH,
      search: new URLSearchParams({ [HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION_QUERY]: String(HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION) }).toString() });
    const value = parseHostedWorkspaceReadResponse(JSON.parse(Buffer.from(await readRecoveryResponse(response, 1024 * 1024)).toString("utf8")));
    if (!value.workspace || value.workspace.userId !== request.userId) throw new Error("recovery_workspace_unavailable");
    return value.workspace;
  }
  const workspace = await readWorkspace();
  const source = workspace.snapshotRef;
  const replicaRef = workspace.browserVaultReplicaRef;
  if (workspace.version !== request.expectedWorkspaceVersion || !isHostedWorkspaceSnapshotV2Ref(source) || !replicaRef) throw new Error("recovery_workspace_changed");
  const sourceSnapshotFingerprint = fingerprint(source);
  const sourceReplicaFingerprint = fingerprintRecoveryReplica(replicaRef);
  const account = required(env, "CLOUDFLARE_ACCOUNT_ID");
  const bucket = required(env, "CF_BUNDLES_ENAM_BUCKET");
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) throw new Error("invalid_recovery_storage");
  const environment = { accessKeyId: required(env, "HOSTED_R2_PRESIGN_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY"), bucketName: bucket,
    endpoint: `https://${account}.r2.cloudflarestorage.com` };
  async function readObject(key: string, maxBytes: number) {
    const signed = await createHostedR2PresignedGetUrl({ environment, key, expiresSeconds: 60 });
    return readRecoveryResponse(await boundedFetch(signed.url), maxBytes);
  }
  const cryptoEnv: HostedWorkerCryptoEnv = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: required(env, "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION"),
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: required(env, "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM"),
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: env.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: required(env, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID"),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: privateJwk,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON: env.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON,
    HOSTED_CRYPTO_ENV: required(env, "HOSTED_CRYPTO_ENV"), NODE_ENV: "production",
  };
  const roots = new Map<string, Uint8Array>();
  async function root(rootKeyId: string) {
    const cached = roots.get(rootKeyId);
    if (cached) return cached;
    const resolved = await fetchHostedWorkerRuntimeRootByRootKeyId({ ...base, cryptoEnv, domain: "runtime", rootKeyId, userId: request.userId });
    roots.set(rootKeyId, resolved.rootKey);
    return resolved.rootKey;
  }
  let sourceBytes: Uint8Array | undefined;
  try {
    const recovered = await readRecoveryReplica({ userId: request.userId, ref: replicaRef, before: request.before,
      rootKey: await root(replicaRef.runtimeRootKeyId), rootKeyId: replicaRef.runtimeRootKeyId, signal,
      readObject: key => readObject(key, RECOVERY_REPLICA_ENVELOPE_MAX_BYTES) });
    sourceBytes = recovered.sourceBytes;
    const sourceObjectKey = source.objectKey;
    async function* sourceEncryptedStream() { yield await readObject(sourceObjectKey, HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES); }
    return await withPartialRecoverySnapshot({ userId: request.userId, source, sourceEncryptedStream: sourceEncryptedStream(),
      rootKey: await root(source.encryption.rootKeyId), rootKeyId: source.encryption.rootKeyId,
      rebuild: { ...recovered, ...request.partialRecovery, recoveredAt: new Date().toISOString(), signal },
      useCandidate: async candidate => {
        const current = await readWorkspace();
        if (Date.parse(request.expiresAt) <= Date.now() || current.version !== request.expectedWorkspaceVersion
          || !isHostedWorkspaceSnapshotV2Ref(current.snapshotRef) || fingerprint(current.snapshotRef) !== sourceSnapshotFingerprint
          || !current.browserVaultReplicaRef || fingerprintRecoveryReplica(current.browserVaultReplicaRef) !== sourceReplicaFingerprint) {
          throw new Error("recovery_workspace_changed");
        }
        if (env.RECOVERY_MODE === "prepare-partial") return { ...candidate.summary, workspaceUnchanged: true, restorationPerformed: false };
        async function publish(operation: HostedCheckpointRecoveryRequest["operation"]) {
          const body: HostedCheckpointRecoveryRequest = { operation, expectedWorkspaceVersion: request.expectedWorkspaceVersion,
            sourceSnapshotFingerprint, sourceReplicaFingerprint, replacement: candidate.ref };
          const response = await fetchHostedExecutionWebControlPlaneResponse({ ...base, method: "POST", path: HOSTED_CHECKPOINT_RECOVERY_PATH,
            body: JSON.stringify(body) });
          await readRecoveryResponse(response, 16 * 1024);
        }
        await publish("stage");
        const encrypted = await readFile(candidate.encryptedFilePath);
        const checksum = Buffer.from(candidate.ref.archive.encryptedObjectSha256, "hex").toString("base64");
        const put = await createHostedR2PresignedPutUrl({ environment, key: candidate.ref.objectKey, contentType: "application/octet-stream",
          checksumSha256Base64: checksum, expiresSeconds: 60 });
        // The immutable PUT and short URL lifetime both end well before the
        // staged orphan's 65-minute cleanup grace, including account deletion.
        const response = await boundedFetch(put.url, { method: "PUT", headers: {
          "Content-Type": "application/octet-stream", "If-None-Match": "*", "x-amz-checksum-sha256": checksum,
        }, body: new Uint8Array(encrypted) });
        await response.body?.cancel();
        if (!response.ok) throw new Error("recovery_candidate_upload_failed");
        const stored = await readObject(candidate.ref.objectKey, candidate.ref.archive.encryptedByteSize);
        if (stored.byteLength !== encrypted.byteLength || createHash("sha256").update(stored).digest("hex") !== candidate.ref.archive.encryptedObjectSha256) {
          throw new Error("recovery_candidate_upload_verification_failed");
        }
        if (Date.parse(request.expiresAt) <= Date.now()) throw new Error("recovery_request_expired");
        await publish("publish");
        const accepted = await readWorkspace();
        if (!isHostedWorkspaceSnapshotV2Ref(accepted.snapshotRef) || fingerprint(accepted.snapshotRef) !== fingerprint(candidate.ref)) {
          throw new Error("recovery_publication_readback_changed");
        }
        return { ...candidate.summary, workspaceUnchanged: false, restorationPerformed: true,
          originalFilesRestored: false, runtimeProgressVerified: false };
      } });
  } finally {
    sourceBytes?.fill(0);
    for (const bytes of roots.values()) bytes.fill(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await publishPartialCheckpointRecovery(process.env))); }
  catch {
    console.error(JSON.stringify({ ok: false, reason: "partial_checkpoint_recovery_failed", runtimeProgressVerified: false }));
    process.exitCode = 1;
  }
}
