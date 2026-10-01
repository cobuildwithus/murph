# Remove Stripe Customer provider calls from database critical sections

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep Stripe Customer creation outside every interactive database transaction while preserving payer authority, one durable Customer identity, and safe retry behavior.

## Success criteria

- Stripe Customer creation runs only after the preparation transaction closes and before the finalization transaction begins.
- Preparation and finalization both lock and revalidate the member owner, eligibility, Stripe-effect fence, and billing state.
- Ambiguous provider success reuses the existing stable Stripe idempotency key.
- Focused tests and Web typechecking pass, the exact pushed head completes required ReviewGPT gates, and the change is isolated in its own draft PR.

## Scope

- In scope: the member-scoped Stripe Customer creation owner and its focused tests.
- Out of scope: plan switching, Family billing, sponsorship cleanup, generic lock-wrapper redesign, schema changes, queues, managers, and new dependencies.

## Constraints

- Technical constraints: use two short database-only transactions around the existing provider call; keep the existing idempotency identity and current database owner.
- Product/process constraints: accept ReviewGPT's patch only if it remains the smallest maintainable local correction; open a separate draft PR and do not merge or mark Ready.

## Risks and mitigations

1. Risk: authority or billing state changes while Stripe is in flight.
   Mitigation: re-lock and compare the exact prepared owner state before binding; accept an already-bound race winner and fail closed on other drift.
2. Risk: Stripe commits but the response is ambiguous.
   Mitigation: retry the identical Customer request under the unchanged idempotency key.
3. Risk: a local fix grows into generic billing machinery.
   Mitigation: touch only the Customer owner and focused tests; add no schema, queue, manager, dependency, or generic abstraction.

## Tasks

1. [x] Validate the ReviewGPT artifact and its exact two-file scope against current `origin/main`.
2. [x] Apply and inspect the patch for owner-local ordering, race safety, and unnecessary complexity.
3. [x] Run focused unit tests, direct transaction-boundary proof, Web typechecking, and diff/docs checks.
4. [ ] Commit and push one candidate head, open a separate draft PR, and start preliminary and final ReviewGPT concurrently with CI.

## Decisions

- Keep the existing member billing row as the sole owner; no persisted state or schema change is needed.
- Treat a complete billing-row preimage comparison as the local compare-and-set fence for this narrow change.

## Verification

- Commands to run: focused Vitest for `hosted-usage-credit-member-stripe-customer.test.ts`; Web prepared typecheck; `git diff --check`; docs drift; current-base merge-tree.
- Expected outcomes: all focused checks pass; the Stripe mock asserts no interactive transaction is open; no unrelated file changes appear.
- Results: focused Vitest passed 9/9; focused ESLint passed; Web prepared typecheck passed after generating the ignored Health Commons catalog required by a clean checkout; diff and agent-docs drift checks passed.
Completed: 2026-08-26
