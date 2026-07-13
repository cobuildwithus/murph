# PR 572 final ReviewGPT remediation

Status: completed
Created: 2026-07-13

## Goal

Resolve the two substantive High findings and one accepted cleanup from the
exact-head ReviewGPT audit of `2893c138`, then prove the corrected PR head with
focused verification, diff-aware verification, green CI, and a fresh clean
exact-head ReviewGPT audit.

## Proven failures

- Successful system-mailbox handling never advances the durable system-lane
  `consumed_seq`, so retained handled rows remain eligible and can block the
  causal-sequence migration.
- The preference recovery sweep applies its handoff limit before the canonical
  active-access check, so inactive candidates can indefinitely hide eligible
  pending users.
- Two Cloudflare deployment inputs still expose a rollout flag that is now
  owned only by the web producer.

## Scope

- Derive the contiguous handled system-lane sequence from canonical imported
  and pending runtime state, include it in checkpoint status, and advance the
  durable lane counter only in the successful workspace checkpoint transaction.
- Select preference recovery candidates from active hosted members before the
  recovery limit while retaining the canonical async access check as defense in
  depth.
- Remove the obsolete Cloudflare deployment inputs for the web-owned flag.

## Constraints

- No new queue, lifecycle manager, persisted cursor, or wall-clock ordering.
- Preserve pending retry gaps, synthetic local device-sync wakes, checkpoint
  conflict behavior, and participant-aware runtime access checks.
- Keep PR #572 draft until a clean final exact-head audit and all completion
  gates pass.

## Verification

- Add focused failing reproductions for both High findings and their boundary
  cases.
- Run affected tests and typechecks, then serialized `pnpm test:diff`.
- Commit and push the corrected exact head, wait for green CI, and run exactly
  one new substantive ReviewGPT audit on that head.
Updated: 2026-07-13
Completed: 2026-07-13
