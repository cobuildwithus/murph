# Hosted device catch-up and system-mailbox recovery

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Restore one production runtime by keeping Junction collections inside their
  declared request budget and handing a durable-head Assistant Ask to its
  foreground owner before later model-free device maintenance.

## Success criteria

- Ordinary grouped timeseries honor the existing one-attempt, eight-second
  collection contract instead of multiplying that budget through client
  defaults.
- An ordinary consented-member Assistant Ask remains behind older work but,
  once it reaches the durable system head, upgrades system-mailbox mode to its
  existing detached foreground owner before any later device wake.
- No new queue, scheduler, state owner, fanout, or manual production mutation
  is introduced.
- Focused device-sync and assistant-runtime tests, affected typechecks, exact-
  head review, CI, deployment, and live mailbox convergence all pass.

## Scope

- In scope: Junction grouped-timeseries request attempts, system-mailbox owner
  selection, focused synthetic coverage, metadata-only operational evidence,
  and deployment/live recovery proof.
- Out of scope: resource-policy changes, multi-hour canonical coalescing, a
  second queue or scheduler, longer hosted deadlines, canonical state outside
  existing owners, and manual production queue mutation.

## Constraints

- Preserve one source of truth for canonical health data under `packages/core`.
- Keep provider requests sequential and within the existing collection limit.
- Preserve the canonical one-hour import and continuation boundary.
- Preserve ordinary system-mailbox order: consented-member asks do not jump
  older device work, but later model-free work cannot overtake the durable head.
- Keep runtime diagnostics metadata-only and free of member, payload, provider
  record, credential, and filesystem identifiers.

## Risks and mitigations

1. Risk: reducing retries could skip provider data after a transient response.
   Mitigation: preserve the existing retryable job continuation; bound only one
   collection attempt so the outer durable retry remains the owner.
2. Risk: foreground-owner selection could reorder consented-member work.
   Mitigation: upgrade only the item already selected by ordinary durable order;
   the existing approved-continuation priority remains unchanged.
3. Risk: an expired Ask could be dropped without its required terminal result.
   Mitigation: keep the existing detached/Web authority path; do not locally
   discard or mark production work consumed.

## Tasks

1. [x] Complete the requested three-hour production watch and isolate provider
   work, checkpointing, and durable mailbox progress independently.
2. [x] Prove grouped timeseries multiplied the declared attempt/time budget and
   add a failing request-bound regression.
3. [x] Reject and delete the reviewed multi-hour coalescing design; retain the
   canonical one-hour owner and apply the request-bound correction only.
4. [x] Prove the route-wide detached worker can drain a later Ask across an
   intervening device wake; bind the handoff to the exact durable-head item and
   preserve foreground-message preemption and durable retry.
5. [x] Finish focused verification, affected typechecks, privacy/diff review,
   Frog logging, and Product UX walkthrough.
6. [x] Prove restored replyable input cannot sit behind the exact Ask barrier;
   hand the existing positive pending-input projection to the ordinary assistant
   owner without running the Ask or later device maintenance.
7. [ ] Commit, push, run final review with required CI, deploy, and prove live
   mailbox and device-sync convergence.

## Decisions

- Product UX Patch: connected-health catch-up and delegated Ask recovery become
  reliable in the background; no control, copy, permission, provider choice,
  or visible state changes.
- Outcome: health history retains existing coverage, and the system frontier
  can terminalize its oldest Ask before later device maintenance continues.
- Accepted retrospective: final review proved multi-hour coalescing had no
  single failure-atomicity contract and could replay completed prefixes. Delete
  it and restore one-hour canonical ownership.
- Accepted production root cause: after device jobs became fast, a ten-minute
  consented-member Ask remained at the durable head while later device wakes
  each forced a large workspace checkpoint. The detached worker claimed by
  route class and auto-drained later Asks while the ordinary assistant phase
  still admitted device maintenance. Bind the handoff to the already-selected
  item and hold only model-free maintenance until that item terminalizes or
  durably requeues; queue deletion or a second scheduler is unnecessary.
- Accepted final-review finding: an exact Ask barrier could start before
  replyable conversation input already present in the restored pending-input
  projection. Gate only the ordinary consented-member Ask on a positive
  candidate, persist an assistant wake ahead of the system wake, and leave both
  the Ask and later device maintenance pending. An incomplete empty index is not
  positive evidence and must preserve exact-Ask admission.
- Rejected: increasing hosted timeouts, changing resource admission, deleting
  queued work, or locally expiring the Ask without its Web-owned terminal result.

## Verification

- Run focused Junction request/provider tests and assistant-runtime durable-head
  owner-selection coverage, then the affected package typechecks.
- Inspect the final diff for removal of every multi-hour branch and privacy-safe
  evidence only; expand checks only when direct evidence or CI requires it.
- After deployment, require the expired head to terminalize, the system frontier
  to advance materially or clear, zero-job wake replay to stop, and scheduled
  device reconciliation to remain healthy.

## Product UX walkthrough

- A member with dense connected-device history keeps the same sources, hourly
  fallback, canonical data coverage, and durable retry ownership.
- A consented-member Ask behind older work stays behind it; at the durable head,
  the detached read-only owner revalidates and either completes or terminalizes
  it before later model-free work.
- A foreground message still preempts background device maintenance under the
  existing rules, aborting and durably requeuing an in-flight exact Ask before
  the conversation proceeds.
- A reply already present at restore schedules and runs through the ordinary
  assistant owner before the durable-head Ask or later device maintenance;
  the next invocation proves the staged input is still serviceable.
- Provider failure preserves the same one-hour cursor and outer retry path.
