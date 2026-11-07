# CLI source-cause diagnostic for unresolved meal and response failures

Status: active
Created: 2026-10-22
Updated: 2026-10-22

## Goal

Distinguish existing typed causes currently collapsed into CLI timing
`unknown` for `meal edit`, `meal remove-photo`, `food search-labels-batch` and
`research scout-batch`. Preserve command behavior, canonical state ownership,
failure accounting, privacy and compatibility with the reviewed base.

## Success criteria

1. Real CLI handlers with synthetic vaults/fake providers demonstrate multiple
   meal and response failures sharing the base timing bucket. The reproduction
   establishes diagnostic loss, not which cause occurred in production.
2. Only exact command-owned literals survive in optional `failure.sourceCause`;
   existing `failure.code`, `stage`, `count`, public errors and exits are unchanged.
3. The production sender/receiver, profile extraction and hosted admission retain
   the detail. Distinct causes retain distinct variants under existing caps;
   legacy absence, success and quiet invocations remain unchanged.
4. Hostile descriptors/proxies, inherited and malformed values, unknown codes,
   other commands and synthetic private sentinels cannot escape admission.
5. The actual base portable and hosted readers drop only new detail, coalesce
   equal old variants and retain timing, failure counts, profiles and tokens.

## Scope

Production edits are limited to the existing portable timing contract and Node
original-error observer in `packages/runtime-state`. Tests extend the existing
runtime-state, CLI and assistant-engine timing fixtures. The package README owns
the added contract; the telemetry guide links to it.

No prompt, application schema/tool contract, provider request, retry, timeout, scheduling,
catch/throw behavior, canonical mutation, global failure vocabulary, dependency,
state/store, monitoring control or daily-schedule change is in scope. Arbitrary
shell exits receive no new telemetry. No changelog is needed for internal detail.

## Constraints

Base: `704630e3fda169456458db4c7a0f50121be120ee`, supplied as a canonical source
snapshot. All fixtures and evidence are synthetic. The patch author has no
production access and does not commit, push, create a PR or deploy. The parent
applies the exact patch and owns repository typecheck, focused execution,
candidate review, final ReviewGPT, CI, PR and release.

No real-assistant journey is required while the patch remains telemetry-only
and changes neither prompt nor tool behavior. Release is already authorized;
the deployment blocker is unavailable native same-task heartbeat/wakeup
capability. No native task tool is exposed, and Computer Use explicitly denies
the Codex app. No merge, deployment or monitoring has occurred. Implementation
and PR preparation may proceed. Keep this plan active until the parent's
remaining verification and release handoff are resolved.

## Risks and mitigations

1. New diagnostic detail could leak arbitrary error context. Use only own data
   descriptors, exact command/literal membership and fresh finite objects;
   never inspect messages, causes, paths, arguments or results.
2. Distinct causes could merge or overflow accounting. Extend only existing
   variant equality and normalization, retaining cap eight and current counters.
3. Deployment skew could lose whole profiles. Add an optional field instead of
   expanding a global code catalog; exercise the actual base readers. Prefer
   readers before producers for coverage. Old-reader rollback loses detail,
   not legacy accounting; no state migration or backfill is needed.

## Tasks

1. Trace registered handlers, event mutation mappings, provider classifiers,
   error bridge, timing collection and all reader boundaries at the supplied base.
2. Author and run the focused base collapse reproduction where dependencies
   permit. Retain executable proof for local verification when unavailable.
3. Add the optional finite selector at the existing runtime-state owner and reuse
   it for wire admission. Preserve code/stage and extend failure variant equality.
4. Exercise real CLI direct/batch behavior, nearby success/quiet cases, provider
   request counts and canonical mutation boundaries. Exercise hostile input,
   bounded merge, sender/receiver/profile/hosted admission and actual base readers.
5. Deliver one applicable patch with precise executed/unexecuted verification
   status. Parent runs remaining checks, reviews the exact diff and handles release.

## Decisions

- One optional `sourceCause: { code, vaultCode? }` on existing unknown failures
  preserves old-reader data. No additional observation, capture hook, transport,
  event or timing identity is added.
- `meal edit` admits the usecase's `contract_invalid`, `invalid_timestamp` and
  `vault_error`. `meal remove-photo` admits only `vault_error`, optionally
  distinguishing the core's retained-byte precondition and manifest failures.
  Already classified not-found and ordinary-photo rejection remain unchanged.
- The eight food codes distinguish existing response auth, rate, HTTP timeout,
  availability/rejection, body timeout/read and JSON/schema decisions. The six
  research codes distinguish existing response auth, rate, availability,
  invalid-response, rejection and timeout decisions. Configuration and
  transport-only codes are excluded. Shared request/response codes keep their
  original stage, and combined source codes are not split speculatively.
- Typed-cause observations cannot recover historical raw errors. Any later
  behavior correction needs a separately reproduced cause. Deduplicate repeated
  profiles by turn and do not add overlapping native completion counts.
- The review revision changes only the CLI test and this plan. Freeze `Date` at
  `2030-01-15T12:00:00.000Z`: the real date-only CLI end bound clamps to that
  instant, which is also passed to the real request builder. Restore real timers
  in shared cleanup, including assertion failures. Preserve all exact request,
  error identity, output/exit, one-request/no-retry and mutation assertions.
  Annotate the history read as `Buffer` without changing the byte comparison.
  Both production timing owners remain byte-identical to the original patch.

## Verification

Initial author checks in the isolated source-snapshot environment:

- Five new runtime-state regression test bodies passed with the native Node
  test runner, after TypeScript stripping and substituting only the runner
  import. They used the actual owner modules and existing `sample` fixture;
  this was not a Vitest run or repository typecheck.
- Direct assertions against the supplied, unchanged base and new timing owners
  covered 18 command/code pairs, original error identity, unchanged legacy
  code/stage, own-data gates, hostile metadata, variant caps, overflow and
  copies. Actual base/current hosted admission retained profile v1/v2 and token
  accounting while the base reader dropped the optional detail. These used
  synthetic typed errors, not real CLI handlers/providers.
- Node TypeScript syntax stripping passed for all six edited source/test files.

The author snapshot has no installed dependencies or Git history. Available
Node is 24.19.0, below required 24.22.1, and available pnpm is 11.25.0 rather
than pinned 10.33.0. Fetching the pinned package manager failed with network
`EPERM`; offline install rejected the engine mismatch. Frog is not installed.
The actual sender/receiver attempt could not bind: a separate synthetic
loopback bind confirmed `EPERM`. No installation or network control was bypassed.

Parent-reported local results for the exact original patch (SHA256
`cf1c57f133443b69213f38dd3cf1e697bd152784ab5a93da12fa025db520bcd2`), using
Node 24.22.1, pnpm 10.33.0, frozen installation and real Git history:

- BASE meal reproduction passed, including the real contract and both retention
  integrity/manifest errors. Food cases passed before the first research case
  failed with `research_scout_invalid_window` instead of
  `research_exa_auth_failed`. The patched CLI timing suite had 14 passes and
  that same failure. A `Date.now` spy left `new Date()` on the real clock;
  the expected request also incorrectly used midnight for a date-only end bound.
- Runtime-state timing: 62 passed, 16 skipped. Engine timing profile: 13 passed,
  6 skipped, including real subprocess/UDP/hosted coverage. The exact BASE
  compatibility variable was set for both suites, so the new actual-reader
  compatibility tests ran.
- Runtime-state and assistant-engine typechecks passed. CLI typecheck failed
  with TS7022 on the unannotated `execFileSync` result in the BASE helper.
- `complexity:diff --base HEAD` passed: portable maximum 19, Node maximum 14,
  no hotspot above 20 and no increased debt. Patch application, whitespace,
  artifact SHA and direct-identifier checks passed.

Revision author checks: the revised CLI test passed Node TypeScript stripping
and JavaScript syntax checking (not typechecking or Vitest). A full comparison
with the canonical snapshot plus the original applied patch found only this
plan and the CLI test changed; both production timing files are byte-identical.
All focused neighboring suite paths below exist.

The parent's results precede this revision. **Pending for the corrected candidate:**
BASE proof against unchanged timing owners, full affected regressions and the
three package typechecks below. The author has not run the corrected Vitest
suites or repository typechecks; the parent's installed environment supplies
those gates. CI owns broader suites.

The parent reports main advanced to
`eff32234e77173681ae5358a9dd8083d5e6dcd85` with unrelated native cache/image
readiness/test-pruning merges and unchanged production timing owners. The owned
candidate remains the declared base plus the exact original patch; the parent
will integrate main without hand-editing this work.

### Parent execution

Use the repository's pinned Node/pnpm and frozen lockfile. On the owned
candidate, already containing the original patch, apply the incremental revision:

```sh
git apply --check cli-source-cause-revision.patch
git apply cli-source-cause-revision.patch
```

For BASE proof, use a separate clean checkout of the exact base. Apply only the
CLI test-file portions of both artifacts and run the original CLI behavior.
The test-only baseline mode checks
both timing owner files byte-for-byte against `git show` at that base before
any fixture setup; it cannot pass against the patched owners. It exercises the
same real handlers, synthetic meal corruption, fake response providers,
research request builder, direct/batch paths and valid neighbors as the new
tests. Multiple causes must collapse into the existing unknown buckets.

```sh
git apply --check cli-source-cause.patch
git apply --include=packages/cli/test/cli-timing.test.ts cli-source-cause.patch
git apply --include=packages/cli/test/cli-timing.test.ts cli-source-cause-revision.patch
MURPH_CLI_SOURCE_CAUSE_BASELINE=704630e3fda169456458db4c7a0f50121be120ee pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-timing.test.ts -t 'real source-cause'
```

After that proof passes, return to the candidate containing both complete
patches. Do not set the baseline variable for these suites; pass the
compatibility variable so the actual old-reader tests execute instead of skipping.

```sh
MURPH_CLI_SOURCE_CAUSE_COMPAT_BASE=704630e3fda169456458db4c7a0f50121be120ee pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/cli-timing.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-timing.test.ts
MURPH_CLI_SOURCE_CAUSE_COMPAT_BASE=704630e3fda169456458db4c7a0f50121be120ee pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/cli-timing-profile.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-timing-subprocess.test.ts packages/cli/test/food-labels.test.ts packages/cli/test/research-scout.test.ts packages/cli/test/cli-expansion-document-meal.test.ts
pnpm --dir packages/runtime-state typecheck
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/cli typecheck
```

The actual-base checks require that exact revision in the local Git object
database; they must not substitute the new reader or a copied parser. Preserve
the existing fake-provider food/research and meal command checks as focused
neighbors. Record exact commands/results, inspect the complete diff, prepare one
PR and run independent final ReviewGPT before merge. Deployment and
natural-traffic observation stay blocked pending native same-task
heartbeat/wakeup capability; release permission is already present, and
implementation tests do not replace that capability.
