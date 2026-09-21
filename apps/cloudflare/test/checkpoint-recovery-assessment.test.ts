import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { HostedCanonicalWriteReceipt } from "@murphai/core";
import {
  HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION_QUERY, isHostedCustomInferenceConsumerVersion,
} from "@murphai/hosted-execution/assistant-inference";
import { buildHostedStorageAad, encryptHostedStoragePayload } from "@murphai/runtime-state";
import { hostedArtifactObjectKey } from "@murphai/hosted-execution/storage-paths";
import {
  authenticateUnindexedArtifact, openRecoveryAssessmentRequest, recoveryPublicJwk,
  sealRecoveryAssessmentRequest, type RecoveryAssessmentRequest,
} from "../scripts/checkpoint-recovery-envelope.ts";
import { assessCheckpointRecovery, inspectReceiptCandidate, readArtifactInventory, readRecoveryResponse } from "../scripts/checkpoint-recovery-assessment.ts";
import { verifyHostedWebCallbackSignatureHeaders } from "../src/web-callback-auth.ts";
import { createTestHostedRuntimeCryptoContext, getTestHostedRuntimeRootKey } from "./hosted-runtime-crypto-fixtures.ts";
import {
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK, TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION, TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
} from "./hosted-execution-fixtures.ts";

const userId = "synthetic-recovery-member";
const now = Date.now();
const request: RecoveryAssessmentRequest = {
  schema: "murph.checkpoint-recovery-assessment.v1", userId,
  expectedWorkspaceVersion: "7", before: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 30 * 60_000).toISOString(),
};
const privateJwk = JSON.stringify(TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK);
const rootKeyId = "udrk:runtime:test-root";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

async function artifact(value: Uint8Array, aadUser = userId) {
  const sha256 = createHash("sha256").update(value).digest("hex");
  const objectKey = await hostedArtifactObjectKey({ userId, sha256 });
  const envelope = await encryptHostedStoragePayload({
    key: getTestHostedRuntimeRootKey("runtime"), keyId: rootKeyId, scope: "artifact", plaintext: value,
    aad: buildHostedStorageAad({ key: objectKey, purpose: "artifact", sha256, userId: aadUser }),
  });
  return { envelope, objectKey, sha256, serialized: encode(envelope) };
}

describe("hosted recovery request boundary", () => {
  it("seals the selector and exposes only the recipient public key", () => {
    const publicJwk = recoveryPublicJwk(privateJwk);
    expect(publicJwk.d).toBeUndefined();
    const sealed = sealRecoveryAssessmentRequest(request, publicJwk);
    expect(Buffer.from(sealed, "base64url").toString()).not.toContain(userId);
    expect(openRecoveryAssessmentRequest(sealed, privateJwk, now)).toEqual(request);
  });
  it("rejects expired, overlong-lived, tampered, or incorrectly addressed requests", () => {
    const sealed = sealRecoveryAssessmentRequest(request, TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK);
    expect(() => openRecoveryAssessmentRequest(sealed, privateJwk, now + 31 * 60_000)).toThrow();
    expect(() => openRecoveryAssessmentRequest(sealed, privateJwk, now - 61 * 60_000)).toThrow();
    const envelope = JSON.parse(Buffer.from(sealed, "base64url").toString());
    const bytes = Buffer.from(envelope.ciphertext, "base64url"); bytes[0] ^= 1;
    envelope.ciphertext = bytes.toString("base64url");
    expect(() => openRecoveryAssessmentRequest(encode(envelope).toString("base64url"), privateJwk, now)).toThrow();
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(() => openRecoveryAssessmentRequest(sealed, JSON.stringify(other.privateKey.export({ format: "jwk" })), now)).toThrow();
  });
  it("rejects local execution before network or key access", async () => {
    const fetchImpl = vi.fn();
    await expect(assessCheckpointRecovery({}, fetchImpl)).rejects.toThrow("hosted_recovery_boundary_required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("unindexed artifact authentication", () => {
  it("recovers the hidden hash and verifies the canonical envelope before returning bytes", async () => {
    const plaintext = Buffer.from("Synthetic saved note.\n");
    const input = await artifact(plaintext);
    const result = await authenticateUnindexedArtifact({ ...input, rootKey: getTestHostedRuntimeRootKey("runtime"), userId });
    expect(result.sha256).toBe(input.sha256);
    expect(Buffer.from(result.plaintext)).toEqual(plaintext);
  });
  it("rejects a bad authentication tag even when provisional plaintext and path match", async () => {
    const input = await artifact(Buffer.from("Synthetic saved note.\n"));
    const ciphertext = Buffer.from(input.envelope.ciphertext, "base64"); ciphertext[ciphertext.length - 1] ^= 1;
    input.envelope.ciphertext = ciphertext.toString("base64");
    await expect(authenticateUnindexedArtifact({ ...input, serialized: encode(input.envelope), rootKey: getTestHostedRuntimeRootKey("runtime"), userId })).rejects.toThrow();
  });
  it("rejects mismatched AAD, member, path, and root", async () => {
    const input = await artifact(Buffer.from("Synthetic saved note.\n"));
    for (const overrides of [
      { userId: "another-synthetic-member" }, { objectKey: input.objectKey.replace(".artifact.bin", ".other") },
      { rootKey: new Uint8Array(32) },
    ]) {
      await expect(authenticateUnindexedArtifact({ ...input, rootKey: getTestHostedRuntimeRootKey("runtime"), userId, ...overrides })).rejects.toThrow();
    }
    const wrongAad = await artifact(Buffer.from("Synthetic saved note.\n"), "another-synthetic-member");
    await expect(authenticateUnindexedArtifact({ ...wrongAad, rootKey: getTestHostedRuntimeRootKey("runtime"), userId })).rejects.toThrow();
  });
});

describe("bounded recovery census", () => {
  it("charges concurrent streams against one total byte budget", async () => {
    const budget = { bytes: 512 * 1024 * 1024 - 3 };
    const results = await Promise.allSettled([
      readRecoveryResponse(new Response("aa"), 32, budget),
      readRecoveryResponse(new Response("bb"), 32, budget),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(budget.bytes).toBe(512 * 1024 * 1024 - 1);
  });
  it("reads artifacts in waves of eight and wipes a wave when its consumer exits", async () => {
    const prefix = "users/synthetic/artifacts/";
    const keys = Array.from({ length: 9 }, (_, index) => `${prefix}${String(index).padStart(48, "0")}.artifact.bin`);
    let active = 0;
    let maximum = 0;
    let finished = 0;
    const stats = { objects: 0, bytes: 0 };
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("?")) return Response.json({ success: true, result: keys.map((key) => ({ key })), result_info: {} });
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      finished++;
      return new Response("abc");
    };
    const inventory = readArtifactInventory({ api: "https://storage.invalid/objects", prefix, token: "synthetic", fetchImpl, readObject: (key) => fetchImpl(`https://storage.invalid/objects/${key}`), stats });
    const first = await inventory.next();
    expect(first.done).toBe(false);
    if (first.done) throw new Error("missing synthetic artifact");
    expect(Buffer.from(first.value.serialized).toString()).toBe("abc");
    expect(maximum).toBe(8);
    expect(finished).toBe(8);
    expect(active).toBe(0);
    await inventory.return(undefined);
    expect([...first.value.serialized]).toEqual([0, 0, 0]);
    expect(stats).toEqual({ objects: 8, bytes: 24 });

    const collected: string[] = [];
    for await (const item of readArtifactInventory({ api: "https://storage.invalid/objects", prefix, token: "synthetic", fetchImpl, readObject: (key) => fetchImpl(`https://storage.invalid/objects/${key}`), stats: { objects: 0, bytes: 0 } })) {
      collected.push(item.key);
    }
    expect(collected).toEqual(keys);
    expect(maximum).toBe(8);
  });
  it("settles failed waves without starting another wave", async () => {
    const prefix = "users/synthetic/artifacts/";
    const keys = Array.from({ length: 8 }, (_, index) => `${prefix}${String(index).padStart(48, "0")}.artifact.bin`);
    let started = 0;
    let finished = 0;
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("?")) return Response.json({ success: true, result: keys.map((key) => ({ key })), result_info: {} });
      started++;
      if (String(url).endsWith(keys[0]!)) throw new Error("synthetic read failed");
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished++;
      return new Response("abc");
    };
    const inventory = readArtifactInventory({ api: "https://storage.invalid/objects", prefix, token: "synthetic", fetchImpl, readObject: (key) => fetchImpl(`https://storage.invalid/objects/${key}`), stats: { objects: 0, bytes: 0 } });
    await expect(inventory.next()).rejects.toThrow("synthetic read failed");
    expect(started).toBe(8);
    expect(finished).toBe(7);
  });
  it("rejects oversized streams and invalid receipt paths", async () => {
    await expect(readRecoveryResponse(new Response("12345"), 4)).rejects.toThrow("recovery_read_limit_exceeded");
    const base = { schema: "murph.hosted-canonical-write-receipt.v1", committedAt: request.before };
    expect(inspectReceiptCandidate(encode({ ...base, actions: [{ kind: "text_upsert", targetRelativePath: "../outside" }] }), now)).toBeNull();
    expect(inspectReceiptCandidate(encode({ ...base, actions: [], committedAt: new Date(now + 1000).toISOString() }), now)).toBeNull();
  });
  it("composes signed member reads, root authentication, artifact inventory and a final version check without writes", async () => {
    const context = await createTestHostedRuntimeCryptoContext(userId);
    const payload = Buffer.from("Synthetic canonical content.");
    const content = await artifact(payload);
    const receipt = await artifact(encode({
      schema: "murph.hosted-canonical-write-receipt.v1", committedAt: request.before,
      operationId: "synthetic-operation", operationType: "synthetic-write", summary: "Synthetic recovery evidence",
      createdAt: request.before, updatedAt: request.before, occurredAt: request.before,
      actions: [
        { kind: "text_upsert", targetRelativePath: "bank/synthetic.md", sha256: content.sha256,
          byteLength: payload.byteLength, effect: "create", contentRef: { sha256: content.sha256, byteSize: payload.byteLength } },
        { kind: "raw_upsert", targetRelativePath: "raw/synthetic.txt", sha256: content.sha256,
          byteLength: payload.byteLength, mediaType: "text/plain", originalFileName: "synthetic.txt", effect: "copy",
          contentRef: { sha256: content.sha256, byteSize: payload.byteLength } },
        { kind: "jsonl_append", targetRelativePath: "bank/synthetic.jsonl", appendSha256: content.sha256,
          appendByteLength: payload.byteLength, baseSha256: "a".repeat(64), baseByteLength: 0, originalSize: 0,
          contentRef: { sha256: content.sha256, byteSize: payload.byteLength } },
        { kind: "text_upsert", targetRelativePath: "bank/missing.md", sha256: "b".repeat(64),
          byteLength: payload.byteLength, effect: "create", contentRef: { sha256: "b".repeat(64), byteSize: payload.byteLength } },
        { kind: "text_upsert", targetRelativePath: "bank/mismatched-size.md", sha256: content.sha256,
          byteLength: payload.byteLength + 1, effect: "create", contentRef: { sha256: content.sha256, byteSize: payload.byteLength + 1 } },
      ],
    } satisfies HostedCanonicalWriteReceipt));
    const objects = [content, receipt];
    let workspaceReads = 0;
    let workspaceVersion = "7";
    let foreignObject = false;
    let changeAtEnd = false;
    let objectReadStatus = 200;
    let abortReads: AbortController | undefined;
    const methods: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      methods.push(init?.method ?? "GET");
      const target = new URL(String(url));
      if (target.pathname === "/api/internal/hosted-workspace") {
        workspaceReads++;
        if (!isHostedCustomInferenceConsumerVersion(target.searchParams.get(HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION_QUERY))) {
          return Response.json({ error: { code: "HOSTED_CUSTOM_INFERENCE_CONSUMER_UNSUPPORTED" } }, { status: 409 });
        }
        const signedRequest = new Request(target, init);
        const verification = {
          environment: { keyId: "test", privateKeyJwkJson: privateJwk }, method: "GET",
          nonceStore: { consume: async () => true }, path: target.pathname, payload: "",
          request: signedRequest, userId,
        };
        expect(await verifyHostedWebCallbackSignatureHeaders({ ...verification, search: target.search })).toBe(true);
        expect(await verifyHostedWebCallbackSignatureHeaders({ ...verification, search: "" })).toBe(false);
        return Response.json({ fetchedAt: new Date(now).toISOString(), workspace: {
          userId, version: changeAtEnd && workspaceReads > 1 ? "8" : workspaceVersion, createdAt: request.before, updatedAt: request.before, snapshotRef: null,
        } });
      }
      if (target.pathname.endsWith("/crypto-context/root")) {
        expect(JSON.parse(String(init?.body))).toEqual({ domain: "runtime", rootKeyId });
        return Response.json({ schema: "murph.hosted-runtime-crypto-root.v1", userId, domain: "runtime", rootKeyId, envelope: context.envelopes.runtime });
      }
      if (target.searchParams.has("prefix")) return Response.json({ success: true, result: objects.map((object) => ({ key: foreignObject ? "users/foreign/artifacts/invalid" : object.objectKey })), result_info: {} });
      // Production reads use the existing S3 signer, never the rate-limited REST object GET.
      expect(target.host).toBe(`${"a".repeat(32)}.r2.cloudflarestorage.com`);
      expect(target.searchParams.get("X-Amz-Expires")).toBe("60");
      expect(target.searchParams.get("X-Amz-Credential")).toMatch(/^synthetic-access\//);
      expect(target.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      if (abortReads) {
        abortReads.abort(new Error("synthetic-private-object-error"));
        throw abortReads.signal.reason;
      }
      if (objectReadStatus !== 200) return new Response("synthetic-private-remote-body", { status: objectReadStatus });
      expect(target.pathname).not.toMatch(/%2f/i);
      const object = objects.find((item) => target.pathname === `/synthetic-bucket/${item.objectKey}`);
      if (!object) throw new Error("unexpected_synthetic_request");
      return new Response(Buffer.from(object.serialized));
    };
    const env = {
      GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "cobuildwithus/murph-cloud", GITHUB_REF: "refs/heads/main",
      RECOVERY_PROTECTED_ENVIRONMENT: "production", RECOVERY_MODE: "assess",
      RECOVERY_SEALED_REQUEST: sealRecoveryAssessmentRequest(request, TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK),
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "synthetic-token", CF_BUNDLES_ENAM_BUCKET: "synthetic-bucket",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "test", HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: privateJwk,
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "synthetic-access", HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "synthetic-secret",
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: privateJwk, HOSTED_CRYPTO_ENV: "test",
    };
    const reportProgress = vi.fn();
    const result = await assessCheckpointRecovery(env, fetchImpl, reportProgress);
    expect(result).toMatchObject({ objects: 2, authenticated: 2, unreadable: 0, receiptCandidatesBeforeCutoff: 1, candidatePaths: 5, contentReferences: 5, presentContentReferences: 3, appendActions: 1, acceptedHistoryProven: false, restorationPerformed: false });
    expect(workspaceReads).toBe(2);
    expect(methods.filter((method) => method === "POST")).toHaveLength(1);
    expect(methods.every((method) => method === "GET" || method === "POST")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(userId);
    expect(JSON.stringify(result)).not.toContain("synthetic.md");
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({ complete: false, stage: "scanning", objects: 0 }));
    workspaceVersion = "8";
    await expect(assessCheckpointRecovery(env, fetchImpl)).rejects.toThrow("recovery_workspace_changed");
    workspaceVersion = "7";
    foreignObject = true;
    await expect(assessCheckpointRecovery(env, fetchImpl)).rejects.toThrow("invalid_recovery_listing");
    foreignObject = false;
    workspaceReads = 0;
    changeAtEnd = true;
    await expect(assessCheckpointRecovery(env, fetchImpl, reportProgress)).rejects.toThrow("recovery_workspace_changed");
    expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      complete: false, stage: "failed", failure: "assessment_failed", objects: 2,
      authenticated: 2, unreadable: 0, rootLookupAttempts: 1, rootsResolved: 1,
    }));
    expect(JSON.stringify(reportProgress.mock.calls)).not.toContain(userId);
    expect(JSON.stringify(reportProgress.mock.calls)).not.toContain("synthetic.md");
    expect(JSON.stringify(reportProgress.mock.calls)).not.toContain(rootKeyId);
    changeAtEnd = false;
    objectReadStatus = 429;
    await expect(assessCheckpointRecovery(env, fetchImpl, reportProgress)).rejects.toThrow("recovery_remote_read_failed");
    expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: "failed", complete: false, failure: "remote_read", httpStatus: 429,
    }));

    objectReadStatus = 200;
    const timeout = AbortSignal.timeout;
    abortReads = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === 20 * 60_000 ? abortReads!.signal : timeout(ms));
    try {
      await expect(assessCheckpointRecovery(env, fetchImpl, reportProgress)).rejects.toThrow("synthetic-private-object-error");
      expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
        stage: "failed", complete: false, failure: "deadline", objects: 0,
      }));
    } finally { timeoutSpy.mockRestore(); abortReads = undefined; }
    expect(JSON.stringify(reportProgress.mock.calls)).not.toContain("synthetic-private");

    objects.push(...await Promise.all(Array.from({ length: 100 }, (_, index) => artifact(Buffer.from(`Synthetic historical payload ${index}`)))));
    reportProgress.mockClear();
    const largerResult = await assessCheckpointRecovery(env, fetchImpl, reportProgress);
    expect(largerResult).toMatchObject({ objects: 102, authenticated: 102, unreadable: 0 });
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      complete: false, stage: "scanning", authenticated: 100, rootLookupAttempts: 1, rootsResolved: 1,
    }));
    expect(reportProgress).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(reportProgress.mock.calls)).not.toContain("X-Amz");
    expect(JSON.stringify(reportProgress.mock.calls)).not.toContain("synthetic-access");
    expect(JSON.stringify(reportProgress.mock.calls)).not.toContain("synthetic-secret");
  });
});
