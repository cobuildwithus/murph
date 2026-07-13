# PR #572 assistant-preference causal ordering

Status: completed
Created: 2026-07-12

## Goal

Prevent an older retrying Settings preference delta from overwriting a newer
conversational preference while preserving foreground replies and sparse
sibling-field application.

## Success criteria

- Hosted preference items reserve stable per-setting revisions before they can
  wait or retry.
- Conversational mutations advance the same canonical per-setting revision
  counters.
- A retry applies only fields whose reserved revision is still current, treats
  stale fields as terminal no-ops, and still applies non-stale sibling fields.
- A canonical apply retains a bounded handled receipt so a crash before mailbox
  removal replays idempotently, while a fresh applied sibling advances the
  document timestamp.
- Re-import and retry reuse the same event reservation; the 128-record cap
  evicts handled receipts only and never pending reservations.
- Focused core/runtime tests, relevant typechecks, scoped commit, and PR push
  pass. Main reconciliation and the one final exact-head ReviewGPT run remain
  held until PR #557 merges.

## Constraints

- Keep `bank/preferences.json` canonical and Postgres projection-only.
- Do not compare wall-clock timestamps or projection values.
- Do not block foreground replies, add another queue, or depend on model-authored
  ordering data.
- Preserve unrelated worktrees and the existing round-3 audit artifact.

## Tasks

1. Add the minimal optional canonical revision/reservation contract.
2. Reserve hosted event revisions idempotently before pending mailbox state is
   exposed, and apply retries through the reservation.
3. Advance the same revisions for conversational writes and add the reported
   retry/conversation/sibling proof.
4. Prove crash-after-canonical-commit replay, partial stale/fresh timestamping,
   and bounded reserve-before-queue retry behavior.
5. Update durable ownership documentation, run focused verification, commit,
   and push PR #572.

## Outcome

- Canonical per-field revisions now order Settings reservations and direct
  conversational writes without consulting projection values or timestamps.
- A hosted apply marks its bounded record handled in the same canonical write;
  replay after a simulated crash before mailbox removal is terminal and
  idempotent.
- The 128-record bound reuses duplicate event ids, evicts only the oldest
  handled receipt, and rejects capacity made entirely of pending reservations.
- A partial stale/fresh retry advances the document timestamp when its fresh
  sibling changes while preserving the newer stale sibling.

## Verification

- `pnpm --dir packages/contracts generate`
- Focused contracts, core preferences, hosted runtime context/system-mailbox,
  and vault-usecase tests
- Contracts, core, vault-usecases, and assistant-runtime typechecks
- Generated contract artifact verification
- `pnpm test:diff packages/contracts packages/core packages/vault-usecases packages/assistant-runtime`
- `git diff --check` and scoped identifier/privacy scan

All commands passed after the final corrections. Main reconciliation and the
single final exact-head ReviewGPT audit remain held until PR #557 merges.
Updated: 2026-07-12
Completed: 2026-07-12
