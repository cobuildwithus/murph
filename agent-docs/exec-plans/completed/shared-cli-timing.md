# Shared Vault CLI timing — active execution plan

## Outcome and boundary

Declared base: `7ed31fa5544309ade0988aacf84e79d5ffc6c072`. Deliver one complete
replacement patch for all-Vault-CLI lifecycle timing and shared query-freshness
attribution. Neither earlier patch is a prerequisite. Keep assistant-visible
arguments, results, ordering, freshness, authorization, cancellation, retry,
timeout and accounting unchanged. No optimization, dependency, schema migration,
public changelog, deployment change or permanent collection owner is in scope.
The original aggregate evidence motivates measurement, not a speedup claim.

## Owners and privacy

`runtime-state` owns the closed wire contract and invocation-local timing scope.
The CLI's existing vault-context ALS retains vault authority. `cli-entry.ts` /
`createVaultCliShell` own common entry/action and native Incur middleware,
including scoped/full routing and recursive batch children. `query-projection.ts`
owns manifest/status, existing single-flight rebuild/wait, and rechecks; await
order and concurrency owners stay unchanged.

The existing `CodexAppServerProcess` owns an unreferenced loopback socket and a
bounded active window. Summaries reach existing raw events, the turn-profile
extractor, hosted usage normalization and storage. The live documentation and its
existing `agent-docs/index.md` row identify this usage-profile contract. No argv,
values, IDs, paths, SQL, health/provider content or error text enter diagnostics.
Ephemeral transport keys/ticks are discarded before persistence. No awaited
send, filesystem spool, retry or assistant-visible transport is added.

Closed names and safe integers are validated at phase/command/report boundaries.
Whole omitted summaries contribute their call counts to `droppedCalls`; retained
summaries are not a random sample. Batch parent counts are separate from child
latency. Lost packets, hard kills, out-of-window work and disabled networking
remain missingness, not zero or inferred timeouts. Existing permissions, retention
and consumer-first rollout remain unchanged.

## Implemented corrections

- The complete UDP envelope cap is 8,192 bytes rather than 32,768, below the
  reported supported macOS host's 9,216-byte limit. Existing pre-send trimming
  conserves retained plus dropped calls. Receiver tests send valid JSON at
  8,192 and 8,193 bytes; both fit that host limit, so the latter tests receiver
  rejection rather than `EMSGSIZE`. No sysctl, permissions, retries or splitting.
- Optional normalization is split at phase/command/report contracts; diagnostic
  extraction is outside the legacy profile reducer. No guard exemptions or
  relaxed validation. Native token fixtures assert request accounting. Explicit
  history-dependent proof loads the actual base consumer; a current-parser
  legacy-shape roundtrip is not described as old-consumer proof.
- Startup tests distinguish empty process exit from a native initialize RPC
  error. The receiver mock now returns a diagnostic only once, then null, just
  like the production window. Catch/finally cleanup is unchanged. Assertions
  preserve exact native evidence and zero tool/provider-action accounting.
- The built-hosted fixture requires the pinned Codex and actual
  `packages/cli/dist/bin.js`, the production config builder, existing member
  workspace profile and environment allowlist. It uses synthetic local files
  and a local fake provider only. The test-only shell sets
  `OPENSSL_CONF=/dev/null`; initialization and both parity children use that same
  setting. The variable is NOT added to production shell admission.
- Telemetry-disabled and enabled built children now run inside the same hosted
  shell/profile. Their completed status and separate stdout/stderr bytes must
  agree. The authoritative current `custom_tool_call_output` is inspected; no
  nested `commandExecution` event is assumed. Native startup errors and later
  child launch/module-read failures fail explicitly, even if the fixture wrapper
  exits successfully. No broad copies, extra workspace roots or source fallback.
- Scoped `goal list` and full `family list` require lifecycle phases and no
  invented query phases. A third, built `wearables latest` with a fixed synthetic
  date requires actual manifest/status/freshness phases. Only the enabled child
  contributes a report/call. Nonempty native session, unchanged continuation
  session and `warm-reused` traces remain required.

## Current fixture/CI admission correction

Only `hosted-runtime-codex-config.test.ts`, this plan and the live owner docs
change relative to the portable-hosted candidate. All production files,
permissions, allowlists, workflows, guard configuration and the existing docs
index contract row remain byte-identical to that candidate.

- A fixed test-only `MURPH_CLI_TIMING_SHELL_RESULT=` line carries the fixture's
  shell result inside native output framing. The parser still selects exactly
  the current `custom_tool_call_output` by call ID and requires one valid result,
  successful shell status, successful nested children and per-stream byte parity.
  Default deterministic tests exercise headers, text arrays, stale warm history,
  missing/duplicate/malformed evidence and identical child failures.
- The built proof is explicitly opted in with
  `MURPH_RUN_HOSTED_CLI_TIMING_E2E=1`, like the existing hosted auth/compaction
  gates. Default source/coverage suites do not require dist CLI artifacts; the
  new deterministic fixture tests and existing production-surface tests still
  run. Enabling the gate never turns artifact/read/network failures into skips.
- Optional absolute `MURPH_HOSTED_CLI_TIMING_CLI_BIN` selects the actual freshly
  packaged CLI's `dist/bin.js` under an already-permitted runtime/temp root.
  Default is the checkout's built entry, only suitable in an already-readable
  layout. The test checks entry shape and package identity, not artifact age.
  Neither test variable enters production environment admission. No source
  loader, broad repository copy, extra workspace roots or permission changes.
- The live docs give exact prepare/run commands using the existing release
  packer and native install of local public tarballs. That established packer
  retains compiled internal payloads and patched bundled dependencies without
  using the runner installer's Linux target on a macOS host. The parent prepares
  from the current candidate and supplies the path; the test does not package,
  install or fetch anything. No staging abstraction or new CI build is added.

## Parent evidence (portable-hosted candidate, before this fixture correction)

Supported Node 24.14.1/macOS validation reported: full CLI closure build PASS;
engine transport/profile/actual-base-consumer/startup tests 53 PASS; runtime-state
11 PASS; query concurrency 4 PASS; hosted usage 25 PASS; actual complexity guard
PASS against the original base. CLI regression and package typecheck reruns were
still in progress at the latest report, not completed proof for this replacement.
Earlier corrected-candidate engine/runtime/runtime-state/hosted typechecks and
CLI/query checks remain recorded history, not fresh reruns.

The built-hosted gate failed on two fixture assumptions: native output is framed
with status/wall-time/Output headers, and the installed checkout entry was outside
the existing profile's read grants. The shell launched with the test-only OpenSSL
setting; nested children then reported module-read failure despite the built file
existing outside the sandbox. These are not UDP permission failures. This
replacement addresses framing and permits an explicitly prepared readable
artifact; success still requires the enabled gate's actual native run.

Direct built goal/family processes previously passed endpoint-absent/enabled
stdout/stderr parity and exit 0 with 759/765-byte lifecycle reports. Direct built
wearables-latest emitted manifest/status/freshness phases. These operational
checks and source-bin/unrestricted scripted success do not substitute for pinned
Codex under the production named profile. No machine-local socket denial is
encoded as a product requirement.

Mixed-version proof: the parent enabled `MURPH_CLI_TIMING_COMPAT_BASE` and ran the
actual Git-base usage consumer against new producer output; that passed. New
consumer/legacy-shape roundtrips are labeled separately. Malformed optional
metrics do not invalidate otherwise-valid legacy/tool/request accounting.

Benchmark method: 2,000 warmups per mode, 15 rotated rounds of 2,000 iterations.
Parent median block means: original 0.2836665 us, disabled 1.211104 us, enabled
4.585021 us; added enabled overhead approximately 4.301355 us. The discard-sink
microbenchmark excludes transport and actual CLI/query work. No per-call
percentile or production speedup is inferred. This fixture-only correction does
not change the measured primitive.

## Local correction evidence and remaining gates

On the available Node 22.16.0, the 11 runtime-state and 5 real UDP transport test
bodies plus the 3 new default fixture tests pass via a `node:test` runner/import
adapter (19 total, zero failures). Three additional isolated checks pass: exact
opt-in selection; hard artifact preflight errors; and the exact parity launcher
running two synthetic children, preserving both streams and sending exactly one
enabled-child packet. These are not repository Vitest, real built Vault CLI,
pinned Codex, or hosted-confinement proof. Strict isolated TypeScript checking
of the exact fixture helpers/default tests/artifact preflight passes.
All 22 changed TypeScript files pass syntax/transpilation checks; the documented
preparation command passes shell syntax checking (not a real package install).
The complete replacement passes clean apply and byte/mode comparison for all
7,719 resulting files, then reverse apply restores all 7,710 original files.

Full workspace dependencies, pnpm, the supported Node version, built CLI and
pinned Codex are unavailable here. The release-pack/install recipe and enabled
built-hosted gate have not run here. A readable package does not prove every Node
or dependency read is permitted: any subsequent native failure remains a hard
failure for the parent to resolve within the unchanged profile. The parent must
finish CLI regressions, package typechecks/builds, the enabled gate, and final
review/CI; the PR is not Ready on the basis of this artifact alone.

## Required parent commands (repository root)

Use supported Node/pnpm and pinned Codex. Default source proof is independent of
built artifacts. Prepare the fresh standalone CLI using the exact commands in
`docs/hosted-runtime-log-database.md`, “Compatibility, rollout and proof”; retain
`MURPH_HOSTED_CLI_TIMING_CLI_BIN` from that preparation for the enabled gate.

```sh
BASE_COMMIT=7ed31fa5544309ade0988aacf84e79d5ffc6c072
pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/cli-timing.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-timing.test.ts packages/cli/test/cli-entry.test.ts packages/cli/test/batch.test.ts packages/cli/test/batch-protocol-error-stages.test.ts
pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/query-projection-concurrency.test.ts
MURPH_CLI_TIMING_COMPAT_BASE="$BASE_COMMIT" pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/cli-timing-profile.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/cli-timing-transport.test.ts test/codex-runtime-helpers.test.ts test/assistant-codex-runtime-process.test.ts test/assistant-codex-runtime-turns.test.ts test/assistant-codex-runtime-config.test.ts test/assistant-codex-runtime-recovery.test.ts
pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/assistant-usage.test.ts
MURPH_RUN_HOSTED_CLI_TIMING_E2E=0 pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts
for package in runtime-state query cli assistant-engine assistant-runtime hosted-execution; do
  pnpm --dir "packages/$package" typecheck || exit "$?"
done
node --import tsx scripts/check-cyclomatic-complexity.ts --base "$BASE_COMMIT" --json
# Prepare the fresh package/closure with the live docs' exact recipe, then:
: "${MURPH_HOSTED_CLI_TIMING_CLI_BIN:?Prepare and select the current built CLI artifact first}"
MURPH_RUN_HOSTED_CLI_TIMING_E2E=1 pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts -t 'shared CLI timing'
node --import tsx packages/runtime-state/bench/cli-timing.ts
```

The history-dependent case explicitly skips without its base variable; its
explicit command remains required. ReviewGPT authors all repository edits and
returns the complete replacement patch; it does not commit or open a PR itself.
The parent is explicitly authorized and required to validate, commit and open the
PR, obtain final ReviewGPT/CI, and pass the enabled built-hosted proof before
Ready. No merge, deployment, production query, secret access or protected
public-main release-contract bypass is authorized. Consumer-first rollout remains
required when later separately authorized. Deterministic output parity, not a
live-model journey, is the proof target.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
