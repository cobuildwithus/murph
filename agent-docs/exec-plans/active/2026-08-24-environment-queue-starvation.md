# Environment Queue Starvation

Status: active
Updated: 2026-08-24

## Outcome And Invariant

An accepted Environment interview must update the canonical Environment report
after any already-running foreground turn reaches a safe handoff. Foreground
replies keep priority, accepted mailbox rows stay durable and ordered, and the
fix must not add another scheduler, queue, state owner, or polling loop.

## Proven Gap

- Aggregate production evidence showed a set of accepted Environment interview
  items remain durably queued but unhandled for tens of minutes.
- The delay overlapped long-lived `default` runtime invocations while normal
  conversation work continued.
- Cloudflare runtime arbitration can replace selected maintenance owners with
  `environment_interview`, but an active `default` invocation returns busy and
  retains ownership indefinitely from the Environment request's point of view.
- Existing Environment execution tests cover an idle runner, not an interview
  accepted while `default` is active.

## Product UX Patch

- Outcome: an accepted Environment interview reaches the existing report
  without an unbounded wait behind unrelated hosted work.
- Reaches: the existing Web Environment interview save and recovery journey.
- Proof: a production-shaped contention test finishes the current foreground
  boundary, executes the queued Environment owner, refreshes Browser Vault, and
  clears the durable processing frontier.

## Plan

1. Trace the current Web, Temporal, Cloudflare, runtime, and checkpoint owners
   and separate foreground work from background continuation work.
2. Add a failing contention regression for Environment work arriving during an
   active `default` invocation.
3. Reorder the existing owner handoff at the narrowest boundary so the active
   foreground turn can finish and queued Environment work receives bounded
   ownership next.
4. Run focused Cloudflare/runtime tests and typechecks, replay the Product UX
   journey, and inspect the final privacy-safe diff.
5. Commit the scoped change, open a draft PR, and run the required exact-head
   specialist/final reviews with CI.

## Deployment

Deploy the Cloudflare Worker/controller and its runner bundle through the same
ordinary Cloudflare release. A controller-first overlap is safe because it adds
only the existing generic wake; a runner-first overlap is inert until the
controller begins waking the default owner. Web is unchanged. Post-deploy,
verify that a contended Environment item advances the system mailbox frontier,
runs under the dedicated Environment owner after the default checkpoint, and
refreshes Browser Vault.

## Verification

- Controller regression was red before the fix because the active default
  child was never woken; it now passes and proves no abort or duplicate start.
- Runtime regression was red before the fix because default mode continued
  after checkpoint; it now proves one foreground pass, one checkpoint, an
  immediate recheck, and no Environment import under the default owner.
- All 155 UserRunner coordination tests pass.
- The Environment handoff, Environment execution/Browser Vault refresh, and
  existing provider-handoff runtime tests pass together.
- Cloudflare and assistant-runtime package typechecks pass.
- The required changelog fragment is privacy-safe and reuses the existing
  archive; all 57 focused changelog tests and the prepared Web typecheck pass.
- Live desktop/phone changelog inspection is blocked because this session has
  no attached in-app browser; the existing archive/page render contracts are
  covered by the focused test set, and the PR will link the preview route for
  reviewer inspection.
