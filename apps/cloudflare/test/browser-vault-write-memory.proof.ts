import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import { parseBrowserVaultReplica, splitBrowserVaultReplica } from "@murphai/query/browser-replica";
import { buildHostedStorageAad } from "@murphai/runtime-state";

import {
  createBrowserVaultReplicaAadFields,
  createBrowserVaultReplicaMetricBucketAadFields,
  createBrowserVaultReplicaShardAadFields,
  createHostedBrowserVaultReplicaStore,
  listHostedBrowserVaultReplicaObjectKeys,
} from "../src/browser-vault-store.js";
import { HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES } from "../src/browser-vault-limits.ts";
import { readEncryptedR2Payload, type R2PutValueLike } from "../src/crypto.js";
import { readJsonObject } from "../src/json.ts";
import { createSyntheticBrowserVaultReplica } from "./fixtures/browser-vault-replica.js";

const userId = "synthetic-member";
const rootKeyId = "synthetic-root";
const rootKey = new Uint8Array(32).fill(7);

// Model only the R2 boundary, not parsing, partitioning, compression, encryption
// or envelope serialization. Drain ciphertext to disk rather than retaining a
// second copy of every R2 object in the measured JS heap.
export class BrowserVaultProofBucket {
  puts = 0;
  constructor(readonly directory: string) { mkdirSync(directory, { recursive: true }); }
  private path(key: string): string {
    return join(this.directory, createHash("sha256").update(key).digest("hex"));
  }
  async put(key: string, value: R2PutValueLike): Promise<void> {
    assert.equal(typeof value, "string");
    writeFileSync(this.path(key), value as string);
    this.puts += 1;
  }
  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    return {
      arrayBuffer: async () => {
        const bytes = readFileSync(this.path(key));
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    };
  }
}

export function createBrowserVaultProofStore(bucket: BrowserVaultProofBucket) {
  return createHostedBrowserVaultReplicaStore({ bucket, rootKey, rootKeyId, userId });
}

export async function readBrowserVaultProofRequest(directory: string) {
  const body = Readable.toWeb(createReadStream(join(directory, "request.json"))) as ReadableStream<Uint8Array>;
  const requestOptions = { body, duplex: "half", method: "POST" };
  return readJsonObject(new Request("https://synthetic.invalid/replicas", requestOptions), {
    limitBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES + 1024 * 1024,
  });
}

// Check every byte-bearing object against the existing public reader/splitter,
// not a row sample or just a put counter. Execute separately from peak sampling.
export async function assertBrowserVaultProofReadback(
  bucket: BrowserVaultProofBucket,
  replica: unknown,
  ref: HostedBrowserVaultReplicaRef,
): Promise<void> {
  const store = createBrowserVaultProofStore(bucket);
  const cryptoKey = await store.deriveBrowserVaultReplicaKey(ref);
  const base = { bucket, cryptoKey, expectedKeyId: ref.dataKeyEnvelope?.dataKeyId, scope: "browser-vault-replica" as const };
  const root = await readEncryptedR2Payload({
    ...base,
    aad: buildHostedStorageAad({ ...createBrowserVaultReplicaAadFields({ ref, userId }) }),
    key: ref.objectKey,
  });
  assert(root);
  assert.equal(root.byteLength, ref.byteLength);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(root)), replica);
  const expected = await splitBrowserVaultReplica(parseBrowserVaultReplica(replica));
  const children = [
    ...HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS.map((shard) => ({
      aad: createBrowserVaultReplicaShardAadFields({ ref, shard, userId }),
      expected: shard === "metricsIndex" ? expected.metrics : expected[shard],
    })),
    ...HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS.map((bucketId) => ({
      aad: createBrowserVaultReplicaMetricBucketAadFields({ ref, bucketId, userId }),
      expected: expected.metricBuckets[bucketId],
    })),
  ];
  let encodedBytes = 0;
  let decodedBytes = 0;
  for (const child of children) {
    const bytes = await readEncryptedR2Payload({
      ...base, aad: buildHostedStorageAad({ ...child.aad }), key: child.aad.objectKey,
    });
    assert(bytes);
    assert.equal(bytes.byteLength, child.aad.encodedByteLength);
    const decoded = child.aad.contentEncoding === "identity" ? bytes : new Uint8Array(
      await new Response(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
    );
    assert.equal(decoded.byteLength, child.aad.byteLength);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(decoded)), child.expected);
    encodedBytes += bytes.byteLength;
    decodedBytes += decoded.byteLength;
  }
  assert.equal(children.length, 35);
  // This fixture must not collapse into kilobytes of repeated-row gzip output.
  assert(encodedBytes > decodedBytes / 5);
}

export async function runBrowserVaultMemoryProof(args: string[]): Promise<void> {
  const [mode, directory, count] = args;
  assert(directory && ["generate", "write", "read"].includes(mode ?? ""),
    "Usage: --browser-vault-memory-proof generate|write|read DIRECTORY [ROW_COUNT]");
  if (mode === "generate") {
    const rows = count === undefined ? 25_000 : Number(count);
    assert(Number.isSafeInteger(rows) && rows > 0);
    mkdirSync(directory, { recursive: true });
    const request = JSON.stringify({ replica: createSyntheticBrowserVaultReplica(rows) });
    writeFileSync(join(directory, "request.json"), request);
    console.log(JSON.stringify({ rows, requestBytes: Buffer.byteLength(request) }));
    return;
  }
  const bucket = new BrowserVaultProofBucket(join(directory, "objects"));
  const store = createBrowserVaultProofStore(bucket);
  if (mode === "read") {
    const body = await readBrowserVaultProofRequest(directory);
    const ref = JSON.parse(readFileSync(join(directory, "ref.json"), "utf8")) as HostedBrowserVaultReplicaRef;
    await assertBrowserVaultProofReadback(bucket, body.replica, ref);
    console.log(JSON.stringify({ readbackObjects: 36, byteLength: ref.byteLength }));
    return;
  }
  // Warm the actual owner, then measure in a fresh process with no fixture
  // generator or TypeScript compiler resident. No forced GC during the write.
  await store.writeBrowserVaultReplica({ replica: createSyntheticBrowserVaultReplica(4), userId });
  bucket.puts = 0;
  globalThis.gc?.();
  let peakHeapAndExternal = 0;
  const sample = () => {
    const { heapUsed, external } = process.memoryUsage();
    peakHeapAndExternal = Math.max(peakHeapAndExternal, heapUsed + external);
  };
  const stringify = JSON.stringify;
  const btoa = globalThis.btoa;
  JSON.stringify = new Proxy(stringify, {
    apply(target, receiver, argumentsList) {
      const result: unknown = Reflect.apply(target, receiver, argumentsList);
      sample();
      return result;
    },
  });
  globalThis.btoa = new Proxy(btoa, {
    apply(target, receiver, argumentsList) {
      const result: unknown = Reflect.apply(target, receiver, argumentsList);
      sample();
      return result;
    },
  });
  const timer = setInterval(sample, 2);
  const started = performance.now();
  try {
    const body = await readBrowserVaultProofRequest(directory);
    sample();
    const ref = await store.writeBrowserVaultReplica({
      replica: body.replica, userId,
      beforeWrite: async (planned) => {
        assert.equal(bucket.puts, 0);
        assert.equal(listHostedBrowserVaultReplicaObjectKeys(planned).length, 36);
        sample();
      },
    });
    sample();
    assert.equal(bucket.puts, 36);
    writeFileSync(join(directory, "ref.json"), stringify(ref));
    console.log(stringify({
      objects: bucket.puts, byteLength: ref.byteLength,
      elapsedMs: performance.now() - started,
      sampledPeakHeapAndExternalMiB: peakHeapAndExternal / 1024 ** 2,
      processMaxRssMiB: process.resourceUsage().maxRSS / 1024,
    }));
  } finally {
    clearInterval(timer);
    JSON.stringify = stringify;
    globalThis.btoa = btoa;
  }
}

const flag = process.argv.indexOf("--browser-vault-memory-proof");
if (flag !== -1) {
  void runBrowserVaultMemoryProof(process.argv.slice(flag + 1)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
