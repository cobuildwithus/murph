# CLI failure telemetry and subprocess proof

Status: active — incremental revision; local parent owns remaining validation/Git/PR/archive
Created: 2026-09-11
Updated: 2026-09-11
Base: `09a3cef815a995615d2872f3ade1ab5e796652f1`

## Outcome and boundaries

Retain finite CLI failure observations at real process termination and explain
otherwise-unattributable shell failures. Use existing runtime-state timing,
CLI exit, command-family and action-diagnostics owners. No change to command
results/hints, canonical writes, tool policy, retries, delivery, model decisions,
provider behavior or advertised instructions. No production access or secrets.
Do not duplicate the merged timing instrumentation or bundle ownership work.

## Execution

1. Reproduce default dgram lookup loss with the real production module and real
   child exits, both immediately and after binding; retain a regression test.
2. Use synchronous source-owned IPv4 loopback lookup and exclusive ephemeral
   bind. Preserve unref, best-effort send, caps and authoritative exits; no wait,
   timer, retry, filesystem, supervisor or second diagnostic transport.
3. Add finite diagnostic-only attribution reasons, catalog-proven CLI identity
   and normalized code/stage at the existing completed-action owner. Preserve
   search suppression/recovery, ordinals, deduplication and metadata limits.
4. Test CLI rejection and nearby success paths in isolated real subprocesses,
   reuse food-client success response scaffolding, compare telemetry on/off
   output and exits, assert no unexpected fetches or filesystem changes.
5. Document optional old/new consumer compatibility and hand off focused gates.
6. Resolve the parser complexity regression with one null-envelope guard before
   envelope selection; preserve bounds, accepted shapes and finite metadata.
   Keep unfinished local evidence pending and leave plan closure to the parent.

## Evidence and remaining uncertainty

### Implementation author environment — prior patch

Synthetic direct production-module probe on Node 22.16.0: before correction,
immediate and already-bound forced exits each delivered 0/5 reports; natural
error exits delivered 5/5. After correction all three delivered 5/5. The 22
runtime timing tests passed using Node strip-types and a temporary
Vitest-to-node:test registration adapter outside the patch. Sender-only rollback
failed the new forced-exit tests. The actual base reader accepted the three new
exercise codes as `unknown`, preserving counts/outcomes. The two runtime timing
source modules passed standalone strict TypeScript checking with available
global Node types; all 15 changed TypeScript files passed syntax transpilation.
These are author-environment results, not workspace Vitest or supported-runtime
package typecheck results.

The author archive has no installed workspace dependencies. Supported Node
>=24.14.1 and pnpm 10.33.0 were unavailable; dependency acquisition was unavailable.
`.agents/skills/frog/SKILL.md` is absent and `scripts/frog list` reports Frog is
not installed. No pass is claimed for unavailable tools or a live-model journey.

### Local parent — reported before this revision

The parent independently verified and applied the original `implementation.patch`
and reported the following on supported Node 24.14.1. These are parent-provided
results for that implementation, not author-executed checks of this revision.

| Check | Reported result |
| --- | --- |
| New runtime subprocess test applied alone to base | RED: forced exit received 0 reports versus expected 1; natural-error code was `unknown` versus the new exercise code. |
| Full-patch runtime timing suite | 22 PASS. |
| Six focused assistant suites | 262 PASS, 2 optional skips. |
| Runtime-state and assistant-engine package typechecks | PASS. |
| Complexity guard | FAIL: action-diagnostics debt 15 -> 17 (+2), maximum 30 unchanged; `readVaultCliFailure` 22. Existing `recordEvent` hotspots remain 30/25. Other four changed production source files pass. |
| Real CLI subprocess/food/exercise tests and CLI package typecheck | Running when reported; results remain pending with the parent. |

### Incremental revision — author environment

One explicit null-envelope guard replaces three redundant optional member
accesses. No helper, configuration, catalog, reporting or domain behavior changes.
Five synthetic non-object JSON cases extend the existing failure-diagnostics
suite. A temporary TypeScript-AST count using the repository guard's branch
predicates reproduces the parent's 22/17/30 measurements and gives parser
complexity 20, file debt 15 and maximum 30 after revision; both `recordEvent`
hotspots are unchanged. This is not a run of the unavailable Babel-backed
`pnpm complexity:diff` command.

On Node 22.16.0, 10,607 synthetic before/after comparisons passed using the
source-extracted parser functions and actual category/code/stage owners.
Results and JSON parse-call counts matched, including direct/full envelopes,
non-object roots, unknown values, output aliases and byte bounds; synthetic
secret/health/path sentinels never appeared in diagnostics. Both changed
TypeScript files passed syntax transpilation. Workspace Vitest and package
typechecks were not run here; the parent must verify this revised candidate.

The revision archive omits execution plans. The documentation delta uses the
exact already-applied plan recovered from the verified original patch.

### Remaining uncertainty

The evidence identifies telemetry transport loss, not the actual arguments or
root causes of production food/exercise failures. Invalid food limits, invalid
exercise kinds and missing exercise lookups remain expected rejections, not
repaired domain behavior. This revision preserves the prior parser's accepted
envelope shapes, privacy guards and category/code/stage semantics.

## Pending local validation / completion owner

After applying this revision, run the narrow changed-owner checks in the normal
installed workspace:

```sh
pnpm complexity:diff
pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts packages/assistant-engine/test/assistant-tool-failure-diagnostics.test.ts
pnpm --dir packages/assistant-engine typecheck
```

Record the already-running real CLI subprocess/food/exercise test results and
CLI package typecheck result; do not duplicate that running work or mark it
passed without a result. Existing public-artifact preparation helpers remain
`pnpm exercise-library:generate` and
`node scripts/ensure-health-commons-generated.mjs` when needed for a focused
rerun. Do not repeat passed runtime checks solely for this parser simplification.

The current verification and completion owners assign broad PR checks to
required exact-head CI, with focused tests and package typechecks locally.
No local umbrella acceptance or root typecheck is a required gate for this PR.
Existing food-provider failure tests remain authoritative; do not add live
provider or real-model tests for this telemetry-only change. The parent owns
remaining focused validation, candidate review, Git/PR completion, required CI
and the later completion archive. Keep this plan active until that handoff is
finished.

New fields remain optional with the current issue/timing schema versions;
deploy catalog-aware readers before writers where possible. Older readers
reduce new codes to `unknown`, preserving outcome/count data. This revision
changes none of those compatibility contracts.
