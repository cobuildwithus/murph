# Workspace restore benchmark

This benchmark calls the production Cloudflare workspace snapshot port. A real
loopback HTTP GET supplies an encrypted tar/zstd object; synthetic responses
stand in for key unwrap and presigning. The normal reader, inactivity/retry
owner, AES-GCM authentication, both SHA-256 checks, zstd, tar, temporary staging,
durable-root replacement, and cleanup all run.

The default fixture is approximately 50 MiB encrypted and 125 MiB unpacked,
spread over 1,000 files. Deterministic synthetic entropy supplies about 50 MiB
of incompressible data; repeated records supply the remaining 75 MiB. Actual
encrypted size is reported because archive metadata adds overhead. This is a
storage/restore fixture, not a valid assistant conversation or full vault.
Archive ownership names are omitted. No production data or credentials are used.

## Run

From the repository root, after `pnpm install --frozen-lockfile`, with Node
24.14.1 or newer, tar, and zstd available:

```sh
pnpm exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json \
  apps/cloudflare/scripts/benchmark-workspace-restore.ts
```

For a paired comparison, first bundle the unmodified production port before
editing it (or build it from an isolated baseline checkout into this artifact
path). Then bundle the current benchmark:

```sh
apps/cloudflare/node_modules/.bin/esbuild \
  apps/cloudflare/src/runtime-platform/workspace-snapshot-port.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json \
  --outfile=.artifacts/workspace-restore-bench/baseline-port.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

# Run after applying the candidate change. Do not overwrite baseline-port.mjs.
apps/cloudflare/node_modules/.bin/esbuild \
  apps/cloudflare/scripts/benchmark-workspace-restore.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json \
  --outfile=.artifacts/workspace-restore-bench/paired.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

MURPH_BENCH_BASELINE_MODULE=.artifacts/workspace-restore-bench/baseline-port.mjs \
  node .artifacts/workspace-restore-bench/paired.mjs
```

The optional baseline module must export `createCloudflareWorkspaceSnapshotPort`.
Both ports restore the exact same encrypted object into separate workspace roots.
Order alternates each iteration; each variant gets one excluded warmup. Without
the module, the benchmark measures only the current implementation. Keep the
same Node version and dependency versions in both builds.

Avoid concurrent builds, installs, tests, or other benchmark containers. Do not
compare a busy baseline with a quiet candidate. Fixtures and temporary files are
removed in `finally`; JSONL output can be retained beneath ignored `.artifacts/`.
Do not commit bundled executables, fixtures, or raw profiles.

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `MURPH_BENCH_BUNDLE_MIB` | 50 | Incompressible MiB, range 1–256 |
| `MURPH_BENCH_FILES` | 1000 | Number of files, range 1–10000 |
| `MURPH_BENCH_ITERATIONS` | 7 | Measured restores after one warmup, range 1–100 |
| `MURPH_BENCH_CHUNK_KIB` | 64 | HTTP server file-read chunk size, range 1–1024 |
| `MURPH_BENCH_NETWORK_MIBPS` | 0 | Optional aggregate response pacing; zero is unrestricted |
| `MURPH_BENCH_BASELINE_MODULE` | unset | Local bundled baseline port for an alternating paired comparison |

For a paced run, prefix the command with
`MURPH_BENCH_NETWORK_MIBPS=10`. Node fetch may coalesce or split server chunks.

## Linux approximation

Run the same bundled artifact in the pinned runner base image with fixed CPU
and memory limits. The image supplies production Node, GNU tar, and zstd.
Loopback works with external networking disabled. Keep temporary workspace
files on the container writable layer, rather than a host bind mount:

```sh
docker run --rm --platform linux/amd64 --network none \
  --cpus 2 --memory 6g --pids-limit 128 --user 0 \
  --mount "type=bind,src=$PWD/.artifacts/workspace-restore-bench,dst=/bench,readonly" \
  -e MURPH_BENCH_BASELINE_MODULE=/bench/baseline-port.mjs \
  --entrypoint node \
  ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.153.4 \
  /bench/paired.mjs
```

Both variants run inside this one container. On ARM hosts, AMD64 emulation
changes absolute timings. Check Docker VM resources as well as container limits:
a 6 GiB container limit does not allocate memory beyond the VM’s capacity.
This does not emulate R2 placement, TLS,
Cloudflare outbound interception, container startup, control-plane latency,
concurrent runtime hydration, or the provider turn.

## Interpretation and correctness

- Fixture generation and byte-for-byte hash readback of every restored file are
  excluded from the measured restore. Every iteration performs a real restore;
  none uses the warm-workspace shortcut. The first is a warmup. Subsequent
  restores also exercise replacement and deletion of the previous workspace.
- Disk/page caches are not flushed. These are cold-workspace restores on a
  warmed local filesystem, not cold-disk measurements.
- `wallMs` measures the whole port call. `decryptMs` includes downloading the
  encrypted stream, so do not add it to the object-fetch/body-read timings.
  `archiveExtractMs` covers zstd/tar; `cleanupMs` includes deleting old files.
- `nodeCpuMs` covers Node, including the local HTTP server, but excludes child
  zstd/tar CPU. RSS is sampled after content verification and is not peak RSS.
- The production body-settled log splits pending-read wait from consumer time.
  Read wait includes scheduling delays and does not prove a network cause.
- Preserve authentication and both digest checks before extraction. Corruption,
  decoder/extractor failures, cancellation, and retry exhaustion must never
  replace existing durable files.

## Measurement record

Baseline source: `18b498bc49435c49adb99588754a8a2bf72c4ce6`.
The first native ARM runs were heavily affected by host contention (including
initial dependency preparation) and are diagnostic only. A ciphertext-copy
experiment did not establish a repeatable wall-time benefit and was reverted.

The retained candidate connects zstd stdout directly to tar stdin using Node's
inherited-stream stdio support. The parent closes its copy of that pipe after
spawn, so tar receives EOF when zstd exits. Both child exit statuses remain
mandatory, and both are joined during failure cleanup. The existing decrypt
loop and authenticate-before-extract order are unchanged. Archive creation also
omits account-name metadata with `--numeric-owner`; restores already ignore
archive ownership.

Linux runs pin image
`sha256:08e6d9fa1c8d12d5d0722640586e68d84063c07183d2431a129590456531e7b0`,
2 CPUs and a requested 6 GiB container limit, AMD64 on an ARM host, and the
container writable layer. The Docker VM itself has only 2 CPUs and about
1.91 GiB RAM, so the memory ceiling is lower than the requested container limit.
The initial 1 MiB correctness smoke passed. Full-size emulated comparisons
were interrupted because setup and daemon operations became impractically slow;
partial Linux timings are excluded from the performance comparison. The measured
paired matrix therefore uses native ARM Node, system tar, and zstd.
RSS reports zero under the local AMD64 emulator and is unavailable there;
zero must not be interpreted as memory usage.


### Native unpaced comparison

Same encrypted object: 52,534,811 bytes; 131,073,000 unpacked bytes; 1,000 files.
Node 24.14.1 on native ARM macOS, system bsdtar 3.5.3/libarchive 3.7.4 and zstd.
Seven measured pairs followed one warmup per variant, alternating order.
Every restored file passed its SHA-256 readback in all 16 restores.

| Median metric | Baseline | Direct pipe | Change |
| --- | ---: | ---: | ---: |
| Whole restore | 41.508 s | 25.397 s | −38.8% |
| Archive extraction | 23.798 s | 14.671 s | −38.4% |
| Node CPU | 2.808 s | 2.238 s | −20.3% |
| Download and decrypt | 15.236 s | 14.116 s | −7.4% |

The candidate was faster in six of seven pairs. Wall-time ranges were
13.625–119.557 s baseline and 9.300–83.417 s candidate. The machine was severely
contended: a sample during the run showed 10 logical CPUs, a one-minute load
average near 110, and about 18 GB of swap in use. These observations support
keeping the smaller direct-pipe implementation as a local candidate; they are
not a production latency forecast or a statistically stable speedup estimate.
A quiet native AMD64 Linux runner is needed to establish production-relevant
absolute timings. Raw synthetic JSONL is retained locally under
`.artifacts/workspace-restore-bench/paired-native-50mib.jsonl`.

### Native paced comparison

A separate same-object comparison used a 10 MiB/s server cap, the same 1,000-file
shape (52,534,641 encrypted bytes), and three measured pairs plus one warmup
each. Every file passed readback in all eight restores. Median whole restore
fell from 16.127 s to 12.449 s (22.8%); archive extraction fell from 9.630 s to
6.685 s (30.6%). Median Node CPU fell from 2.467 s to 1.227 s. The candidate was
faster in all three pairs. Baseline wall times ranged 15.664–16.777 s; candidate
wall times ranged 11.932–13.733 s.

The candidate's download/decrypt median was 5.122 s, consistent with the roughly
5 s transfer floor. CPU/extraction improvements cannot remove that floor. This
is a separate run with different host load, so compare variants within each
scenario rather than treating paced and unpaced totals as a network experiment.
Raw synthetic JSONL is retained locally under
`.artifacts/workspace-restore-bench/paired-native-paced-50mib.jsonl`.

### Verification and release boundary

Snapshot-local, interruption, and runner-platform suites passed 232 tests,
including both decoder and extractor early-exit preservation scenarios.
Cloudflare typecheck and the complexity guard passed. A small paired run also
exercises the documented source command and even-count median calculation.
These measurements are local evidence. Production timing still needs a quiet
native Linux run. PR acceptance and deployment are tracked separately from
the benchmark results.
