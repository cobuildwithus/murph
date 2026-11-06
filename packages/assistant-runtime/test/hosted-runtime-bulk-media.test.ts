import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { addMeal, initializeVault } from "@murphai/core";
import { materializeVaultMedia } from "@murphai/assistant-engine/assistant-codex";
import { assistantVaultFileMaxBytes } from "@murphai/operator-config/assistant-cli-contracts";
import { createHostedArtifactMaterializer } from "../src/hosted-runtime/artifacts.ts";
import { HostedRuntimeMediaReadError } from "../src/hosted-runtime/platform.ts";
import { writeHostedMediaReferenceCatalogue } from "../src/hosted-runtime/media-references.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-bulk-media-"));
  roots.push(vaultRoot);
  return vaultRoot;
}
function descriptor(name: string, bytes: Uint8Array) {
  return { relativePath: `raw/inbox/synthetic/${name}.mp4`, mediaId: createHash("sha256").update(name).digest("hex"),
    byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaKind: "video" as const, mimeType: "video/mp4", recordedAt: "2030-01-01T00:00:00.000Z", expiresAt: null as string | null };
}

test.each(["all", "paths"] as const)("%s admits only a catalogue-ordered prefix within the aggregate budget", async mode => {
  const vaultRoot = await setup();
  const bytes = Buffer.from("synthetic video");
  const entries = [descriptor("first", bytes), { ...descriptor("over-budget", bytes), byteSize: assistantVaultFileMaxBytes }, descriptor("last", bytes)];
  await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries } });
  const get = vi.fn(async (_entry: { mediaId: string }) => bytes);
  const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore: { get, put: async () => {} } });
  const report = await materializeVaultMedia({ vaultRoot, materialize,
    args: mode === "all" ? { all: true } : { paths: entries.map(entry => entry.relativePath).reverse() } });
  expect(report).toEqual({ requested: 3, available: 1, removed: 0, unavailable: entries.slice(1).map(entry => ({ path: entry.relativePath, reason: "size" })) });
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0]?.[0]).toMatchObject({ mediaId: entries[0]!.mediaId });
  expect(await readFile(path.join(vaultRoot, entries[0]!.relativePath))).toEqual(bytes);
  for (const entry of entries.slice(1)) await expect(readFile(path.join(vaultRoot, entry.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
});

test("a partial bulk download reports transport and budget gaps and preserves cancellation", async () => {
  const vaultRoot = await setup();
  const bytes = Buffer.from("synthetic video");
  const entries = [descriptor("first", bytes), descriptor("interrupted", bytes), { ...descriptor("over-budget", bytes), byteSize: assistantVaultFileMaxBytes }];
  await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries } });
  const get = vi.fn(async (entry: { mediaId: string }) => {
    if (entry.mediaId === entries[1]!.mediaId) throw new HostedRuntimeMediaReadError({ retryable: true, cause: new Error("Synthetic transport interruption") });
    return bytes;
  });
  const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore: { get, put: async () => {} } });
  expect(await materializeVaultMedia({ args: { all: true }, vaultRoot, materialize })).toEqual({ requested: 3, available: 1, removed: 0, unavailable: [
    { path: entries[1]!.relativePath, reason: "transport" }, { path: entries[2]!.relativePath, reason: "size" },
  ] });
  expect(get).toHaveBeenCalledTimes(2);
  const controller = new AbortController();
  const interrupted = new Error("Synthetic owner lost");
  get.mockImplementation(async () => { controller.abort(interrupted); return bytes; });
  await expect(materializeVaultMedia({ args: { all: true }, vaultRoot, materialize, signal: controller.signal })).rejects.toMatchObject({ cause: interrupted });
  expect(await readFile(path.join(vaultRoot, entries[0]!.relativePath))).toEqual(bytes);
  for (const entry of entries.slice(1)) await expect(readFile(path.join(vaultRoot, entry.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
});

test("bulk expiry discloses surviving unverified bytes and counts only absent copies as removed", async () => {
  const vaultRoot = await setup();
  const bytes = Buffer.from("synthetic video"), changed = Buffer.from("newer local bytes");
  const entries = ["changed", "missing", "verified"].map(name => ({ ...descriptor(name, bytes), expiresAt: "2000-01-01T00:00:00.000Z" }));
  await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries } });
  await mkdir(path.dirname(path.join(vaultRoot, entries[0]!.relativePath)), { recursive: true });
  await writeFile(path.join(vaultRoot, entries[0]!.relativePath), changed);
  await writeFile(path.join(vaultRoot, entries[2]!.relativePath), bytes);
  const get = vi.fn(async (_entry: { mediaId: string }) => bytes);
  const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore: { get, put: async () => {} } });
  expect(await materializeVaultMedia({ args: { all: true }, vaultRoot, materialize })).toEqual({ requested: 3, available: 0, removed: 2,
    unavailable: [{ path: entries[0]!.relativePath, reason: "expired" }] });
  expect(await readFile(path.join(vaultRoot, entries[0]!.relativePath))).toEqual(changed);
  await expect(readFile(path.join(vaultRoot, entries[2]!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
  expect(get).not.toHaveBeenCalled();
});

test("expired 110 MiB media is evicted before the single-file cap is considered", async () => {
  const vaultRoot = await setup();
  const bytes = Buffer.alloc(110 * 1024 * 1024, 1);
  const entry = { ...descriptor("expired-large", bytes), expiresAt: "2000-01-01T00:00:00.000Z" };
  await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries: [entry] } });
  await mkdir(path.dirname(path.join(vaultRoot, entry.relativePath)), { recursive: true });
  await writeFile(path.join(vaultRoot, entry.relativePath), bytes);
  const get = vi.fn(async (_entry: { mediaId: string }) => bytes);
  const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore: { get, put: async () => {} } });
  const result = await materialize([entry.relativePath], { maxFileBytes: assistantVaultFileMaxBytes });
  expect(result.missingArtifactPaths.get(`vault:${entry.relativePath}`)).toBe("expired");
  await expect(readFile(path.join(vaultRoot, entry.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
  expect(get).not.toHaveBeenCalled();
});

test.each([false, true])("malformed canonical manifests report integrity with catalogue entry=%s", async catalogued => {
  const vaultRoot = await setup();
  await initializeVault({ vaultRoot, timezone: "UTC" });
  const bytes = Buffer.from("synthetic photo"), photoPath = path.join(vaultRoot, "photo.png");
  await writeFile(photoPath, bytes);
  const meal = await addMeal({ vaultRoot, photoPath, occurredAt: "2030-01-01T00:00:00.000Z" });
  const relativePath = meal.photo!.relativePath;
  const directory = path.dirname(path.join(vaultRoot, relativePath));
  const manifest = (await readdir(directory)).find(name => name.startsWith("manifest"))!;
  await writeFile(path.join(directory, manifest), "{broken");
  if (catalogued) await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries: [
    { ...descriptor("photo", bytes), relativePath, mediaKind: "image", mimeType: "image/png" },
  ] } });
  const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot });
  expect(await materializeVaultMedia({ args: { paths: [relativePath] }, vaultRoot, materialize })).toEqual({ requested: 1, available: 0, removed: 0,
    unavailable: [{ path: relativePath, reason: "integrity" }] });
});
