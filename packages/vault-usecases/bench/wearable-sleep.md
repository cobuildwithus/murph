# Focused sleep-list proof

This is a synthetic service-boundary experiment, not a production speedup claim.
The harness loads **built public entrypoints** from each supplied checkout,
including `@murphai/vault-usecases/vault-services`. There is no source loader,
provider, secret, new dependency, or copied summarization implementation. The
90-day fixture contains three providers, 2,160 observations, 270 sleep windows
and 90 searchable notes. Duration, stages, precedence, time in bed, steps, HRV
and weight are represented. Cardinalities are explicit, not inferred from
private telemetry. Every worker fixes `Date` to April 1, 2026; monotonic timing
and filesystem timestamps are not mocked.

## Apply and prove the unchanged baseline first

Use the repository's Node >=24.14.1, pnpm 10.33.0 and frozen lockfile. Apply only
patch 1 to the attested base. Use existing authorized checkouts and build each
checkout's public runtime independently; never point both sides at one mutable
build directory. The authoring ZIP lacks Git metadata/dependencies, so the parent
must independently establish its base SHA and build freshness.

From each checkout, build the required public packages with the normal owners:

```sh
pnpm --filter @murphai/vault-usecases... build
pnpm --filter @murphai/murph... build
```

Run these focused checks from the repository root (both before and after patch 2):

```sh
node --test packages/vault-usecases/bench/wearable-sleep.test.ts
pnpm exec vitest run --config packages/vault-usecases/vitest.config.ts --no-coverage packages/vault-usecases/test/wearables-sleep-service.test.ts
pnpm exec vitest run --config packages/cli/vitest.config.ts --no-coverage packages/cli/test/wearables-sleep-list-source.test.ts
pnpm exec vitest run --config packages/query/vitest.config.ts --no-coverage packages/query/test/wearable-source-health-query.test.ts packages/query/test/query-projection-canonical-write.test.ts packages/query/test/wearable-summary-stored-codec.test.ts
pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage packages/assistant-engine/test/assistant-codex-real-e2e.test.ts -t 'focused sleep read production contract'
pnpm --filter @murphai/query typecheck
pnpm --filter @murphai/vault-usecases typecheck
pnpm --filter @murphai/murph typecheck
pnpm --filter @murphai/assistant-engine typecheck
node scripts/run-typescript.mjs package -p packages/vault-usecases/bench/tsconfig.json --pretty false
```

The deterministic assistant check generates the real CLI contract, assembles
production developer instructions and reads real imported sleep via JSON and
unchanged default TOON. It does not call a model. The service proof independently
full-builds its reference vault, compares exact full JSON/bytes/SHA256, and checks
explicit provider values, context, correction/deletion, locks and error privacy.
The shared-owner suites cover transactional failure/reset and cross-process
locking without copying those tests into this sleep-specific change.

Run a complete base/base control **before** the candidate. `BASE` and `HEAD` below
mean parent-verified, independently built checkout paths; `HARNESS` is one fixed
absolute path to this `wearable-sleep.ts` on the proof revision:

```sh
node "$HARNESS" --before "$BASE" --after "$BASE" --expect-after full --output /tmp/sleep-base-base.json
```

Retain that baseline checkout/build, then apply patch 2 to the candidate checkout,
rebuild its public packages, repeat deterministic checks and run its additional
mechanism proof and paired benchmark:

```sh
pnpm exec vitest run --config packages/vault-usecases/vitest.config.ts --no-coverage packages/vault-usecases/test/wearables-sleep-focused.test.ts
node "$HARNESS" --before "$BASE" --after "$HEAD" --expect-after focused --output /tmp/sleep-base-candidate.json
pnpm test:assistant:live -- --test 'real Codex focused sleep list e2e'
```

The last command is opt-in local-subscription proof, not routine CI. It invokes
one sleep data read, allows at most one same-command help lookup per the generated
contract, forbids other actions, checks canonical bytes and prints the synthetic
reply. It must accurately report 450 minutes / 7 hours 30 minutes, not 480 minutes
in bed. Record the actual model/auth class and inspect the prose before `Ready`.
Never provide test production destinations or provider secrets.

## Measurement and failure contract

Six isolated scenarios cover cold sleep; cold plus one, two and three repeated
reads; fresh sleep after a full global read; stale sleep after canonical correction
then global; sleep/global/sleep/global; and global/sleep/global/sleep. Each pair
runs sequential **fresh subprocesses**, alternating which revision goes first.
Each scenario has two warmup pairs plus seven measured pairs. No process warms
global code for only one revision. Each worker starts with a new vault and no
query index; global-first preparation is retained in the complete cost.

Per-stage wall and CPU times, exact output byte counts/hashes, phase counts and
all warmup/measured samples are retained. Complete output JSON is compared
byte-for-byte before omission from the report. Missing results, malformed worker
output, unsuccessful subprocesses, timeouts, dropped spans, wrong phase counts,
missing/duplicate pairs and any parity difference fail nonzero. An interrupted
report stays `complete: false`; it is not valid evidence. Validator unit fixtures
are not benchmark measurements.

The report includes arrays, minimum/maximum/median and paired **after minus
before** deltas for each stage, cumulative repeat count, complete read sequence,
workflow including mutation/proof, and whole subprocess. Startup-to-worker,
public imports, fixture creation, mutation and cleanup are reported separately.
The subprocess total additionally includes serialization and OS process costs;
these intervals overlap and must not be added together. Lazy service/query module
loading is naturally charged to its first actual read on **both** sides. The
fresh-global sleep result excludes its separately reported preparation only when
looking at that individual stage, never in the complete-workflow total.

Mechanism assertions require no metric/search phase on focused cold/stale sleep,
but do require strict source, dataset, wearable-summary and publication phases.
Later full reads must run global metrics/search/publication and reuse wearable
summaries (zero summary-build phases for an unchanged wearable generation).
Fresh reads have no rebuild. A smaller first sleep time is insufficient: compare
all mixed totals against the base/base noise distribution. Additional lock and
manifest work on fresh sleep may cost time. Global work has not disappeared,
wearable summary calculation remains necessary, and no production percentage is
established until representative measurements support it.
