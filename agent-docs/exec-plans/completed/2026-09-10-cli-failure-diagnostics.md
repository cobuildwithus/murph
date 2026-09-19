# Finite CLI failure diagnostics

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and scope

Explain failed timed CLI calls using optional finite code/stage/count summaries,
without collecting private data or changing tool behavior. Base: 4949045492c.
Production scope is the portable timing owner, invocation owner and existing
Incur error bridge. No experiment/session changes, bundler changes, new sinks,
public changelog, dependencies, deployment or real-model journey.

## Tasks and decisions

1. Add deterministic session-failure regression before source changes. The
   real-entry test uses fake handlers, real Incur errors and the existing real
   loopback transport; compare disabled/enabled output and exits.
2. Capture own data properties before Incur projection; retain only the first
   finite pair per invocation. Count at completion, never per catch.
3. Extend the existing command/outcome identity with at most eight failure
   pairs and a diagnostic-only drop counter. Independently discard malformed
   optional details; use the same normalizer throughout the usage pipeline.
4. Prove nested-scope/batch counting, privacy, bounded merges, current parsing,
   old-reader skew, body fitting and persisted normalization with synthetic data.
5. Update the telemetry owner with limitations, consumer-first rollout, bounded
   aggregate SQL and a two-independent-turn decision threshold.

## Parent qualification (2026-09-10)

The parent ran the real CLI shell/entrypoint and loopback UDP regression with
installed patched Incur 0.5.1. Before source application, this targeted command
failed because `failures` was absent rather than
`invalid_payload / validation / count=1`; applying the source made it green:

```sh
pnpm --dir packages/cli test test/cli-timing.test.ts -t 'real entry and loopback retain original session'
```

Focused checks on the applied implementation used actual repository runtimes:

| Command | Result |
| --- | --- |
| `pnpm --dir packages/cli test test/cli-timing.test.ts` | 9 passed |
| `pnpm --filter @murphai/runtime-state test test/cli-timing.test.ts` | 18 passed |
| `MURPH_CLI_FAILURE_COMPAT_BASE=4949045492c pnpm --filter @murphai/assistant-engine test test/cli-timing-profile.test.ts test/cli-timing-transport.test.ts` | 13 passed; 1 unrelated pre-timing historical-base test skipped |
| `pnpm --filter @murphai/hosted-execution test test/assistant-usage.test.ts` | 28 passed |
| `pnpm --dir apps/cloudflare test:node:workspace test/usage-record-port.test.ts` | 6 passed |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-execution-usage.test.ts` (repository root) | 42 passed |

Total: **116 passed, 1 unrelated historical test skipped**. The actual
pre-failure reader compatibility test passed for both profile v1 and v2.
Typecheck entrypoints passed for runtime-state, CLI, assistant-engine,
hosted-execution, Cloudflare and Web. Web prerequisites (Health Commons, Prisma
and changelog generated files) were prepared normally; Prisma used a synthetic
local database URL without contacting a database. `pnpm docs:drift`,
`pnpm logs:guard` and `git diff --check` passed. The parent reviewed all three
production diffs and found no current correctness or privacy gap.

## Complexity correction and remaining gates

The parent's `pnpm complexity:diff --base 4949045492c` found
`normalizeCommandFailures` at complexity 22 against threshold 20 (file debt
0 -> 2, maximum 15 -> 22). The other two production files passed.
The correction removes the redundant array/null branch, checks an entry before
reading its count, and derives sum safety from nonnegative validated counts
bounded by the validated safe call count. The catch boundary, finite vocabulary,
array length/index bounds, single property reads, drop accounting and tests are
unchanged; no helper, dependency or guard exception is added.

The parent reruns affected proof and the complexity guard after applying this
incremental correction. Required exact-head CI and final external review remain
pending. Keep this plan active through the final PR completion gate; the parent
closes it through the documented `scripts/finish-task` lifecycle. No merge or
deployment is part of this task.
Completed: 2026-09-10
