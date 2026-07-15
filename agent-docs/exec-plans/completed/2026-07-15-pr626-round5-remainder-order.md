# PR 626 Round 5 Hosted Remainder Ordering

## Goal

Prevent a hosted foreground boundary input from overtaking the uncovered
successor left pending after terminal-evidence prefix repair.

## Constraints

- Keep the pending-input index as the existing durable source of truth.
- Preserve the original accepted input records and causal order when rebuilding
  an invocation-local rerun batch.
- Rebuild only after a clean, progressed foreground pass; preserve the existing
  precomputed tail for failed or non-progressing passes.
- Keep assistant-engine prefix recovery as the sole recovery owner.
- Do not add persisted state, a queue, a scheduler, or a second grouping owner.
- Preserve unrelated working-tree and coordination-ledger changes.

## Plan

1. Add a production hosted-entrypoint regression for historical handled
   `[A, B]`, uncovered compatible successor `C`, and boundary input `D`.
2. Prove the current runtime repairs `[A, B]` without a provider request but
   incorrectly runs `D` before `C`.
3. Rebuild the local rerun tail from the existing pending-input index
   intersected with the full accepted batch after a clean progressed pass.
4. Prove provider turns run `C` then `D`, no input remains pending, and the
   existing retryable-selected-input behavior is unchanged.
5. Run focused tests, package verification, the required coverage audit,
   exact-head CI, and ReviewGPT round 6 before merge.

## Verification

- Focused production hosted-entrypoint regression before and after the fix.
- Existing hosted workspace-runner remainder and retryable-input regressions.
- Assistant-runtime package typecheck and coverage/diff-aware verification.
- `git diff --check`, required coverage audit, exact-head CI, and ReviewGPT
  round 6 with zero findings.

## State

ReviewGPT round 5 found a confirmed review-induced High causal-order failure in
the composition between prefix repair and invocation-local hosted reruns. The
production entrypoint regression failed on the old `D` then `C` order and now
passes with `C` then `D`, zero provider work for the repaired prefix, and zero
pending residue. Assistant-runtime typecheck, its full no-coverage and coverage
suites, diff-aware reverse-dependent verification, and the required coverage
audit are green; the audit required no further test changes.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
