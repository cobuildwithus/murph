# PR 528 durable route-repair proof

## Goal

Make legacy personal-home reminder route repair survive persisted-input replay, ordinary input-residue pruning, and transient canonical-write failure.

## Evidence

- ReviewGPT's exact-head audit at `0d1412a33204607fbd1d626f73131ca0e61afe84` found that the repair trigger reads only invocation-local input IDs.
- The former-target proof is reconstructed from the oldest 100 generic input events even though settled events are pruned after 14 days or beyond the retained count.
- The post-checkpoint best-effort wrapper converts ordinary repair failures to `null`, after the proof-bearing input has already advanced.
- Static tracing confirms each path is reachable in the current production wiring.

## Constraints

- Keep web routing as the authority for the former/current direct-home transition and core automation as the sole canonical route writer.
- Reuse the existing durable mailbox retry/checkpoint lifecycle; add no scheduler, queue, lifecycle manager, or new durable state owner.
- Preserve foreground reply behavior, fail closed on missing/conflicting proof, and keep group, archived, and unrelated routes unchanged.
- Preserve unrelated work and do not signal unowned processes.

## Implementation

1. Carry the routing transaction's narrow former/current direct-home proof on the immutable Linq conversation mailbox wake.
2. Preserve that proof on the accepted assistant input event and derive repair targets only from the selected direct Linq inputs for the current pass.
3. Run the core route repair before the workspace checkpoint; allow failure to abort the checkpoint so the mailbox item remains pending for the existing wake/retry path.
4. Delete the generic input-history scan and decouple repair from broad managed-seed reconciliation.
5. Add regression proof for persisted pending input, mixed-channel input, pruned history independence, transient failure retry, conflicts, and unchanged route classes.

## Verification

- Run focused tests and typechecks for hosted-execution, web routing, assistant-engine, assistant-runtime, and core.
- Run the repository-selected diff/owner coverage lane when resource gates allow, plus parent final review and exact-head CI.
- Push the corrected head, then run exactly one published ReviewGPT 0.5.106 audit on Eragon with a 120-minute timeout while CI runs.
- Resolve every finding and GitHub thread before merge-ready handoff.

Completed local evidence:

- Directly changed owner typechecks passed for hosted-execution, assistant-engine, assistant-runtime, and web.
- Coverage passed for hosted-execution (288 tests), assistant-engine (2,052 passed, four skipped), and assistant-runtime (1,527 passed, two skipped).
- Focused and full changed-file routing tests passed, including persisted-input retry, mixed input, conflicting proof, mailbox metadata, parser round-trip, and both web route-binding/dispatch surfaces.
- Scenario integrity passed for 205 scenarios, 11 sample inputs, and 28 golden-output directories; documentation drift, whitespace, and identifier-pattern checks passed.
- The truthful diff lane reached reverse-dependent typecheck and stopped on pre-existing unresolved operator-config entrypoints outside the changed owners. Web verification likewise exposed shared dependency-link contamination outside the diff after 3,624 tests passed; the two changed-file fixture failures it identified were corrected and the full changed routing file then passed all 31 tests.
- Controller instructions prohibited local audit helpers, so security/privacy, coverage sufficiency, and final call-path review were completed by the parent before the required external PR audit.

## Completion

- Finish through `scripts/finish-task` with the ledger row removed and this plan archived.
- Keep the PR worktree until PR closure or merge.

Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
