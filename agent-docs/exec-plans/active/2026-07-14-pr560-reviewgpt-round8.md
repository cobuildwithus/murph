# PR 560 ReviewGPT Round 8 Resolution

## Outcome

Resolve the two accepted round-8 findings without adding a delivery owner or
unbounded foreground scan, reconcile the branch with current `main`, and push
one exact head for CI plus ReviewGPT round 9. Do not merge the PR.

## Constraints

- Keep the assistant outbox as the sole queued-delivery owner.
- Preserve every durable queued intent id across later bubble failures so the
  existing commit-failure cleanup can abandon the complete current-turn set.
- Keep reply and active-turn discovery bounded independently of unrelated
  routes and deferred-only history; do not cap fresh accepted input.
- Preserve reaction context ordering, context-only non-actionability, and the
  existing retained-context limits.
- Preserve unrelated work and keep PR #585 held until PR #560 completes its
  exact-head review and CI gates.
- Reconnect an existing exact-head ReviewGPT controller if one appears; never
  launch a duplicate. Do not merge.

## Steps

1. Reproduce both round-8 findings against the live branch and current owner
   contracts, checking current `main` for already-landed corrections.
2. Add the smallest owner-bound delivery and bounded-discovery corrections with
   focused regressions.
3. Reconcile current `main` with ordinary Git history, resolve only proven
   conflicts, and rerun the routed verification plus specialist audits.
4. Close this plan in the scoped commit, push the exact head, then start or
   reconnect ReviewGPT round 9 concurrently with CI and report without merging.

## Status

- Active: both round-8 findings, the account-bound route isolation audit
  finding, and same-fresh-batch context retention are corrected. Current
  `main` is merged; final scoped verification and exact-head gates remain.

## Verification

- Passed assistant-engine, assistant-runtime, and hosted-execution typechecks
  after reconciling current `main`, including final assistant-engine and
  assistant-runtime reruns after the cursor-preservation follow-up.
- Passed six focused queued-delivery cleanup regressions in the implementation
  lane and the store-backed input-source suite during development.
- Passed the focused store-backed, hosted-source, and scanner-resume
  regressions proving deferred context remains available after an unrelated
  actionable cursor advances.
- Passed seven assistant-engine causal-selection/bounded-discovery regressions
  and four assistant-runtime route-isolation/context-bound regressions after
  the follow-up.
- Passed 27 hosted-execution builder and contract-guard tests after the final
  base merge.
- Passed mandatory security/privacy and coverage-write audits; both audit-found
  gaps were corrected with focused regressions.
- Passed diff-check, conflict-marker, unmerged-file, retired-route-proof, and
  non-mutating mergeability checks after reconciling current `main`.
- Pending final hygiene/base-alignment checks, exact-head CI, and ReviewGPT
  round 9.
