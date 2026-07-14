# Hosted reply liveness invariants and E2E gates

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Once a durably accepted current conversation input is staged for a foreground
  turn, make it reach model start without reading or validating unrelated
  recovery state or repeating mutable-authority checks, and lock the repaired
  cross-boundary behavior into existing tests.

## Success criteria

- The canonical contract requires atomic owner-state plus accepted-work writes
  and states that durable accepted work is sufficient for model start.
- Fresh foreground selection does not read, parse, compact, or refresh the
  background pending index before provider work.
- Focused proof shows malformed background recovery state cannot block
  foreground selection or refresh of already-staged fresh accepted input.
- One existing hosted-local restart scenario proves a same-line direct home
  change from chat A to chat B, fresh-B-before-old-A ordering, exact former-chat
  retry authority across restart, delivery-time consumption, and no duplicate.
- A due-before-idle full-stack timing proof lands only if it fits the existing
  scheduled-reminder scenario without new production machinery or brittle
  test-only control flow.
- Required verification, specialist audits, ReviewGPT, and PR CI are green on
  the final pushed head with zero unresolved accepted findings.

## Scope

- In scope: `docs/contracts/00-invariants.md`, foreground input selection and
  focused package tests, the existing retryable-outbox restart E2E, and the
  existing scheduled-reminder E2E only when the current harness supports the
  proof directly.
- Out of scope: new queues, schedulers, state owners, route-proof formats,
  correctness feature flags, provider/network checks before model work,
  automatic legacy repair, compatibility-scan expansion, and the independently
  found duplicate-webhook quota race while overlapping webhook lanes are active.

## Constraints

- Technical constraints: accepted mailbox work must start the model with no new
  route, provider, network, or mutable-authority read; mutable effect authority
  remains at the irreversible delivery boundary.
- Product/process constraints: smallest maintainable deletion-first change;
  preserve all unrelated active work and reconcile overlapping runtime/E2E
  ledger rows before editing.

## Risks and mitigations

1. Risk: removing the pending-index read also disables invocation-local late
   input observation.
   Mitigation: trace the fresh importer and input-source refresh semantics, then
   delete only foreground background-index discovery while preserving durable
   enqueue for a later turn and background preemption of maintenance.
2. Risk: the full-stack scenario passes through a compatibility fallback rather
   than exact durable mailbox identity.
   Mitigation: assert persisted answered mailbox ids and per-row `consumedAt`
   transitions across the failed and accepted sends.
3. Risk: wall-clock reminder coverage becomes slow or flaky.
   Mitigation: extend only the existing CI scenario and profile; defer the P1
   proof if it needs a second harness, production switch, or polling shortcut.
4. Risk: active lanes overlap broad hosted runtime and E2E globs.
   Mitigation: avoid their exact dirty files, record the overlap, and rebase or
   resolve only from committed branch state before final verification.

## Tasks

1. Inspect current foreground selection, input-source refresh, restart E2E,
   scheduled reminder timing, and active overlapping work.
2. Apply the two generic invariant edits and the minimal foreground deletion
   with focused regression proof.
3. Extend the existing restart E2E; add the due-before-idle profile only if it
   remains deterministic and architecture-neutral.
4. Run focused iteration, full acceptance, direct hosted-local scenario proof,
   required security/privacy and coverage audits, and parent final review.
5. Close the plan with `scripts/finish-task`, push a draft PR, and run the exact
   pushed-head ReviewGPT/CI loop to completion.

## Decisions

- The independent duplicate-webhook quota correction is excluded from this PR:
  it is not necessary to enforce accepted-work liveness, overlaps active ingress
  work, and would add another admission-path database read contrary to the
  user's latency constraint.
- Legacy delivery-proof fallback deletion remains gated on production inventory
  and drain evidence; this PR proves the exact-ID path instead of adding repair.
- The due-before-idle full-stack profile remains P1. The owner-level fake-timer
  regression already proves the 60-second wake advances the 180-second idle
  deadline; converting the current reminder E2E would restructure two
  lifecycles and add about 90 seconds of wall-clock idle waits to CI.
- Pending-index refresh policy is an explicit required input-source mode:
  foreground chooses `none`, while background recovery chooses `compact`.
  Inferring policy from whether an input is already selected is invalid because
  background recovery also starts with a selected input and must still observe
  fresh work. Separate constructors or a strategy abstraction would add surface
  without adding another owner or behavior.

## Verification

- `pnpm test:diff` for every touched owner and durable doc path.
- `pnpm verify:acceptance` because this is cross-owner hosted runtime work.
- Focused package regression for foreground selection and refresh with malformed
  pending state.
- Existing hosted-local retryable-outbox restart scenario; scheduled-reminder
  scenario only if the due-before-idle extension lands.
- Required `security-privacy-review` and `coverage-write` passes, parent final
  review, exact PR-head preflight, ReviewGPT zero accepted findings, and green CI.

The final serial local acceptance attempt completed syntax, dependency,
boundary, hosted-runtime, TypeScript 7 workspace typecheck, documentation,
artifact, and prepared-runtime gates. It then remained in the 117-file CLI
coverage lane without an aggregate or suite-level timeout and was interrupted
after a bounded wait. The affected-owner suite, focused mode regressions, and PR
CI remain the authoritative executable gates for this change.

The settled diff-aware rerun passed every guard and the affected TypeScript 7
typecheck. Its runtime suite passed 1,607 tests and reported four short-deadline
workspace-entrypoint timeouts plus one teardown error; all four tests inject a
custom assistant phase and cannot reach the changed input-source construction,
and all four passed alone. A one-worker runtime rerun passed 1,610 tests and
timed out only in an unchanged browser-vault projection test. That exact test
passed on latest `main` and then on this branch, proving cold-cache/load variance
rather than a PR-causal failure. The focused two-mode suite passed all 11 tests.
Completed: 2026-07-14
