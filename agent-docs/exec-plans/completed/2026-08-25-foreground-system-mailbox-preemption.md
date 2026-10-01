# Foreground replies preempt system mailbox work

Status: completed
Created: 2026-08-25
Updated: 2026-08-26

## Goal

- Restore the existing hot-reply promise: an authenticated direct foreground
  message replaces active system-mailbox/device-maintenance work instead of
  waiting through `retry_later` admission cycles. Preserve the same priority
  for durably signaled Assistant Ask request and completion obligations that
  already share the Web-direct handoff.

## Success criteria

- The Cloudflare Durable Object aborts the exact active system-mailbox
  invocation, preserves fence/CAS safety, and starts the requested foreground
  default invocation before returning accepted.
- Non-direct scheduled/default work retains the existing cooperative
  wake-and-retry behavior.
- A production-shaped hosted-local E2E holds device maintenance in flight,
  injects a foreground reply, and proves prompt preemption, durable resumability,
  one foreground response, and no overlapping writer.
- Focused Cloudflare tests, hosted-local E2E, typecheck, ReviewGPT gates, and
  exact-head CI pass.

## Scope

- In scope: the existing Cloudflare runtime-processing owner transition,
  exact-invocation abort/replacement, the current Linq and Assistant Ask
  Web-direct owners, unit/integration regression coverage, and the composed
  foreground-priority hosted-local scenario.
- Out of scope: new queues, schedulers, persisted priority state, changes to
  ordinary scheduled assistant work, broad device-sync redesign, or container
  destruction.

## Constraints

- Technical constraints: reuse the existing exact abort plus write-fence CAS;
  trust only the server-derived Web-direct marker; preserve checkpoint and
  device continuation contracts; fail closed on abort timeout, stale identity,
  or fence drift.
- Product/process constraints: Product UX Patch. Outcome: typing and reply work
  begin promptly when a person messages during background connected-data work.
  Reaches: existing direct hosted conversations with active system maintenance.
  Proof: the composed hosted-local scenario persists foreground input while a
  committed background checkpoint acknowledgement is held, proves no
  replacement overlaps that boundary, releases it, and then observes foreground
  delivery before safe background recovery. Use two independent ReviewGPT
  implementation lanes, inspect both as untrusted patches, and integrate only
  the smallest verified candidate.

## Risks and mitigations

1. Risk: abort and replacement overlap two canonical writers.
   Mitigation: preserve the exact attempt/generation identity, await abort
   settlement, and reuse the existing compare-and-swap fence replacement.
2. Risk: an ordinary Temporal/default wake is mistaken for an interactive
   foreground reply.
   Mitigation: gate hard preemption on the server-derived Web-direct marker and
   retain a regression for non-direct cooperative retry.
3. Risk: device-sync progress is lost after interruption.
   Mitigation: prove the held job checkpoints or requeues unfinished work and
   resumes from durable authority after foreground completion.
4. Risk: a seam-level test passes while the production composition still waits.
   Mitigation: extend the existing `foreground-reply-priority` hosted-local E2E
   through Web ingress, Worker ownership, runner abort, runtime yield, and final
   delivery evidence.
5. Risk: a shared trusted Web-direct owner changes an undeclared foreground
   surface.
   Mitigation: name Assistant Ask request, completion, and private-fallback
   wakes explicitly and prove both source values reach one valid Web-ingress
   ensure only after Temporal accepts the durable mailbox signal.

## Tasks

1. Run two independent ReviewGPT implementation lanes against the exact clean
   target: one for the minimal controller patch and owner tests, one for the
   strongest production-shaped E2E regression.
2. Inspect both returned patches and integrate the smallest compatible result.
3. Run focused unit/integration proof, the composed hosted-local regression,
   Cloudflare typecheck, and relevant diff checks.
4. Commit, publish a draft PR, start preliminary and final ReviewGPT gates
   concurrently with exact-head CI, and resolve every accepted finding.
5. Complete the parent walkthrough/review, archive the plan, and hand off only
   after exact-head gates and current-base merge proof are green.

## Decisions

- Keep hard preemption limited to trusted direct foreground work because
  `default` also represents non-interactive scheduled assistant work.
- Do not treat a payloadless wake acknowledgement as proof that foreground
  processing started.
- Reuse the retention/environment-interview exact-abort and fence-replacement
  path. Do not add a scheduler, queue, persisted priority bit, or container
  destroy fallback.
- Require both the server-derived Web-direct marker and the validated
  `web-ingress-<uuid-v4>` attempt identity before granting priority.
- Reuse the existing post-commit canonical ordering barrier for the composed
  regression. It holds a real committed checkpoint response before runner
  acknowledgement, proving the old owner and fence remain exclusive until that
  atomic boundary settles.
- Treat an `accepted` or `queued` child abort as ownership of cancellation and
  settlement. Preserve the outer invocation transport until the child finishes;
  retain outer cancellation and fail-closed cleanup for stale, failed, or
  unavailable child abort delivery.
- Keep unrelated macOS Docker compatibility corrections out of this patch;
  record the discovered hosted-local friction for a dedicated follow-up.

## Progress

- Two independent ReviewGPT implementation lanes completed. The controller
  lane supplied the owner-transition test matrix; the parent added fail-closed
  direct-attempt validation before integration. The E2E lane supplied the
  five-file production-shaped test/control patch, whose downloaded SHA-256 was
  verified before deliberate integration.
- The controller now exact-aborts an active `system_mailbox` owner only for a
  trusted direct foreground request, waits for settlement, and reuses the
  existing compare-and-swap replacement path. Non-direct and malformed-direct
  default work remains cooperative.
- Final ReviewGPT found that the runner canceled the outer transport immediately
  after an acknowledged child abort. An already-forwarded checkpoint could then
  commit after replacement admission. The runner now waits for the acknowledged
  child to settle its atomic boundary before releasing the old operation.
- Final ReviewGPT round 2 found that the shared Web-direct policy also covers
  Assistant Ask request, completion, and private-fallback wakes. The production
  sharing is intentional because those are durably signaled foreground
  obligations; focused composition proof and this intent contract now disclose
  that surface without adding a source discriminator or new runtime policy.
- The composed regression holds the acknowledgement of a real committed
  canonical checkpoint, persists a signed foreground message, proves the old
  system owner and fence remain exclusive while the acknowledgement is held,
  then verifies the new default fence, exactly one reply, and natural system
  continuation under a different attempt without a second pointer.
- Current local proof: Cloudflare typecheck passed; the runner-container status
  matrix passed 216 tests; controller and test-control suites passed 184 tests;
  hosted-local helper/control suites passed 117 tests; and focused changelog
  generation/rendering passed 58 tests. The Assistant Ask request, completion,
  private-fallback, and post-Temporal direct-wake composition suites passed 36
  tests, both Web and Cloudflare typechecks passed, and the final Cloudflare
  node workspace passed 2,693 tests with two skips after obsolete test-barrier
  type residue was deleted. A broad hosted-web pass completed 11,122 tests with
  only the changelog render loaded during a concurrent copy edit failing;
  regeneration plus the exact 58-test changelog rerun passed.
- The full composed command reached the real Worker and runner image build but
  could not execute its Vitest cases on the current macOS Colima host because
  the proxy container's required socket option is unavailable in that kernel.
  The supported-host exact-head run passed the race boundary, foreground reply,
  and durable-device assertions; its recovery tail was too specific about
  device-sync being the first resumed system item. The assertion now accepts
  natural continuation of any seeded system item under a replacement attempt
  while retaining explicit device-row durability proof.
- The corrected supported-host E2E passed on the exact pushed test head. Final
  ReviewGPT round 2 and its disclosure-only verification retry both resolved:
  the production ordering fix and shared Assistant Ask surface have zero
  remaining accepted findings. Exact-head public CI passed the focused
  ownership, evidence, Temporal, bundle, viewport, and host-matrix gates; final
  release gates remain the GitHub handoff boundary after plan archival.

## Verification

- Commands to run: focused `user-runner-alarm` and runner-container Vitest
  selections; the `foreground-reply-priority` hosted-local E2E; Cloudflare
  typecheck; scoped diff verification; exact-head GitHub Actions.
- Expected outcomes: foreground replacement is accepted without `retry_later`;
  abort failures preserve the old fence; background continuation survives;
  one reply is delivered; no overlapping writer or duplicate response occurs.
Completed: 2026-08-26
