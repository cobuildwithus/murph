# Fix foreground preemption standby recovery

Status: active
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Restore reliable foreground replies across both observed failure boundaries:
  make a completed container converge its durable write fence after a
  `RunnerContainer` activation reset, then allow an authenticated foreground
  replacement to use the existing pristine standby.

## Success criteria

- A trusted Web-direct default replacement may claim and bind the ready standby.
- Allocate mode has one prewarm owner: the standby pool, so an exact-user shell
  reservation cannot preempt a fresh foreground standby claim.
- A completed runtime clears its exact durable write fence even when the
  original `RunnerContainer` activation and every activation-owned completion
  path disappear before the result is received.
- Temporal, spoofed-direct, retention, and system-mailbox requests remain
  ineligible for fresh standby claims.
- The deterministic controller regression fails on the current action-derived
  gate and passes after the correction.
- The real hosted-local foreground-priority journey completes the foreground
  reply and resumes the interrupted Environment work.
- The exhaustive system-wake journey includes every registered wake kind,
  including the existing Journal group-fact wake.
- Focused tests, Cloudflare typecheck, exact-head CI, final ReviewGPT, protected
  rollout, and the production conversation canary all pass.

## Scope

- In scope: reset-safe completion-to-fence convergence, fresh standby
  eligibility after foreground preemption, single-owner allocate-mode prewarm,
  focused controller coverage, the exhaustive real-E2E wake fixture, matching
  runtime architecture/deploy documentation, protected rollout, and bounded
  production proof.
- Out of scope: a new scheduler, queue, pool size, persisted state, retry
  manager, Temporal contract, or container lifecycle owner.

## Constraints

- Technical constraints: derive admission from the authenticated foreground
  request facts already present on `RuntimeProcessingInput`; preserve pending
  and retained standby reconciliation before any fresh claim; keep background
  and untrusted inputs on the exact-user path; use the existing `UserRunner`
  write-fence CAS as the only completion authority.
- Product/process constraints: preserve the canonical mailbox, write-fence,
  container-binding, and checkpoint owners; use real full-stack proof with only
  external provider transports deterministic; deploy only through the reviewed
  hosted path.

## Risks and mitigations

1. Risk: a replacement action may refer to untrusted or background work.
   Mitigation: keep the existing default-mode, authenticated Web-direct flag,
   and validated direct-attempt identity checks; delete only the action label.
2. Risk: a retained standby retry could split member ownership.
   Mitigation: leave pending-target reconciliation ahead of fresh admission.
3. Risk: a unit fixture could claim success without exercising the deployed
   stack.
   Mitigation: rerun the real Web, Temporal, Cloudflare, Durable Object,
   container, Postgres, assistant-runtime, and outbound-delivery journey.
4. Risk: the system-wake mismatch could be hidden by shrinking the expected
   registry.
   Mitigation: construct and append a valid Journal group-fact wake so the
   exhaustive equality remains intact.
5. Risk: a duplicate container-origin and activation-origin completion could
   clear newer work.
   Mitigation: both paths converge through the existing exact
   attempt-and-generation `UserRunner` comparison; a late duplicate is
   harmlessly classified as superseded.
6. Risk: an extra recovery queue or poller would create another lifecycle
   owner.
   Mitigation: send one best-effort completion receipt from the process that
   actually finished the work and retain the existing outer result as fallback.

## Tasks

1. Prove the production chain from lost activation-owned completion through
   stale-fence replacement and action-derived standby rejection; trace the
   Journal wake mismatch to its producer.
2. Add red deterministic regressions for foreground replacement and
   allocate-mode prewarm ownership, plus the missing real Journal wake fixture.
3. Route container-origin completion through the existing internal runner
   control host to the exact `UserRunner` fence CAS, with reason-coded outcomes.
4. Delete the redundant action-derived standby gate and exact-user prewarm race,
   then align owning docs.
5. Run focused tests, typecheck, complexity/diff checks, the reset-before-result
   real E2E, and the exact real hosted-local foreground-priority E2E.
6. Commit, open a draft PR, complete final ReviewGPT and exact-head required CI,
   then merge.
7. Deploy Cloudflare through the protected workflow and prove recovery with the
   production conversation canary plus bounded private health aggregates.

## Decisions

- Product UX effort: Patch. Affected hosted members are those who message Murph
  while Environment or other background work owns their runner. The intended
  journey is immediate foreground reply followed by completion of the yielded
  background work, without a visible recovery action.
- The action name describes fence history, not current request authority.
  Standby eligibility therefore belongs to the existing trusted Web-direct
  default-request facts rather than `started` versus `replaced`.
- The Journal mismatch is test-fixture drift introduced when the registered
  wake kind was added; keep the exhaustive contract and add the missing wake.
- `UserRunner` remains the sole durable fence owner. The container that finishes
  a runtime reports the exact result over the already-bound internal runner
  control route before returning it to the disposable `RunnerContainer`
  activation; the old return path remains a best-effort fallback.
- In allocate mode, the standby coordinator is the sole shell-prewarm owner.
  Exact-user startup remains the normal fallback only after a claim miss.

## Verification

- Commands to run: focused `user-runner-alarm` and container-identity Vitest,
  the reset-before-result and foreground-priority hosted-local E2Es with the
  current private Temporal worker package, Cloudflare typecheck,
  `pnpm complexity:diff`,
  `git diff --check`, exact-head required CI, current-base merge-tree, protected
  Cloudflare deploy smoke/convergence, production conversation canary, and
  bounded production status/log aggregates.
- Expected outcomes: the new unit case is red before the controller correction
  and green after it; trusted foreground replacement invokes the claimed
  standby while background and untrusted cases remain on exact-user; the real
  reset-before-result journey clears the fence without an activation-owned
  callback; the real Environment-to-foreground handoff finishes both owners;
  deployment converges to one reviewed Worker/container release and the
  production canary receives a reply.
