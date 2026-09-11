# Experiment progress benchmark

Run from the repository root after installing dependencies and building the
public workspace packages:

```sh
pnpm --dir packages/health-commons generate
pnpm --dir packages/query build
pnpm --dir packages/vault-usecases build
pnpm exec tsx --tsconfig tsconfig.base.json packages/vault-usecases/bench/experiment-progress.ts
```

The harness calls the actual `showExperimentProgress` usecase on a temporary,
synthetic vault: 8,000 display-grade device observations spread across 180 days,
a 30-day experiment, and absent optional origin metadata. It prints elapsed and
process CPU milliseconds for cold, warm, and unrelated-write reads, plus a hash
of each progress result. All three hashes must agree and signals must be
nonempty. It removes only its own vault and uses no network or production data.
Set `MURPH_BENCH_EVENTS` from 180 through 50,000 to vary collection size.

## Measured comparison

Two sequential paired runs on the same local machine, alternating base/head
order, produced these mean wall times on 2026-09-11:

| Read | Base | Candidate | Speedup |
| --- | ---: | ---: | ---: |
| Cold | 6,730 ms | 545 ms | 12.4× |
| Warm | 5,985 ms | 431 ms | 13.9× |
| After unrelated write | 6,713 ms | 434 ms | 15.5× |

Base was `6cef567d52d5`; candidate was this change. All 12 results had the same
SHA-256 progress hash. Timing excluded fixture creation. For isolated base/head
comparison, the same harness and source graph were bundled with esbuild,
substituting tracked changed sources from the base commit for the baseline.
The benchmark-only runtime loader bound its query import statically in both
bundles; production dynamic loading was unchanged. These numbers therefore
measure the composed usecase, excluding process startup and dynamic-import
resolution. The ordinary command above includes those import costs on its
first call. To reproduce a baseline, copy this identical harness into a clean
checkout at the base and build its public packages before running it.

The gain comes from skipping a full SQLite/search rebuild for progress and
avoiding repeated schema-error allocation for missing wearable origin metadata.
No timing threshold belongs in unit tests. This is local synthetic evidence,
not a hosted one-vCPU latency guarantee or an end-to-end assistant reply
measurement. Vault composition, supplied origin metadata, concurrency, and
runner CPU affect the gain. Follow deployment with bounded tool-duration
aggregates; provider thinking and other dispatch overhead remain separate.
