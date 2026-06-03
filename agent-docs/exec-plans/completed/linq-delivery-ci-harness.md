# Linq Delivery CI Harness

## Goal

Get the `linq-delivery` hosted-local CI/deploy gate passing and unblock the
hosted Cloudflare deploy.

## Constraints

- Prefer test harness or E2E scaffolding fixes only.
- Do not touch production source unless direct evidence proves the runtime
  boundary is broken.
- Preserve unrelated assistant-engine scheduled-reminder edits.
- Keep logs, artifacts, and docs free of secrets, direct identifiers, local
  usernames, and home-directory paths.

## Current Evidence

- The failed deploy job ran `pnpm hosted-local e2e linq-delivery` with
  `MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1`.
- CI showed hosted assistant provider requests happened for each fast-gate user.
- The Linq stub observed no `POST /chats` requests before timeout.
- Hosted status showed mailbox lag cleared and no final runner error.
- Hosted status also showed one pending hosted outbox delivery effect, so the
  Linq wait helper had recoverable work to drain but only nudged on mailbox lag.
- The helper now treats pending hosted outbox delivery effects as a recoverable
  nudge condition while waiting for a Linq stub request.
- Focused helper test and Cloudflare typecheck passed. Scoped `pnpm test:diff`
  for the two helper files passed, including `apps/cloudflare verify`.
- The exact local fast gate progressed past the original first-contact Linq
  send wait; the remaining local failures were later activation snapshot uploads
  to the local R2 stub returning connection refused, a separate local harness
  setup failure not seen in the original CI evidence.
- Coverage-write found no gaps. Final review found one low-severity masking
  issue when stale mailbox lag and fresh pending delivery were both present; the
  nudge policy now ORs the independent recovery conditions and has a regression
  test for that case.
- Post-review checks passed: focused helper Vitest, Cloudflare typecheck, diff
  whitespace check, and scoped `pnpm test:diff` for the helper files.

## Plan

1. Reproduce the fast-gate Linq delivery scenario locally.
2. Trace the hosted-local Linq stub, runner env profile, and provider-effect
   observation boundary.
3. Patch only the harness/E2E scaffolding if the runtime path is healthy.
4. Run targeted hosted-local E2E plus scoped verification.
5. Run required completion review passes.
6. Commit the scoped fix, push, verify CI, then run the deploy workflow.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
