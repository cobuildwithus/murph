# Environment Browser Vault publication order

## Outcome

Publish a durably completed Environment report before ordinary due-assistant
work starts another idle checkpoint window. Preserve fresh conversation
priority, canonical checkpoint ownership, the existing quiet floor, and bounded
browser refresh cancellation and retry.

## Proven cause

A local integration fixture uses the actual independent Environment owner,
canonical Habitat writes, durable recording, and Browser Vault construction.
After the Environment recording follow-up checkpoint, the ordinary due-assistant
path runs before browser publication. Its derived-context refresh legitimately
reports progress and dirties state, delaying the already committed report behind
another quiet window. The metadata-only checkpoint exception does not apply.
The regression fails on the publication ordering assertion before the change;
no production payloads or forced assistant phase flags are used.

## Scope

- Move the existing browser refresh, browser-only wake retry, and acknowledgement
  block after required durable effects and follow-up checkpointing, before
  ordinary due-assistant work and deferred device maintenance.
- Preserve those maintenance blocks' relative order. On refresh wake interruption
  or timeout, use the existing invocation continuation and retry selection.
- Add real Environment publication and foreground-interruption proof; retain
  quiet-window, timeout, scheduling, and browser-only retry contracts.
- Update the current protocol and testing owners. Add no persisted state, owner,
  dependencies, progress reclassification, or quiet-timer exception.

## Verification and remaining work

- Baseline deterministic ordering regression: failed as expected after actual
  Environment recording completed but before Browser Vault publication.
- Initial corrected real-path fixture: both publication and interruption cases
  passed. Existing scheduling and metadata timing checks also passed (44 tests).
- Relevant TypeScript check passed after correcting a missing nullable-field
  normalization in the new fixture. Final focused checks passed all 46 tests,
  including due and earlier-future assistant wake priority after refresh timeout.
- Complexity guard passed with unchanged debt and maximum complexity; docs drift
  checks passed.
- Parent source review accepts the pure reorder: fresh conversation checks and
  the exact due-assistant durability-barrier successor remain before publication.
  Ordinary due work without a fresh notification may wait for the existing
  30-second Browser refresh budget and a successor invocation. Preserve this
  explicit bounded tradeoff instead of adding scheduling reads, persisted state,
  or unproved progress reclassification.
- Existing timeout tests preserve due and earlier future assistant continuations.
  The additional composed test lets a real queued outbox intent become due during
  checkpoint publication, stalls the actual refresh helper until its two-second
  test timeout, cold-restores the returned continuation, and proves one persisted
  send with no replay on a later invocation. It uses no runtime wake notification.
  It does not prove cron occurrence execution or autonomous Temporal scheduling.
  The managed no-nudge reminder scenario retains its 60-second delivery deadline.
- The composed proof and assistant-runtime typecheck passed. Changelog provenance
  now includes PR #3272; its ten focused archive tests and Web typecheck passed.
  The unchanged production archive reference is reachable and includes its anchor.
- Parent candidate review accepts the source ordering, composed proof, bounded
  scheduled-work tradeoff, and unchanged schema/provider-input contracts. No
  unresolved accepted source findings remain. Final ReviewGPT and exact-head CI
  continue on the final pushed candidate. Managed release admission and production verification remain separate
  required evidence; local tests do not establish live publication or release
  convergence.
Status: completed
Updated: 2026-09-11
Completed: 2026-09-11
