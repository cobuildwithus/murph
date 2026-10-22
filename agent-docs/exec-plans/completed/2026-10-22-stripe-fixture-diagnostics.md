# Preserve safe Stripe fixture failure evidence

Status: completed
Created: 2026-10-22
Updated: 2026-10-22

## Goal and evidence

The hosted-local billing matrix can report only a generic failure when the
official Stripe fixture exits unsuccessfully. Its existing child process uses
ignored output. The missing evidence prevents distinguishing which fixture
step failed and whether a provider response was received. Preserve only finite
diagnostics in the existing test error, without changing billing behavior.

## Owner and scope

- Owner: apps/web/test/support/hosted-stripe-billing-live.ts and its existing
  composed support tests. No production source, fixture requests, credentials,
  billing state, retry policy, time budget, workflow gate or dependency changes.
- Reuse the existing child-process lifecycle and sanitized error boundary.
  No new persisted state, logging pipeline or diagnostic artifact.
- Internal proof infrastructure only; Product UX and changelog are not applicable.
- Existing open PRs and dirty worktrees have no collision with this helper.
  Merged test pruning changed billing workflow selection, not this child owner.

## Implementation and privacy

ReviewGPT authors the correction. Bound captured bytes in memory, drain both
streams, and project only the three repository-owned fixture step names,
numeric HTTP/process exit status and fixed diagnostic categories. Never emit
raw output, response bodies, URLs, provider IDs, message text, environment
values, arbitrary error codes or paths. Preserve success and failure semantics.

## Verification and completion

1. Reproduce loss of step/status evidence using synthetic child output through
   the actual fixture execution path. Demonstrate old source fails the proof.
2. Verify success, nonzero exit, timeout/start failure, chunk boundaries,
   bounded output and hostile synthetic private values.
3. Run the focused web support tests, web typecheck, complexity and docs guards.
4. Review the patch, close the plan, commit and open a draft PR. Start final
   ReviewGPT on the Ready pushed head concurrently with required CI.
5. Merge after all gates pass. No production runtime deployment is required;
   scheduled CI remains the owner of future real-provider evidence. Do not
   claim the original fixture/provider failure resolved by diagnostics alone.

## Status

- ReviewGPT authored the helper, composed tests and owner documentation.
- Three focused regressions failed against the original helper, then the full
  48-test support suite passed after the correction. Full web typecheck passed.
- Complexity guard passed (test infrastructure excluded from source ratchet);
  the bounded collector and sanitizer introduce no shared abstraction.
- Parent reviewed stream lifetime, output bounds, fixed allowlists, timer and
  success semantics, privacy, and scope. No provider calls were made locally.
- Local Node is 24.14.1 versus the declared 24.22.1 minimum; exact-head CI owns
  verification on the supported runtime. Original provider failure remains open.
- Final external review and required CI remain PR completion gates.
Completed: 2026-10-22
