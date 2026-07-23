# PR 859 round 5 post-delivery cron wake recovery

Status: completed
Created: 2026-07-22
Updated: 2026-07-23

## Goal

- Preserve the automatic meal closeout's existing cron owner after a stale
  provider-entry rejection, including when dispatch reconciliation cannot
  persist the terminal outcome in that same hosted pass.
- Keep the round-4 single-owner decision intact: do not recreate a replyable
  failure input, queue, alarm owner, route snapshot, or repair mechanism.

## Round-five cap retrospective

- Round 4 correctly removed the generic terminal-failure input as a second
  delivery owner, but that input had also supplied the only post-delivery wake
  in an otherwise idle workspace.
- The canonical cron retry time does not exist during the pre-delivery status
  read. It is written only when terminal outbox reconciliation preserves the
  pending occurrence after the stale-route failure.
- Round 5 review proved that the post-delivery reread alone was not durable:
  dispatch reconciliation can fail, an unrelated checkpoint can replace the
  first bounded wake, or fresh no-reply input can defer cron at its deadline.
- Decision for this remediation: derive a stable first-backoff repair deadline
  from the existing pending delivery id and exact terminal outbox evidence in
  canonical cron status. Count that repair as due at the deadline so the
  ordinary cron pass remains the sole mutating repair owner. Keep the narrow
  post-delivery reread and bounded one-pass safety candidate only for initial
  wake projection when aggregate status lacks the exact deadline. Add no state
  or lifecycle surface.
- This is substantive ReviewGPT round 5. After fixing and verifying the accepted
  finding, pause before any round 6 and obtain the explicit continuation
  decision required by the five-round hard cap.

## Tasks

1. Reproduce dispatch reconciliation failure with real cron/outbox state and
   prove the terminal intent remains attached without a persisted retry.
2. Project that existing owner pair through canonical cron status, including a
   stable deadline and due count, then let ordinary cron processing reconcile.
3. Prove the projected wake survives an intervening system-mailbox checkpoint,
   the existing caller-deferred path re-arms due cron work after fresh no-reply
   input, due cron wins preflight over mailbox work, stale route A makes zero
   provider calls, route B sends once, and unrelated terminal failures retain
   their ordinary input.
4. Update the PR affected-surface inventory, run canonical verification, close
   the plan, push, and complete the round-five cap handoff without starting a
   sixth review.

## Verification

- Canonical assistant-engine coverage forces dispatch reconciliation failure,
  proves the retained terminal pending delivery projects a 30-second wake and
  due count, then proves ordinary processing repairs it, route B sends once,
  and success clears the occurrence.
- Hosted-runtime integration coverage proves an intervening progressed mailbox
  checkpoint preserves that derived wake and due cron preflight wins over later
  mailbox work. Owner-level run-loop coverage separately proves fresh no-reply
  deferral re-arms a due status projection through the existing catch-up wake.
- Repair-only coverage proves the local cron repair reports its mutated-record
  count, the run loop marks that pass progressed without changing
  `cronProcessed`, and the hosted phase requests a canonical runtime checkpoint.
- The stale-closeout delivery regression still proves zero replyable failure
  inputs, while adjacent unrelated terminal failures retain their normal input.
- The full assistant-engine cron and automation files pass 141 and 164 tests;
  the full hosted-runtime phase file passes 253 tests; both owning package
  typechecks pass.
- Canonical Crabbox `test:diff` passed the affected assistant-engine and
  assistant-runtime packages (2,607 and 1,801 tests respectively). Its
  reverse-dependent CLI lane then accumulated serial 60-second fixture-harness
  timeouts; the exact owned one-shot was stopped after the independent full
  acceptance run exercised those same CLI tests successfully.
- Canonical Crabbox `verify:acceptance` passed on the 16-vCPU composed profile
  with exit code 0 in 4m27s, including workspace typechecks, package coverage,
  Web verification/build, and Cloudflare verification.
- `git diff --check`, final parent review, and the task-scope/privacy audit pass.
  Commit, push, and exact new-head CI remain before the round-five cap handoff.
Completed: 2026-07-23
