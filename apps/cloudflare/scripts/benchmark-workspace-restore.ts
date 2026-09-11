import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import { createCloudflareWorkspaceSnapshotPort } from "../src/runtime-platform/workspace-snapshot-port.ts";
import {
  createEncryptedWorkspaceSnapshotFile,
  type EncryptedWorkspaceSnapshotFile,
  type WorkspaceSnapshotArchiveEntryInput,
} from "../src/workspace-snapshot-local.ts";

// Synthetic data only. Run the same script/revision and settings on both sides
// of an optimization; fixture construction and content validation are untimed.
const mib = 1024 * 1024;
function setting(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(Number.isSafeInteger(value) && value >= minimum && value <= maximum, name);
  return value;
}
const bundleMiB = setting("MURPH_BENCH_BUNDLE_MIB", 50, 1, 256);
const operation = process.env.MURPH_BENCH_OPERATION ?? "restore";
assert.ok(operation === "restore" || operation === "create", "MURPH_BENCH_OPERATION");
const plainMiB = process.env.MURPH_BENCH_PLAIN_MIB === undefined
  ? null : setting("MURPH_BENCH_PLAIN_MIB", 125, 1, 1023);
assert.ok(plainMiB === null || plainMiB >= bundleMiB,
  "MURPH_BENCH_PLAIN_MIB must be at least MURPH_BENCH_BUNDLE_MIB");
const fileCount = setting("MURPH_BENCH_FILES", 1000, 1, 10000);
const iterations = setting("MURPH_BENCH_ITERATIONS", 7, 1, 100);
const networkMiBps = setting("MURPH_BENCH_NETWORK_MIBPS", 0, 0, 1000);
const chunkBytes = setting("MURPH_BENCH_CHUNK_KIB", 64, 1, 1024) * 1024;
const root = await mkdtemp(path.join(tmpdir(), "workspace-restore-bench-"));
const sourceRoot = path.join(root, "source");

const dataKey = Buffer.alloc(32, 7);
const encodedDataKey = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
const snapshotId = "snapshot_synthetic_benchmark";
const userId = "member_synthetic_benchmark";
const objectKey = `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
const aad = buildHostedWorkspaceSnapshotV2Aad({ objectKey, snapshotId, userId });
const digests = new Map<string, string>();
const server = createServer();
let objectRequests = 0;

function snapshotRef(encrypted: EncryptedWorkspaceSnapshotFile): HostedWorkspaceSnapshotV2Ref {
  return {
    archive: {
      compression: encrypted.compression, encryptedByteSize: encrypted.encryptedByteSize,
      encryptedObjectSha256: encrypted.encryptedObjectSha256, fileCount: encrypted.fileCount,
      format: "tar", plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
      totalPlainBytes: encrypted.totalPlainBytes,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    encryption: {
      aad, ivBase64: encrypted.ivBase64, rootKeyId: "root_key_synthetic",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME, wrappedDataKey: "wrapped_synthetic",
    },
    objectKey, schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA, snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND, userId,
  };
}

try {
  await mkdir(sourceRoot, { recursive: true });
  // Deterministic incompressible bytes plus repeated records approximate a
  // 50 MiB compressed / 125 MiB unpacked workspace without private fixtures.
  const entropy = createCipheriv("aes-256-ctr", Buffer.alloc(32, 3), Buffer.alloc(16, 5));
  const entries: WorkspaceSnapshotArchiveEntryInput[] = [];
  const defaultEntropyBytes = Math.ceil(bundleMiB * mib / fileCount);
  const totalEntropyBytes = plainMiB === null ? defaultEntropyBytes * fileCount : bundleMiB * mib;
  const totalPlainBytes = plainMiB === null
    ? (defaultEntropyBytes + Math.ceil(defaultEntropyBytes * 1.5)) * fileCount
    : plainMiB * mib;
  function fileBytes(total: number, index: number): number {
    return Math.floor(total / fileCount) + Number(index < total % fileCount);
  }
  for (let index = 0; index < fileCount; index += 1) {
    const archivePath = `record-${String(index).padStart(5, "0")}.bin`;
    const absolutePath = path.join(sourceRoot, archivePath);
    const content = Buffer.concat([
      entropy.update(Buffer.alloc(fileBytes(totalEntropyBytes, index))),
      Buffer.alloc(fileBytes(totalPlainBytes - totalEntropyBytes, index), "synthetic workspace record\n"),
    ]);
    await writeFile(absolutePath, content, { mode: 0o600 });
    digests.set(archivePath, createHash("sha256").update(content).digest("hex"));
    entries.push({ absolutePath, archivePath, kind: "file" });
  }
  entropy.final();
  const createInput = {
    aad, archiveEntries: entries, dataKey: encodedDataKey, durableRoot: sourceRoot,
    ivBase64: "AQIDBAUGBwgJCgsM", maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
    outputDir: path.join(root, "archive"),
  };
  let encrypted = operation === "restore" ? await createEncryptedWorkspaceSnapshotFile(createInput) : null;
  server.on("request", (_request, response) => {
    assert.ok(encrypted);
    objectRequests += 1;
    response.writeHead(200, { "content-length": encrypted.encryptedByteSize });
    const source = createReadStream(encrypted.encryptedFilePath, { highWaterMark: chunkBytes });
    const started = performance.now();
    let sentBytes = 0;
    async function* paced() {
      for await (const chunk of source) {
        sentBytes += chunk.length;
        if (networkMiBps) {
          const wait = sentBytes / (networkMiBps * mib) * 1000 - (performance.now() - started);
          if (wait > 0) await delay(wait);
        }
        yield chunk;
      }
    }
    void pipeline(paced(), response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const getUrl = `http://127.0.0.1:${address.port}/snapshot`;
  // Only control-plane envelope reads are substituted. The object GET uses
  // real Node fetch, backpressure, the production reader and retry owner.
  const fetchImpl: typeof fetch = async (resource, init) => {
    const url = resource instanceof Request ? resource.url : String(resource);
    if (url.endsWith("/data-key/unwrap")) return Response.json({ dataKey: encodedDataKey });
    if (url.endsWith("/presign-get")) return Response.json({
      getUrl, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(url, getUrl);
    return fetch(resource, init);
  };
  const factories = [{ label: "candidate", createPort: createCloudflareWorkspaceSnapshotPort,
    createSnapshot: createEncryptedWorkspaceSnapshotFile }];
  const baselineModulePath = process.env.MURPH_BENCH_BASELINE_MODULE;
  if (baselineModulePath) {
    const loaded = await import(pathToFileURL(path.resolve(baselineModulePath)).href);
    // The baseline exports the production owner selected by the operation.
    const exportName = operation === "create"
      ? "createEncryptedWorkspaceSnapshotFile" : "createCloudflareWorkspaceSnapshotPort";
    assert.equal(typeof loaded[exportName], "function", exportName);
    factories.unshift({ label: "baseline",
      createSnapshot: operation === "create" ? loaded[exportName] : createEncryptedWorkspaceSnapshotFile,
      createPort: operation === "restore" ? loaded[exportName] : createCloudflareWorkspaceSnapshotPort,
    });
  }
  const variants = factories.map(({ label, createPort, createSnapshot }) => ({
    label, samples: [] as number[], durableRoot: path.join(root, label),
    createSnapshot,
    port: createPort({
      boundUserId: userId, fetchImpl, timeoutMs: 30_000,
      workspaceCheckpointBridge: { readCurrentLease: () => ({
        attemptId: "attempt_synthetic", leaseGeneration: "1", userId, workspaceVersion: "1",
      }) },
    }),
  }));
  console.log(JSON.stringify({ benchmark: "fixture", operation, bundleMiB, plainMiB, fileCount, networkMiBps,
    chunkBytes, encryptedBytes: encrypted?.encryptedByteSize, plainBytes: totalPlainBytes,
    platform: process.platform, arch: process.arch, node: process.version }));
  let restoreCount = 0;
  for (let iteration = 0; iteration <= iterations; iteration += 1) {
    // Alternate order using the same fixture. Each variant gets one warmup;
    // archive validation and creation round trips stay outside the timer.
    const ordered = iteration % 2 === 0 ? variants : [...variants].reverse();
    for (const variant of ordered) {
      const cpu = process.cpuUsage();
      const started = performance.now();
      let timing;
      if (operation === "create") {
        encrypted = await variant.createSnapshot(createInput);
      } else {
        assert.ok(encrypted);
        timing = await variant.port.restoreWorkspaceSnapshot({
          durableRoot: variant.durableRoot, ref: snapshotRef(encrypted),
        });
      }
      const wallMs = performance.now() - started;
      const used = process.cpuUsage(cpu);
      assert.ok(encrypted);
      if (operation === "create") {
        assert.equal(encrypted.fileCount, fileCount);
        assert.equal(encrypted.totalPlainBytes, totalPlainBytes);
        const encryptedHash = createHash("sha256");
        let encryptedBytes = 0;
        for await (const chunk of createReadStream(encrypted.encryptedFilePath)) {
          encryptedBytes += chunk.length;
          encryptedHash.update(chunk);
        }
        assert.equal(encryptedBytes, encrypted.encryptedByteSize);
        assert.equal(encryptedHash.digest("hex"), encrypted.encryptedObjectSha256);
        // Both creation variants use the current production restore owner.
        await variant.port.restoreWorkspaceSnapshot({
          durableRoot: variant.durableRoot, ref: snapshotRef(encrypted),
        });
      }
      for (const [relativePath, digest] of digests) {
        assert.equal(createHash("sha256").update(await readFile(path.join(variant.durableRoot, relativePath))).digest("hex"), digest);
      }
      restoreCount += 1;
      assert.equal(objectRequests, restoreCount);
      console.log(JSON.stringify({ benchmark: operation, variant: variant.label,
        iteration, warmup: iteration === 0, wallMs,
        nodeCpuMs: (used.user + used.system) / 1000, rssBytes: process.memoryUsage().rss,
        verifiedFiles: digests.size, encryptedBytes: encrypted.encryptedByteSize, timing }));
      if (iteration > 0) variant.samples.push(wallMs);
      if (operation === "create") await rm(encrypted.temporaryDirectoryPath, { recursive: true, force: true });
    }
  }
  for (const variant of variants) {
    const samples = variant.samples.sort((a, b) => a - b);
    const midpoint = Math.floor(samples.length / 2);
    const medianMs = (samples[midpoint]! + samples[Math.ceil(samples.length / 2) - 1]!) / 2;
    console.log(JSON.stringify({ benchmark: "summary", operation, variant: variant.label, samples: samples.length,
      medianMs, minMs: samples[0], maxMs: samples.at(-1) }));
  }
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  dataKey.fill(0);
  await rm(root, { recursive: true, force: true });
}
