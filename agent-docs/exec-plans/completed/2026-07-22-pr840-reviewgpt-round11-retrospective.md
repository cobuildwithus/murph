# PR 840 ReviewGPT Round 11 Retrospective

## Goal

Resolve the round-eleven ownership conflict without delaying an unrelated
durably accepted private reply or widening Assistant Ask admission.

## Requirement Decision

- A checkpoint-gated `consented_member` Ask must not delay an unrelated current
  private reply for the idle-checkpoint window.
- `automation-state.json` remains the existing local channel-authority owner.
  Provider entry re-reads that last-known-good state after flushing already
  imported `member.channels.updated` work.
- The remote system mailbox remains transport. It is not re-resolved on the
  current reply's pre-dispatch path, and a non-admitted remote Ask cannot join
  that reply's delivery barrier.
- Delete the conflicting remote pre-auto-reply catch-up and barrier seam. Add no
  queue, coordinator, scheduler, state, lane, or reconciliation owner.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- Focused workspace runner, entrypoint, and assistant-phase tests
- PR description retrospective and non-obvious affected surfaces

## Regression Contract

- A dirty joined-group pass still defers a `consented_member` Ask until the idle
  checkpoint.
- The same overlap does not return a mailbox barrier for the current private
  reply, and the prepared reply reaches the ordinary delivery drain.
- A previously imported channel disable remains authoritative even when other
  Assistant Ask work is queued before or after it locally.
- A remote channel update ordered before a deferred Ask is imported and applied;
  a remote update behind the non-admitted Ask remains transport work and the
  current reply deliberately continues from the last-known-good local state.

## Verification Plan

- First make the overlap regression fail on the round-eleven reviewed head.
- Run the focused runner, entrypoint, and assistant-phase suites plus Assistant
  Runtime typecheck.
- Run canonical `pnpm test:diff`, full `pnpm verify:acceptance`, exact-head CI,
  and the next ReviewGPT correction round.

## Round Eleven Finding And Decision

Round 11 validly found that the round-ten shared target fallback reaches the
remote pre-auto-reply whole-system-prefix import. A deferred consented-member
Ask therefore becomes a mailbox delivery barrier and can reset the current
reply's prepared dispatch until the idle checkpoint. The finding is accepted.
The conflicting boundary predates this PR and now contradicts the foreground
reply invariant. Resolve the retrospective by deleting that remote boundary and
retaining the existing local channel-authority owner.

## Evidence

- On the round-eleven reviewed head, the consented-member overlap regression
  failed with the current reply reaching `auto-reply.blocked` after the Ask was
  deferred instead of reaching delivery.
- The correction deletes the remote pre-auto-reply whole-system-prefix import
  and its delivery-barrier result. The foreground watcher is only stabilized;
  already imported channel updates are still flushed locally before dispatch.
- Focused runtime coverage: 4 files, 616 tests passed.
- Assistant Runtime typecheck passed.
- Canonical `pnpm test:diff` passed in the owned Blacksmith Testbox: Assistant
  Runtime 1,797 passed and 2 skipped; Cloudflare 1,856 passed.
- Full `pnpm verify:acceptance` passed in the same Testbox: Web 6,126 passed and
  150 skipped; Assistant Engine 2,600 passed and 5 skipped; Cloudflare 1,856
  passed. The exact owned Testbox was then stopped.

Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
