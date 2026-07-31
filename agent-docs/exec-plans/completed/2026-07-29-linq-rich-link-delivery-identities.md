# Track every Linq rich-link delivery identity

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

Close the accepted final-review finding on the terminal rich-link patch by
keeping every accepted provider message id under the existing
`HostedLinqDelivery` owner.

## Success criteria

- Successful text-plus-link sends return ordered provider ids and expose the
  link message as the final scalar result.
- Hosted runtime cleanup receives every accepted provider message id.
- Hosted delivery receipts mark the logical delivery delivered only after
  every owned message part is delivered, and failed when either part fails.
- A synchronous link-send failure retains the accepted primary identity in the
  existing partial-delivery shape without blindly retrying the primary text.
- Focused tests prove success cleanup, both mixed receipt orders, buffered
  receipts, and permanent second-request failure.
- Exact-head verification, final ReviewGPT remediation review, CI, acceptance,
  merge, and worktree retirement complete.

## Scope

- Local and hosted Linq adapter result/error metadata.
- Hosted runtime delivery outcome transport.
- Owned provider-message receipt rows beneath `HostedLinqDelivery`.
- Focused delivery, receipt, cleanup, route, and migration tests.
- Durable Linq delivery documentation.

## Constraints

- Do not add opener or filler copy.
- Keep `HostedLinqDelivery` as the sole attempt, retry, and aggregate-status
  owner; message rows are cascade-owned receipt state, not a new lifecycle.
- Preserve old single-message rows and old runtime payload compatibility.
- Store only privacy-safe provider lookup keys and bounded id suffixes.
- Use existing stable provider idempotency keys; do not add a queue or retry
  service.

## Tasks

1. Propagate ordered provider ids and partial-delivery metadata from both Linq
   adapters.
2. Persist owned message parts and derive aggregate status from their ordered
   receipts.
3. Add focused regression and migration coverage.
4. Run scoped verification, commit, push, and update the PR description.
5. Run final ReviewGPT remediation review concurrently with exact-head CI and
   canonical acceptance, then merge and retire the worktree.

## Verification

- Focused Vitest coverage passed for the touched operator-config, assistant
  engine, assistant runtime, Web Linq transport, delivery store, signed route,
  and migration paths.
- Focused typechecks passed for `@murphai/operator-config`,
  `@murphai/assistant-engine`, `@murphai/assistant-runtime`, and
  `@murphai/web`.
- Prisma Client generation passed against the new owned-message model.
- Canonical
  `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff apps/web packages/operator-config packages/assistant-engine packages/assistant-runtime`
  passed every directly affected package test and typecheck. Broader
  reverse-dependent checks encountered clean-environment failures in generated
  Health Commons inputs and unrelated hosted-local MinIO/process integration
  tests; the canonical acceptance lane below generated the required inputs and
  covered the complete workspace.
- Canonical
  `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`
  passed in Blacksmith Testbox `tbx_01kyqf1txcjtw2t398xp4y36yv`, including
  workspace typecheck, Web production build and 7,420 Web tests, Cloudflare
  verification, affected package coverage, and prepared-artifact checks.
- `git diff --check` passed, and the added-line privacy scan found no local
  usernames or home-directory paths.
- Exact pushed-head CI and the final ReviewGPT remediation round continue on
  the PR after this plan is archived with the scoped implementation commit.
Completed: 2026-07-29
