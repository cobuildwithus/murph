# Vault-file approval delivery loop

## Goal

Find and fix the hosted iMessage flow where approving one generated vault file
can produce another approval request instead of attaching the already-approved
file.

Success criteria:

- Prove the production failure boundary without persisting private member,
  message, filename, or approval identifiers.
- Keep one generated-delivery identity stable from the initial explicit send
  request through approval reconciliation and provider attachment.
- Preserve exact-file and exact-destination authorization, including fail-closed
  behavior when either identity genuinely changes.
- Add focused regression coverage for the demonstrated approval/retry sequence.
- Complete scoped verification, ReviewGPT, and required CI on the exact PR head.

## Constraints

- Preserve the single-file, single-destination approval trust boundary.
- Do not bypass, broaden, or auto-refresh approval authority to make delivery
  succeed.
- Keep production evidence private and out of committed artifacts.
- PR 221 is already merged; use current `main` as the source of truth instead
  of assuming an active overlapping runtime lane.
- Prefer the smallest correction at the state owner; add no new queue, table,
  scheduler, or compatibility layer.

## Approach

1. Correlate the reported approval cycle with narrow production state and
   metadata-only runtime evidence.
2. Trace the persisted generated-delivery descriptor through request, approval
   observation, consume, and attachment dispatch.
3. Capture the demonstrated mismatch in a focused failing test.
4. Correct the owner that changes or reconstructs delivery identity after the
   approval request.
5. Run focused owner tests, `pnpm test:diff`, and the applicable hosted approval
   scenario proof.
6. Run coverage-write, commit through `scripts/finish-task`, open a PR, and run
   ReviewGPT concurrently with required CI.

## State

Implementation and local verification complete; exact pushed-head PR review
and CI are next.

The approval owner preserved the first exact action correctly. The failure was
upstream in assistant send ownership: a later foreground confirmation turn could
prepare a different generated-file ref for the same conversation while the
first outbox intent remained active. That produced a new action identity and
left the approved intent without its bytes before provider dispatch. Runtime
checkpoint cleanup was not the deletion owner. The correction keeps the active
outbox intent authoritative across turns, permits exact-ref retries, and rejects
a different same-target ref before staging adoption or approval creation.

## Verification

- Focused assistant-engine regression and prompt-contract tests: 88 passed.
- Assistant-engine typecheck passed.
- Scoped `pnpm test:diff` passed after the fresh worktree generated its ignored
  Health Commons test catalog and prepared CLI runtime artifacts. The lane
  covered affected package typechecks/tests and Cloudflare verification.
- Required `coverage-write` added only nonterminal-status and different-target
  guard assertions; its focused post-audit run passed all 88 tests.
- `pnpm hosted-local e2e vault-file-approval-resume` passed the real
  checkpoint, destroy, approval reconciliation, restore, Linq upload, and
  exactly-once attachment path.
- The initial unguarded package run exhausted a Vitest worker's default heap
  while other worktrees were active; the shared-host rerun with an 8 GiB heap
  completed the same package surface without test failures.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
