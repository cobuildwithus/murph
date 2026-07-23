# Stale fence diagnostic coherence remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Keep stale-fence startup diagnostics attributable to one authoritative fence attempt after a concurrent replacement CAS loss, without changing runtime authority, startup ordering, or latency.

## Success criteria

- A focused regression first reproduces the mixed-attempt diagnostic bundle on the current PR head.
- CAS-loss convergence drops prior-fence wake and replacement-clear leaves before probing the authoritative fence.
- Initial assistant-runtime import preserves one coherent attempt-local orchestration bundle while retaining non-conflicting caller context.
- Focused controller, container-entrypoint, assistant-runtime, contract/parser, typecheck, canonical diff, and acceptance checks are recorded.
- The exact remediated PR head is prepared for ReviewGPT round 2 and CI, which run as the subsequent PR gates.

## Scope

- In scope: diagnostic seed ownership in the UserRunner controller and assistant-runtime initial import; focused tests; hosted-runtime protocol documentation; PR evidence.
- Out of scope: new startup overlap, parallel RPCs, fence-policy changes, Web persistence semantics, unrelated current-main verification failures.

## Constraints

- Technical constraints: pure in-memory field handling only; no new asynchronous work, network/storage reads, timers, or changes to fence lifecycle decisions.
- Product/process constraints: one writer and one serial verifier in this checkout; read-only helpers may inspect static code only; preserve unrelated work and the immutable ReviewGPT first-reviewed head.

## Risks and mitigations

1. Risk: resetting too much context hides caller-level routing or latency evidence.
   Mitigation: reset only the fixed attempt-local wake/replacement group and test survival of unrelated orchestration leaves.
2. Risk: changing merge precedence creates another cross-attempt hybrid.
   Mitigation: merge the attempt-local group atomically and exercise conflicting seeds at the exact initial-import boundary.
3. Risk: remediation changes runtime behavior or adds latency.
   Mitigation: keep the patch synchronous and allocation-only, preserve control flow, and review the production diff for new awaits/RPCs/storage/timers.

## Tasks

1. [complete] Add and run a focused failing CAS-loss regression that proves the ReviewGPT mechanism.
2. [complete] Inspect initial-import history and tests, then implement the smallest group-coherent merge and controller reset.
3. [complete] Add focused regression coverage and update the durable protocol description.
4. [complete] Run serial verification, complete the scoped local review and commit path, and prepare the final PR gates.

## Decisions

- Reject the previously explored startup-overlap optimization: this PR remains diagnostics-only because the latency win was not proven safe enough.
- Keep Web's first-leaf persistence unchanged; prevent incoherent bundles before their first durable write.
- Accept the final ReviewGPT finding as proven: before remediation, the focused concurrent-CAS regression observed prior-fence `activeWakeAccepted: false` on the authoritative-fence wake, and the initial-import regression observed pending-wake start/finish/classification overriding the invocation bundle while retaining its elapsed/clear leaves.
- Remediate only the two ownership boundaries: sanitize the CAS loser's superseded bundle before recursion, and make the invocation seed authoritative only at the sole initial-import merge call.

## Verification

- Commands to run: focused Vitest targets for UserRunner/controller, container entrypoint, assistant-runtime initial import, and hosted-execution parsing; affected typechecks; `pnpm test:diff ...`; `pnpm verify:acceptance`; exact-head PR/ReviewGPT/CI checks.
- Expected outcomes: new regressions pass with no control-flow changes; any unrelated current-main failures are attributed with direct proof.
- Red/green proof: the controller regression failed on retained `activeWakeAccepted: false`, and the assistant-runtime regression failed on pending-wake overlap; both pass after the two synchronous field-ownership changes.
- Green owner proof: UserRunner 90/90, container entrypoint 47/47, full Cloudflare Node 1,857/1,857, Cloudflare Workers 1/1, assistant-runtime entrypoint 233/233, full assistant-runtime 1,791 passed with 2 skipped, both affected typechecks, hosted-execution 381/381, and docs drift.
- Canonical `test:diff` reached all affected typechecks and failed once in an unchanged clinical-records preemption test; its focused serial rerun passed immediately, and the full owner suite was already green.
- Canonical acceptance passed every package/app typecheck and all reached package coverage except the then-current-base CLI policy-string assertion and three unchanged assistant diagnostics tests that read incompatible state from their hard-coded shared temporary vault. Current `origin/main` has since repaired the CLI assertion. The ambiguous shared vault was preserved rather than deleted.
- Post-merge proof: current `origin/main` merged with no production-code conflicts; both focused regressions, both affected single-threaded typechecks, docs drift, and the repaired CLI release-audit file (40 passed, 1 skipped) are green on the merged head. Final ReviewGPT round 2 and CI remain the PR-level gates required after plan closure.
Completed: 2026-07-22
