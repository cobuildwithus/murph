# Automation-list validation telemetry

Status: active — patch authored; parent verification and PR gates pending
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

## Verification and handoff

- Authored: real CLI invalid limit/status and nearby valid list, no calls/writes,
  exact output/exit parity, finite original/completion projections, omissions,
  hostile/private decoys, consumer round trips and actual older-reader proof.
- Local: runtime-state tests under a Node test adapter passed 30, skipped three
  history-dependent cases. Substituting the exact bundled baseline reader made
  all three automation regression checks fail. Direct old/new source comparison
  proved baseline omission and old-reader accounting; portable TypeScript passed.
- Pending: dependency-backed Vitest suites, workspace typechecks, complexity and
  docs guards. The source-only bundle lacks dependencies, Git history and the
  referenced Frog skill; `scripts/frog list` is unavailable without its package.
- Parent: run focused runtime-state, CLI subprocess and assistant diagnostics
  suites; relevant typechecks, complexity and documentation guards. Run the
  compatibility case with `MURPH_CLI_AUTOMATION_VALIDATION_COMPAT_BASE` set to the
  base above. Then draft PR, independent final ReviewGPT and exact-head CI.
- Keep this plan active until parent verification/review closure; archive through
  the normal completion workflow. No commit, push, merge or deployment authorized
  in this authoring handoff. Natural-traffic attribution remains unmeasured.
