# Automation-list validation telemetry

Status: completed
Created: 2026-09-18
Updated: 2026-09-18
Base: `5189dace0ad608208702a12ece4f95e76b619e59`

## Outcome and boundary

Attribute existing `automation list` validation failures to exact `limit` or
`status` fields through `runtime-state/cli-timing.ts`'s shared finite helper.
Synthetic invalid-limit/status probes establish missing telemetry, not a model
instruction defect. Keep error identity/prose, CLI output, success, accounting,
privacy, dynamic tools and all product behavior unchanged. No new state, parser,
transport, dependency, retries or public changelog (internal content-free detail).

## Implementation and rollout

One allowlist entry serves original-error capture, wire consumers and assistant
completion projection. Reuse subprocess and diagnostics fixtures; no live
provider or production access. Durable contract and natural-traffic query:
`docs/hosted-runtime-log-database.md`, Optional schema-validation detail and
Automation-list validation inspection. Consumers precede producers; old readers
omit detail without losing counts. No backward recovery. Inspect each newly
attributed event, including singletons; a behavior change needs separate proof.

## Implementation and local proof

- Coverage: real CLI invalid limit/status and nearby valid list, no calls/writes,
  exact output/exit parity, finite original/completion projections, omissions,
  hostile/private decoys, consumer round trips and actual older-reader proof.
- Supplemental author proof: substituting the exact bundled baseline reader made
  all three automation regression checks fail. Direct old/new source comparison
  proved baseline omission and old-reader accounting; portable TypeScript passed.
- Parent-reported native/local verification, not rerun in this docs-only handoff:
  runtime-state focused tests passed 31, with two unrelated history-only cases
  skipped. `MURPH_CLI_AUTOMATION_VALIDATION_COMPAT_BASE` was enabled with
  `5189dace0ad608208702a12ece4f95e76b619e59` for automation compatibility proof.
  Real CLI timing subprocess tests passed all 18 cases;
  assistant-tool-failure-diagnostics passed 156. Runtime-state, CLI and
  assistant-engine package typechecks passed. Complexity guard passed with
  debt 0, max 19 and no hotspots. Docs drift and gardening passed with zero
  issues; `git diff --check` was clean.

Focused CLI timing rerun command (repository root):

```sh
pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage \
  test/cli-timing.test.ts
```

## Closure and evidence limits

Parent applies this followup only at closure, after confirming the native CLI
suite pass and satisfying the remaining completion gates. This patch leaves the
plan in `active/`; `scripts/finish-task` performs the mechanical archive. The
index names the eventual `completed/` path for that closure, not an earlier move.

The final PR body records exact executed commands/results and independent final
ReviewGPT, exact-head CI and any separately authorized deployment outcomes.
Implementation/local proof does not establish those separate outcomes. Closing
this plan implies neither deployment nor a behavior fix; natural-traffic
attribution remains unmeasured. Source, tests and the telemetry contract are
unchanged by this followup.
Completed: 2026-09-18
