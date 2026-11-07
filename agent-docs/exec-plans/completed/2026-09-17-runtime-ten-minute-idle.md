# One ten-minute hosted runtime quiet window

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Keep an accepted conversation's runtime available for a normal ten-minute quiet
window, without another ten-minute container tail or an independent three-minute
policy. Preserve foreground priority, accepted Ask validity, and checkpoint safety.

## Success criteria

- One configured duration feeds runtime idle batching and container warmth.
- A follow-up between minutes three and ten uses the resident invocation.
- Consented-member Asks blocked on checkpointing reach their existing authority
  check before their ten-minute expiry, after any current foreground reply.
- Existing receipt-based container expiry remains absolute; completion,
  maintenance, and liveness do not grant another warm interval.
- Focused tests and typechecks pass; final PR head passes required CI and ReviewGPT.

## Scope

Remove the independent checkpoint setting, duplicate fallback resolver, and unused
normalized lifecycle projection. Reuse the runtime's checkpoint deadline and the
container's existing receipt-based expiry. Update focused proofs and live owner docs.
No new scheduler, queue, state store, protocol version, or production mutation.

## Evidence and architecture

The diagnosed warm-workspace path restarted an invocation after its independent
three-minute idle retirement. Main now includes receipt-based container expiry
and bounded cleanup retries, so that correction must be preserved rather than
reimplemented. Runtime quiet batching still defaults separately to three minutes.
Ask requests already expire after ten minutes and the existing causal-input test
proves consented-member requests wait behind the dirty checkpoint.

Canonical receipts, mailbox sequencing, checkpoint fences, effect publication,
and Ask authority retain their existing owners. The wire duration remains a
derived request field for independently deployed readers. Retired local/test
configuration moves to the single setting; no compatibility knob is introduced.

## Product UX

Effort: Patch. Replay a returning conversation during the extended quiet window,
an Ask with and without concurrent conversation, ordinary quiet shutdown,
background progress, and shutdown/racing-input safety. No prompt, tool surface,
or model decision changes; deterministic composed runtime proof owns timing.
Verdict: Ready. Controlled-clock journeys prove minute-four and minute-nine
follow-ups use one invocation; Ask tests prove an early checkpoint and scheduled
handoff before expiry with foreground delivery first. Existing container tests
prove receipt expiry, liveness non-renewal, and active-owner protection.

## Tasks

1. Add focused timing/expiry regressions and consolidate configuration.
2. Advance the existing checkpoint for observed Ask admission deferral.
3. Preserve and verify absolute container expiry and active-owner safety.
4. Update owner docs/changelog, run focused tests/typechecks and parent review.
5. Commit, open a draft PR, mark Ready, and run ReviewGPT concurrently with CI.
6. Resolve supported findings and finish with a green, mergeable PR.

## Risks and mitigations

A longer normal window delays Browser Vault and other checkpoint-dependent
publication. Accepted expiring work must request an earlier safe checkpoint.
Canonical receipt acceptance remains independent of the idle snapshot.
Active work and checkpoint publication may finish after the nominal deadline;
there is no extra retention period. Native cleanup retries remain bounded by
the existing safety owner and never renew conversation warmth.

## Verification

Planned: runtime checkpoint, causal-input, receipt, metadata, provider-cleanup,
shutdown and warm-follow-up suites; Cloudflare environment, invocation preparation,
container lifecycle and entrypoint suites; hosted-local config tests; affected
package typechecks, complexity diff, owner-doc checks, exact-head CI and ReviewGPT.

## Evidence recorded

- Runtime: 155 tests passed across causal input, collapse/warm follow-up,
  checkpoint publication, provider cleanup, checkpoint wakes, shutdown and receipts.
- Metadata checkpoint timing: both tests passed in the preceding focused run.
- Cloudflare: 698 tests passed across environment, runner lifecycle, entrypoint,
  invocation transport/preparation, identity, fleet lifecycle and alarms.
- Hosted-local harness: 110 tests passed after updating the single-setting
  allowlist ordering; stub timing uses the existing one-second container minimum.
- Assistant runtime, hosted execution, Cloudflare, hosted-local harness and Web
  typechecks passed. Fresh-checkout Prisma generation was required before the
  Cloudflare typecheck. Changelog generation is supplied by Web preparation.
- Complexity guard passed; existing hotspot debt is unchanged. The timer update
  remains in its existing owner; no new scheduler, persistent state or abstraction.
- The first Ask regression run failed both scenarios by waiting for the longer
  idle deadline. The correction passed both and preserves checkpoint ordering.
- Changelog proof uses the repository-root Vitest command; the skill's package-cwd
  command encounters the already-recorded changelog focused-command friction.
- Native lifecycle implementation is preserved from the base, including its
  distinct one-minute safety retry when active or uncertain; that retry does not
  extend warmth. Official Cloudflare Container lifecycle semantics were checked.

## Remaining completion

Implementation and local verification are complete. PR #3536 is open and the
changelog names that PR. The original session owns final ReviewGPT, required
exact-head CI, and any necessary remediation. Those remote gates remain pending
at plan archival; no deployment is authorized or performed.

Changelog archive rendering: ten tests passed. Owner documentation drift passed.
Completed: 2026-09-17
