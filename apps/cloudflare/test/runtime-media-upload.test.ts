import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";
import { abortRuntimeMultipartUpload } from "../src/runtime-object-upload.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeMediaWriteBucket } from "../src/runtime-media.ts";
import { publishPostgresRuntimePrivateMedia } from "../src/runtime-private-media.ts";
import { hostedMediaObjectKey } from "../src/storage-paths.ts";
import { createHostedMediaStore } from "../src/bundle-store.ts";
import * as resourceClient from "../src/runtime-resource-client.ts";
import * as ownerClient from "../src/runtime-owner-client.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const userId = "synthetic_upload_member";
const descriptor = { mediaId: "a".repeat(64), sha256: "b".repeat(64), mediaKind: "image" as const, byteSize: 4, expiresAt: null };
const identity = { userId, attemptId: "synthetic_attempt", generation: "7" };
function harness() {
  const events: string[] = [];
  const uploaded: string[] = [];
  const upload = { uploadId: "synthetic_upload_id", uploadPart: vi.fn(async (_part: number, value: unknown) => { events.push("part"); uploaded.push(String(value)); return { partNumber: 1, etag: "synthetic-etag" }; }),
    complete: vi.fn(async () => { events.push("complete"); }), abort: vi.fn(async () => { events.push("abort"); }) };
  const bucket = { get: async () => null, put: vi.fn(async () => {}), createMultipartUpload: async () => upload, resumeMultipartUpload: () => upload };
  const commands = vi.spyOn(resourceClient, "commandHostedRuntimeMedia").mockImplementation(async ({ command }) => {
    events.push(command.operation);
    return { applied: true, cutover: "postgres", reason: null, purge: null };
  });
  const source = { ...createHostedExecutionTestEnv(), BUNDLES: bucket, HOSTED_RUNTIME_POSTGRES_ENABLED: "true" };
  return { source, upload, events, uploaded, commands, bucket };
}
afterEach(() => vi.restoreAllMocks());

describe("recoverable runtime media uploads", () => {
  it.each(["image", "integration-ingest"] as const)("persists %s upload identity before bytes and releases only after complete", async (mediaKind) => {
    const h = harness();
    const { createHash } = await import("node:crypto");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const matchingDescriptor = { ...descriptor, mediaKind, sha256: digest };
    const bucket = createRuntimeMediaWriteBucket({ source: h.source, ...identity, media: { descriptor: matchingDescriptor } });
    const store = createHostedMediaStore({ bucket, key: new Uint8Array(32).fill(1), keyId: "synthetic-key", userId });
    await store.writeMedia({ ...matchingDescriptor, plaintext: bytes });
    expect(h.events).toEqual(["admit_put", "part", "complete", "release_put"]);
    expect(h.commands.mock.calls[0]?.[0].command).toMatchObject({ uploadId: "synthetic_upload_id" });
    expect(h.uploaded[0]).toContain("ciphertext");
    expect(h.bucket.put).not.toHaveBeenCalled();
  });
  it("never uploads bytes when the transactional media owner rejects admission", async () => {
    const h = harness();
    h.commands.mockRejectedValueOnce(new resourceClient.HostedRuntimeResourceRejectedError("HOSTED_RUNTIME_OWNER_STALE"));
    const bucket = createRuntimeMediaWriteBucket({ source: h.source, ...identity, media: { descriptor } });
    await expect(bucket.put(await hostedMediaObjectKey({ userId, mediaId: descriptor.mediaId }), "synthetic-encrypted-payload"))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    expect(h.upload.uploadPart).not.toHaveBeenCalled();
    expect(h.upload.complete).not.toHaveBeenCalled();
    expect(h.upload.abort).toHaveBeenCalledOnce();
  });
  it("keeps uncertain aborts pending and recognizes only the provider's exact missing-upload code", async () => {
    const h = harness();
    h.upload.complete.mockRejectedValue(new Error("synthetic unknown completion"));
    h.upload.abort.mockRejectedValue(new Error("synthetic unavailable abort"));
    const bucket = createRuntimeMediaWriteBucket({ source: h.source, ...identity, media: { descriptor } });
    await expect(bucket.put(await hostedMediaObjectKey({ userId, mediaId: descriptor.mediaId }), "synthetic-encrypted-payload")).rejects.toThrow("unknown completion");
    expect(h.events).toEqual(["admit_put", "part"]);
    expect(h.commands.mock.calls.some(([input]) => input.command.operation === "release_put")).toBe(false);
    await expect(abortRuntimeMultipartUpload({ abort: async () => { throw new Error("abort: upload missing (10024)"); } })).resolves.toBeUndefined();
    await expect(abortRuntimeMultipartUpload({ abort: async () => { throw new Error("abort: access denied (10003)"); } })).rejects.toThrow("10003");
  });
  it("publishes a private image through Postgres admission without a UserRunner RPC", async () => {
    const h = harness();
    vi.spyOn(ownerClient, "commandHostedRuntimeOwner").mockResolvedValue({ cutover: "postgres", status: "authorized", owner: null });
    const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4X8AAAAASUVORK5CYII=", "base64"));
    const result = await publishPostgresRuntimePrivateMedia({ source: { ...h.source, HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: "synthetic-capability-secret-that-is-long-enough" }, ...identity, bytes, contentType: "image/png" });
    expect(result.ok).toBe(true);
    expect(h.events).toEqual(["admit_private_put", "part", "complete", "release_put"]);
    expect(h.commands.mock.calls.at(-1)?.[0].command).toMatchObject({ scope: "private_media" });
  });
});


it("encrypts cold ingests with member-bound media AAD and verifies the descriptor", async () => {
  const { createHash } = await import("node:crypto");
  const bucket = new MemoryEncryptedR2Bucket();
  const key = new Uint8Array(32).fill(3);
  const store = createHostedMediaStore({ bucket, key, keyId: "synthetic-key", userId });
  const bytes = new TextEncoder().encode("synthetic closed ingest history");
  const cold = { mediaId: "d".repeat(64), mediaKind: "integration-ingest" as const,
    byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await store.writeMedia({ ...cold, plaintext: bytes });
  expect(await store.readMedia(cold)).toEqual(bytes);
  expect([...bucket.objects.values()][0]).not.toContain("synthetic closed ingest history");
  await expect(store.readMedia({ ...cold, mediaKind: "image" })).rejects.toThrow();
  await expect(store.readMedia({ ...cold, sha256: "0".repeat(64) })).rejects.toThrow();
  await expect(store.readMedia({ ...cold, byteSize: bytes.length + 1 })).rejects.toThrow();
  const other = createHostedMediaStore({ bucket, key, keyId: "synthetic-key", userId: "synthetic_other" });
  expect(await other.readMedia(cold)).toBeNull();
});
