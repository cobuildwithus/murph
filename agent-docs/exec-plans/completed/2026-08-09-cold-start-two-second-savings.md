# Investigate hosted cold-start savings without losing existing overlap

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Find a behavior-preserving one-to-two-second reduction in established-member
  accepted-to-provider latency, or reject the candidate if production evidence
  and code-path proof do not support that claim.
- Preserve durable ingress, health-data consent, one fenced runtime owner,
  authenticated workspace restore, replay safety, and reply delivery.

## Success criteria

- Every proposed saving is demonstrated on the accepted-to-provider critical
  path rather than inferred from an earlier intermediate timestamp.
- The established-member path retains Temporal acceptance before the direct
  ensure and the existing overlap between container boot and fenced invocation
  preparation.
- The separate first-contact instant-start shell hint cannot race a health-data
  consent withdrawal or recreate runtime state after account deletion.
- Focused tests and typechecks, exact-head CI, and the required ReviewGPT gates
  complete with no unresolved finding.

## Scope

- Established-member direct wake, Cloudflare container boot, authenticated
  workspace restore, mailbox import, Codex process initialization, provider
  planning, and delivery handoff.
- Focused latency instrumentation and production-safe aggregate evidence needed
  to accept or reject a candidate.

## Constraints

- Add no keepalive service, warm pool, second snapshot representation, mailbox
  cursor owner, speculative provider authority, or unauthenticated extraction.
- Keep private production evidence out of repository artifacts.
- Prefer deletion when a proposed overlap duplicates or serializes existing
  orchestration.

## Tasks

1. Decompose the supplied production trace and recent cold cohort against the
   exact code owners.
2. Ask ReviewGPT to challenge the strongest overlap and deletion candidates.
3. Run a production-shaped cold scenario that exposes boot, fenced preparation,
   restore, mailbox, and provider boundaries.
4. Delete any candidate that cannot prove net critical-path savings; retain only
   independently required correctness remediation.
5. Complete scoped verification, exact-head review and CI, then document the
   measured outcome without claiming unproved savings.

## Decisions

- Codex process spawn readiness was about 1 ms in the supplied trace. The
  existing process preinitializer already owns that seam; a second App Server is
  neither useful nor maintainable.
- The candidate established-member shell prewarm led direct ensure by only tens
  of milliseconds, but the consent-safe implementation held the UserRunner
  mutation barrier through the multi-second platform start. Authoritative direct
  ensure then waited behind it, losing the existing overlap between boot and
  `prepareWithFence`. The local 14 ms later readiness observation measured work
  already serialized ahead of preparation, not a net saving.
- ReviewGPT independently classified that candidate as a likely latency
  regression and required deletion of the established-member invocation,
  callback, and timing plumbing. The ordinary established path therefore stays
  mailbox append, Temporal acceptance, authoritative direct ensure, one fence,
  and parallel boot plus invocation preparation.
- The pre-existing first-contact instant-start hint remains because enrollment
  gives it a separate, materially longer lead. Its route now resolves the
  `UserRunner`, re-reads live admission under the consent-mutation barrier,
  reserves the exact target, and holds that barrier only until the container
  acknowledges registration. The platform wait continues behind the existing
  container lifecycle owner and can be superseded by foreground readiness or
  exact-target destruction.
- The current evidence does not support an honest two-second patch. Container
  scheduling/Node startup and authenticated restore are the only buckets large
  enough; the inspected shortcuts either move work later, discard overlap, or
  weaken integrity. Receipt and outbox scans enforce distinct replay and
  delivery invariants, and the existing mailbox prefetch already depends on the
  restored canonical cursor.

## Required retrospective

- Final ReviewGPT round 2 proved that the first consent correction repeated the
  prior shell-after-withdrawal mechanism across a Worker version transition. A
  versioned shell hint had no persisted stop target, so a later Worker could
  derive and destroy only its own version while reporting cleanup complete. It
  also proved that holding the consent barrier through the 20-second shell RPC
  prevented authoritative readiness from reaching the container's existing
  prewarm-supersession boundary.
- Deleting the first-contact hint is rejected because its completed controlled
  benchmark measured about 693 ms lower provider-start p50 and 662 ms lower
  delivery p50 with non-overlapping samples. That evidence applies to the
  longer first-contact enrollment lead; it does not justify an
  established-member hint.
- The retained design reuses the existing persisted
  `active_runner_container_name` user-control stop target. Under the consent
  barrier it re-reads admission, reserves the exact versioned name, and starts
  the shell RPC. It waits only for the container to acknowledge that the
  prewarm operation is registered, then releases the barrier while the platform
  wait continues, allowing authoritative readiness to enter, bind its fence,
  and use the existing container-local supersession path.
- Withdrawal and account deletion consume the reserved exact name. Container
  destruction supersedes an in-progress shell hint before joining the lifecycle
  queue. If an authoritative start observes a prior-version pending hint, it
  destroys and clears that exact target before binding the current-version
  fence. This adds no new persisted field, state owner, queue, generation,
  scheduler, or reconciliation loop.
- Deployment must put Web first, then use immediate container rollout for the
  Worker because an older deployed Worker can still have created unrecorded
  shell hints. Old Workers fail closed on Web's new absent/suspended-member
  denial; the reverse order would leave the account-deletion race open until
  Web deploys. The new Worker becomes the rollback floor after it writes the
  first reserved stop target.
- Final ReviewGPT round 3 proved that sharing the mutation barrier was not
  sufficient for account deletion: a hint already queued behind successful
  cleanup could read the deleted consent grant as legacy `missing`, recreate
  `runner_meta`, and start a shell after deletion returned. The correction
  remains in the existing Web admission owner: processing now requires an
  extant, non-suspended member in addition to a non-revoked grant. Missing-grant
  compatibility remains only for extant legacy members, and the Cloudflare
  ordering test proves that a queued hint settles without addressing a
  container or recreating runner state.
- Final ReviewGPT round 4 proved that the production HTTP route still called the
  shared eager-binding resolver before the corrected admission check, so a
  request delayed until after completed deletion could recreate `runner_meta`
  even though it started no container. The route now obtains the named
  `UserRunner` stub directly without binding. The existing post-admission exact
  target reservation remains the only bind owner. The production-entry test
  completes deletion, delivers the signed delayed request, and proves no eager
  bind, container lookup, or runner-row recreation.
- Final ReviewGPT round 5 proved that the optional prewarm still held the shared
  consent barrier during the ordinary 30-second Web-control timeout, so a slow
  admission could convoy authoritative first-contact processing, withdrawal,
  or deletion before container registration existed to supersede. The hint now
  gives only its admission read a fixed 250 ms deadline and abandons fail-closed
  on timeout or transport failure. That cap is below half of the measured 693 ms
  provider-start p50 benefit; authoritative and user-control reads retain the
  ordinary timeout. Fake-clock ordering tests prove no target or container
  mutation before abandonment and prove both authoritative processing and
  withdrawal enter their fresh admission path at the bound.

## Evidence

- Supplied cold trace: accepted-to-provider about 9.3 seconds; container
  schedule/boot about 3.2 seconds; authenticated restore about 2.65 seconds.
- Exact provider breakdown: App Server spawn readiness about 1 ms, exposed
  initialization about 451 ms, thread start about 109 ms, receipt/outbox scans
  about 298 ms combined.
- Recent aligned cold traces confirm that boot and restore remain the only
  repeatable second-scale phases; individual post-import phases are measured in
  hundreds of milliseconds and protect separate invariants.
- Cloudflare currently restarts a sleeping Container with a fresh disk. Native
  lower-level snapshots remain forthcoming, so sleep/resume cannot remove the
  encrypted R2 restore today.

## Verification

- Run focused Cloudflare owner, route, consent-race, and instant-start tests;
  affected typechecks; privacy/diff guards; exact-head CI; and final ReviewGPT.
- Confirm the final diff contains no established-member prewarm callback or
  timing requirement, retains optional historical latency parsing, and keeps
  the first-contact call site plus both consent-withdrawal orderings.
Completed: 2026-08-09
