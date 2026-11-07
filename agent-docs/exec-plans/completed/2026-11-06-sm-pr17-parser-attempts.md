# Recover parser attempts by exact identity

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- A stranded hosted parser claim stops blocking a voice message and its ordered
  successors.
- A late cancel or completion from an older attempt can never touch a newer one.
- The unused parser enqueue path is gone.

## Success criteria

- Retained SQLite after owner loss recovers on the single and pair paths.
- A completion and failure-finalization outage recovers on the next pass.
- A live sibling is never reclaimed.
- An old cancel or completion cannot reset attempt n+1.
- A succeeded transcript survives replay and rebuild, with no second transcription.
- The ordered successor advances without a vault rebuild.

## Scope

- In scope: `RequeueAttachmentParseJobsInput`, the parse-job store, the worker's
  abort branches and hosted preparation entry.
- Out of scope: mailbox retry policy, a persisted owner token, attempt caps and
  age-based reclaim.

## Constraints

- Technical constraints: no SQLite migration, no new package or registry. The
  public TypeScript contract and its bundled callers move together.
- Product/process constraints: runner image only. Graceful preemption stays as it
  is, because pair cleanup already completes every owned claim.

## Risks and mitigations

1. Risk: recovery resets a claim that still has a live owner.
   Mitigation: claims exist only in the two conversation preparations, which join
   them before closing the runtime. Only the sole active preparation recovers, and
   its check, listing and reset run synchronously.
2. Risk: recovery erases a published transcript.
   Mitigation: the exact reset also requires the attachment to still be `running`.
   A `succeeded` attachment is neither treated as pending nor claimable.
3. Risk: a recovery failure becomes terminal failed evidence.
   Mitigation: it is caught and logged. The input stays blocked and retryable.

## Tasks

1. Add `exactAttempt` to the reset and use it in all three abort branches.
2. Recover at preparation entry under an in-process active-preparation count.
3. Keep succeeded evidence out of pending checks and claim selection.
4. Delete the unused store enqueue method and its exclusive helpers.
5. Prove each criterion at the real SQLite and mailbox boundary.

## Decisions

- Recovery runs at preparation entry, not per capture. That is the only point
  before either member of a pair starts, and its safety does not depend on the
  lookahead's duplicate-capture guard.
- Recovery is vault-wide because capture identity is unknown at entry. A reset row
  for another capture waits as `pending` for that capture's retry.
- A process-local counter proves exclusivity. Independent import passes can overlap
  in one process, so exclusivity is checked, not assumed. A second concurrent
  preparation skips recovery, which only delays it.
- The recovery listing stays bounded at the store's 200-row page. Crowding needs
  200 residual rows in a container-local SQLite file, and the outcome is the old
  stuck behaviour, not a new failure.
- `exactAttempt` is one nested field so identity cannot be half specified. Abort
  cleanup keeps its old filters, so a store predating the field behaves as before.

## Verification

- Commands to run: focused Vitest for `parse-jobs`, `inboxd`, `inbox-media-retention`,
  `parsers`, `hosted-runtime-mailbox-audio-preparation`,
  `hosted-runtime-conversation-event` and `hosted-runtime-linq-audio-e2e`, plus
  typecheck and `pnpm complexity:diff`.
- Expected outcomes: all pass. Removing the exclusivity check, the `parser_state`
  predicate, the `parseState` guard or the claim predicate fails a named proof.
Completed: 2026-11-06
