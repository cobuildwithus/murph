# Hosted runner destroy timeout

## Goal

Find and fix the Cloudflare hosted-local Linq E2E regression where runner
startup/restart can hang until the test harness times out.

Success criteria:

- Identify the failing CI boundary and the last passing CI run.
- Prove the underlying runner lifecycle failure locally with a focused test or
  direct scenario evidence.
- Keep the fix bounded to the smallest lifecycle primitive.
- Run focused verification plus the Linq hosted-local scenario when feasible.

## Constraints

- Preserve unrelated worktree edits and active plans.
- Do not expose local user identifiers, secret values, raw mailbox payloads, or
  home paths in committed docs, tests, logs, or handoff text.
- Warm shell reuse is an optimization; ambiguous cleanup must be bounded and
  fail closed rather than blocking fresh hosted work.

## Approach

1. Trace the CI failure and last passing run.
2. Reproduce locally with the Linq hosted-local E2E lane.
3. Add a focused runner-container regression test for a hanging native
   `destroy()` call.
4. Patch runner cleanup so destroy requests are bounded before the settle poll.
5. Re-run focused verification and local scenario proof.

## State

Active.

## Notes

- CI failure occurs in `Cloudflare Hosted E2E / Linq delivery E2E` during the
  stale scheduled wake setup, after Temporal schedule setup and before deploy
  smoke output.
- Local repro also fails during `ensure-processing` with a request abort and
  logs `Hosted execution container warm shell was invalidated; destroying
  before reuse.`
