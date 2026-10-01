# Publish Web admission results for Vercel

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal and invariant

Restore automatic Git-managed production promotion after exact-candidate
admission succeeds. No notification may substitute for successful proof or
remove the existing required deployment check.

## Evidence and design

Completed GitHub admission jobs left imported Vercel checks running. Publishing
the verified outcome through the same context's commit-status channel settled
the imported check. This proves the missing completion-delivery boundary; it
does not identify the vendor-internal reason for lost check-run completion.

Extend the existing workflow: publish pending before proof and derive a final
status from the completed admission job in a dependent finalizer. Reuse GitHub
CLI and job-scoped status permission. No new dependency, private secret, poller,
Vercel writer, or admission service. Preserve candidate/reader/target proof,
managed deployment ordering, and the required check.

## Tasks

1. Recover the authorized release and verify the serving domain and runtime.
2. Add exact-SHA pending and completed-job status publication.
3. Execute the actual workflow shell against captured GitHub CLI calls for
   success, failure, cancellation, skipped proof, and notification failure.
4. Run controller tests, relevant typecheck, owner-doc checks, candidate review,
   exact-head CI, and required ReviewGPT. Commit and prepare the durable fix.

## Risks and mitigation

- Premature success: finalizer depends on the entire admission job, including
  post steps; only successful completed admission can publish success.
- Stale status on rerun: pending precedes proof and the finalizer requires the
  proof attempt to match the current workflow attempt. Retry the whole workflow.
- Delivery failure: GitHub CLI errors fail the publisher; the Vercel gate stays.
- Extra authority: only status-writing permission is added; the finalizer has
  no checkout, protected environment, private credentials, or deployment token.

## Verification

Production recovery and explicit notification readback passed. All 76 controller
tests passed, including actual-shell publication checks for every terminal
result, mismatched attempts, and API failure. The repo tooling typecheck and
complexity guard passed. Final ReviewGPT and exact-head CI remain PR completion
gates; their immutable run evidence belongs with the PR.
Completed: 2026-09-12
