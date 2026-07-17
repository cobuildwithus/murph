# Hosted usage top-up specification

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Land a durable product and engineering specification for fixed-value hosted
  usage top-ups that extends Murph's existing usage-limit product behavior with
  the smallest composable payment and credit-accounting primitive.

## Success criteria

- The specification defines the individual Pulse/Edge MVP, including Settings
  UX, one-time Stripe Checkout, replay-safe fulfillment, credit consumption,
  refunds, disputes, rollout, rollback, and verification.
- Payer and beneficiary are separate durable facts so the same beneficiary
  ledger can later support authenticated group-container funding without a
  second balance system.
- Base included allowance, subscription entitlement, Stripe payment state, and
  Murph usage credit remain separate owners.
- The document reflects the confirmed product contract that usage exhaustion
  blocks subsequent usage-bearing work and explicitly records the contradictory
  checked-out source state for implementation reconciliation.
- Canonical indexes and the related current-state usage doc link to the proposal.

## Scope

- In scope:
  - The corrected target-state product/engineering specification.
  - Canonical product-spec and agent-doc index entries.
  - Bounded source-state notes in the current usage-visibility and downgrade
    specs so their advisory implementation snapshots are not product authority.
- Out of scope:
  - Runtime, schema, Stripe Dashboard, API, or UI implementation.
  - Resolving the current source/runtime enforcement discrepancy.
  - Group funding, Family funding, arbitrary amounts, or auto-recharge.

## Constraints

- Technical constraints:
  - Reuse `HostedMember.id` as the beneficiary owner for both people and future
    synthetic group containers; do not add a speculative `UsageAccount` owner.
  - Keep Stripe as payment evidence and `apps/web` as usage-credit authority.
  - Keep the existing included allowance and plan entitlement owners intact.
  - Fulfill from verified Stripe state through the existing receipt/retry owner;
    never grant from the browser return.
- Product/process constraints:
  - Initial personal offers are fixed at $5, $10, and $25.
  - Accepted blocked conversation input stays durable and becomes runnable after
    a verified grant restores capacity.
  - This is docs/process-only work using the Markdown verification fast path.

## Risks and mitigations

1. Risk: A top-up-only schema prevents later group funding.
   Mitigation: Persist payer and beneficiary separately and key the credit ledger
   to the existing `HostedMember` beneficiary boundary.
2. Risk: Payment facts, subscription state, and usage capacity become one
   ambiguous balance.
   Mitigation: Keep immutable cash, grant, conversion-policy, entitlement, and
   consumption facts separate even when v1 converts one-for-one.
3. Risk: Retries or out-of-order webhooks duplicate payable Checkout Sessions or
   usage grants.
   Mitigation: Freeze the exact Checkout request, fence ambiguous creation, and
   use semantic-source uniqueness plus append-only compensating ledger entries.
4. Risk: The spec encodes the checked-out advisory source state as product truth.
   Mitigation: Treat enforced exhaustion as the confirmed product contract and
   make source-state reconciliation an explicit implementation prerequisite.

## Tasks

1. Reconstruct the corrected specification on the latest `origin/main` in an
   isolated worktree.
2. Update canonical indexes and the existing usage-visibility cross-reference.
3. Read back every touched document, verify references and privacy, and inspect
   the scoped diff.
4. Finish the plan through the repo commit helper, push the branch, and open a
   draft PR with the required intent and change-shape contract.
5. After the routed completion commit, run the user-requested ReviewGPT PR loop
   to `ROUND_OUTCOME: PASS`, remediate accepted findings if any, and verify final
   PR CI.

## Decisions

- Use one Stripe Product with reusable one-time Prices for $5, $10, and $25.
- Use a Murph-owned append-only usage-credit ledger, with included allowance
  consumed before purchased credit and purchased credit carrying until used.
- Keep one beneficiary-scoped ordering/locking boundary for grants, debits, and
  reversals; do not mutate the derived base period limit.
- Keep the append-only ledger canonical while maintaining bounded rebuildable
  balance/version fields on the beneficiary for the admission hot path.
- Use one durable `claimed` Checkout-create state from before Stripe I/O until
  attachment or proven absence, instead of separate in-flight and unknown
  states that can diverge after a crash.
- Separate the authenticated payer from the `HostedMember` beneficiary now so
  future group funding changes authorization and presentation, not accounting.
- Extend the existing enforced usage-limit owner and trigger an idempotent
  runtime recheck after an eligible grant; do not add another gate or terminal
  policy.
- Record the current advisory source/tests/copy mismatch without expanding this
  docs-only PR into an unproven runtime repair.
- Mark the current usage-visibility document as a source snapshot rather than
  leaving its advisory implementation statements as product authority.

## Verification

- Commands to run:
  - Read back every touched Markdown file.
  - `git diff --check` on the scoped patch.
  - Verify every new repository-local reference exists.
  - Search touched docs for direct personal identifiers and local paths.
  - Run an independent final specification consistency review.
  - Run the PR ReviewGPT loop on the exact pushed head and confirm final CI.
- Expected outcomes:
  - A docs-only patch with no whitespace errors or personal identifiers.
  - Canonical indexes resolve to the new proposal.
  - ReviewGPT returns `ROUND_OUTCOME: PASS` with zero accepted findings.
  - Required PR checks are green on the final head.

### Local completion results

- Read back every touched Markdown file and confirmed the isolated copy matched
  the corrected specification from the original checkout before the reviewed
  remediations below.
- `git diff --check` and untracked-file whitespace checks completed without
  errors.
- Repository-local references and canonical index links resolve.
- The touched-file privacy scan found no direct identifiers, local home paths,
  credentials, or secrets.
- `pnpm docs:drift` passed.
- The independent consistency review's five initial findings were remediated by
  simplifying Checkout ambiguity state, bounding the admission read, explicitly
  representing future paid-but-unfulfillable funding, distinguishing required
  queue semantics from checked-out source state, and demoting advisory source
  snapshots from product authority. Its final re-review returned no findings.
- ReviewGPT and final PR CI remain post-completion gates against the exact pushed
  head and are recorded on the PR rather than treated as pre-push local proof.
Completed: 2026-07-16
