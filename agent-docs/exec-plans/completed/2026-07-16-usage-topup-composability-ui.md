# Finish hosted usage top-ups with composable modules and polished UI

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Finish PR #751 by splitting the largest usage-credit modules along their
  existing owner boundaries, simplifying the browser dialog state model, and
  correcting the confirmed UI issues without changing payment authority or
  recovery behavior.

## Success criteria

- Checkout, reconciliation, ledger, and dialog responsibilities are separated
  into narrow owner-local modules with no new state owner, package dependency,
  generic payment framework, or behavior-changing compatibility layer.
- The top-up dialog has one coherent state transition owner, one clear primary
  recovery action, an explicit safe way to start a different amount after a
  failed attempt, concise choice copy, Settings-aligned typography, and proven
  focus/dismissal behavior.
- Focused regression tests, owning typechecks, truthful diff-aware verification,
  desktop and mobile browser proof, frontend review, and coverage review have no
  unresolved actionable findings.
- The exact pushed head passes ReviewGPT and required CI, remains mergeable with
  current `main`, and PR #751 is merged.

## Scope

- In scope: owner-local module extraction for hosted usage-credit checkout,
  Stripe reconciliation, ledger operations, and the web top-up dialog; matching
  imports, tests, durable module documentation, PR description, and release
  gates.
- Out of scope: new top-up amounts, subscriptions, group funding, debt,
  entitlement suspension for reversals, generic payment UI, schema changes, new
  dependencies, or changes to Stripe/webhook/ledger authority.

## Constraints

- Stripe remains the money authority and the Murph ledger remains the usage
  authority. Browser return state and browser polling never grant credit.
- Preserve the durable pre-provider purchase fence, stable idempotency key,
  frozen checkout contract, one-nonterminal-purchase rule, live provider reads,
  beneficiary mutation lock, prepare/apply version fence, exactly-once grant,
  FIFO settlement, and signed reversal convergence.
- Keep provider and KMS work outside beneficiary locks. Account deletion must
  still resolve or safely expire checkout ambiguity before owner removal.
- Preserve unrelated worktree and coordination-ledger changes. Do not introduce
  cross-package internal imports or weaken runtime invariants for tests.
- ReviewGPT is the sole cross-cutting PR gate for the completed change; run it on
  the exact pushed substantive head concurrently with CI.

## Risks and mitigations

1. Risk: moving functions changes mock boundaries or introduces a dependency
   cycle while runtime behavior appears unchanged.
   Mitigation: map every consumer and test mock first, keep extracted modules in
   the same owner directory, use narrow explicit exports, and run focused suites
   after each seam.
2. Risk: making the dialog dismissible during an ambiguous provider request
   permits a new request key before the original attempt is resolved.
   Mitigation: preserve the attempt identity across dismissal or retain the
   safety lock; add regression proof for close, reopen, retry, and amount reset.
3. Risk: UI simplification hides truthful pending or recovery state.
   Mitigation: preserve the server-owned status vocabulary, bounded polling, and
   explicit recovery actions; render and inspect every material dialog state.
4. Risk: a large mechanical move obscures an accidental behavior change.
   Mitigation: keep extractions symbol-complete, inspect the staged diff for
   non-move edits, and run source-owner tests plus diff-aware verification.
5. Risk: `main` advances or overlaps before the PR is ready.
   Mitigation: integrate the latest base through ordinary Git history before the
   exact-head review, then rerun CI for any later base-only update without
   restarting a zero-finding ReviewGPT round.

## Tasks

1. Map exact module consumers, test mocks, Base UI dismissal/focus APIs, and the
   current PR/base state.
2. Extract the smallest coherent owner-local modules from the four oversized
   production files and keep their public contracts explicit.
3. Replace the dialog's parallel state setters with one discriminated reducer
   and implement only the evidence-backed Fable UI corrections.
4. Run focused tests and typechecks, then desktop/mobile browser proof and the
   required frontend-review and coverage-write audit passes.
5. Perform parent final review, finish the scoped plan commit, update from
   current `main`, push, update the PR description, and start ReviewGPT with CI.
6. Address accepted findings on new substantive heads and merge PR #751 when
   the exact head is green and mergeable.

## Decisions

- Keep the existing PR branch and clean isolated worktree rather than creating a
  second implementation lane.
- Treat payer/beneficiary separation as the documented future composition seam;
  do not widen it into group funding or collapse it during a file-layout change.
- Favor explicit owner-local files and direct imports over barrels, registries,
  or a generalized payment state machine.
- Treat provider-request dismissal as a payment-ambiguity decision, not a visual
  preference; only change it with exact state-preservation proof.
- Keep frozen-purchase amount projection out of this finish pass. The current
  server projection does not expose a trustworthy display amount in every
  recovery state, and widening that contract would be a product/API change
  rather than a correction to the existing top-up flow.
- Reject a generic purchase view-model abstraction. The discriminated reducer,
  direct capability flags, and owner-local modules make the current state flow
  explicit without adding another translation layer.

## Verification

- Focused dialog suite: 27 tests passed after the final reducer, focus,
  capability-label, bfcache, and cancel-copy changes.
- Focused hosted-usage suites: 394 tests passed across the dialog, checkout,
  ledger, purchase-service, reconciliation, deletion, and route boundaries.
- Final exact `pnpm test:diff` coverage lane: exit 0 in 305 seconds; 444 web test
  files passed and 4 skipped, with 5,590 tests passed and 145 skipped. TypeScript,
  dev smoke, lint, and the production Next build also passed; lint reported 12
  unrelated warnings and zero errors, and the build generated 201/201 pages.
- Targeted ESLint for the four dialog modules and dialog test passed, and
  `git diff --check` passed.
- Final coverage-write audit: zero findings and no edits. Existing tests prove
  the stable request key, durable pre-provider fence, payer/beneficiary
  authority, exactly-once grant, FIFO settlement, capped signed reversals, live
  provider reads, deletion convergence, and the corrected dialog transitions.
- Final frontend-review audit: zero unresolved evidence-backed findings. It
  confirmed capability-aware labels, explicit transition focus, dismiss-safe
  request identity, server-owned payment state, and responsive shared-primitive
  composition.
- Fable completed successfully. Accepted findings corrected trigger wording,
  transition focus, redirect restoration, duplicate unavailable/fulfilled copy,
  and cancel-specific errors. Amount projection and a generic purchase
  view-model were rejected as unsupported scope expansion.
- Browser proof is unavailable because the installed browser plugin exposes no
  runnable backend. The JSDOM component suite cannot substitute for real Base UI
  focus trapping/restoration, clipping, overflow, and touch-layout inspection.
- A real Stripe test-mode checkout/webhook and deployed desktop/mobile smoke
  remain release checks because local tests use provider and UI-primitive mocks.
- Exact pushed-head ReviewGPT, CI, mergeability, and deployment convergence are
  PR/release gates after the scoped implementation commit.
Completed: 2026-07-16
