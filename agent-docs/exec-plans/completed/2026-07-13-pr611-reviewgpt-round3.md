# PR 611 ReviewGPT Round 3

## Goal

Delete the promotion-era production-deployment object and reuse the existing
SHA-only alias resolver while preserving exact project binding.

## Constraints

- Keep the normal release path as the sole production-alias owner.
- Require the configured project ID and exact Git SHA.
- Do not require unused deployment ID or name fields.
- Preserve configuration-only setup and authenticated bounded drain proof.

## Verification Plan

- Focused production migration guard and group-confirmation suites.
- Hosted-web typecheck, docs drift, diff check, and parent final review.
- Guarded push, CI, and a fresh exact-head ReviewGPT round.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
