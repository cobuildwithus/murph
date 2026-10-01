# Remove retired unpaid Stripe trial machinery

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove the drained unpaid Pulse-trial conversion, cancellation, and disposable phone-transfer machinery while preserving current paid billing and immutable accounting history.

## Success criteria

- Retired unpaid trial events append no Starter grant, activate no member, and schedule no trial-specific cancellation.
- Paid legacy subscriptions retain exact identity and invoice-backed reconciliation, including terminal updates.
- Historical completed receipt recovery, ledger rows, migrations, offer metadata, and customer idempotency identities remain supported.
- Ordinary phone transfer and account deletion retain their authorization and cleanup boundaries.
- Focused tests, Web typecheck, and complexity guard pass before a scoped draft PR.

## Scope

- In scope: existing Stripe event owner, retired runtime grant migration helpers, unpaid trial cleanup owner, disposable legacy phone-transfer alternative, directly affected tests and current owner documentation.
- Out of scope: production data changes, Stripe mutations, replay policy changes, schema contraction, paid legacy normalization, financial/idempotency owners, completed historical plans, ordinary Family and deletion cleanup.

## Constraints

- Authority remains with the existing member billing projection, immutable credit ledger, and Stripe receipt owner; no new state or retry owner.
- Provider and crypto work stay outside short database transactions.
- Keep old completed-receipt fallback and generic customer provisioning idempotency namespace unchanged.
- Parent owns candidate review, Ready admission, ReviewGPT, and exact-head CI. This lane delivers a draft PR.

## Product UX

Outcome: current Starter and paid journeys keep their existing result while retired unpaid inputs become inert.
Reaches: direct Starter members, established legacy paid members, and phone-transfer/account-deletion flows.
Proof: provider-shaped event tests establish no new free access from old trial inputs and preserve paid cancellation/payment behavior; phone-transfer tests preserve fail-closed source eligibility.

## Evidence and design

The canonical Starter owner records the completed provider-object drain and removed trial creators. A bounded operational review established the unpaid implementation is ready to contract. Paid legacy metadata and historical receipt pointers remain live compatibility consumers. Remove only the retired unpaid effects; preserve ordinary subscription/invoice normalization and receipt handling. No timestamp-based global replay exclusion is introduced.

## Risks and mitigations

1. Old trial metadata still occurs on paid subscriptions. Preserve known-policy validation, current paid normalization, exact billing identity, and invoice proof; exercise paid and terminal event cases.
2. Historical completed receipts predate saved activation pointers. Preserve their existing mailbox lookup fallback and history decoding.
3. Rollout may encounter stale work. Ordinary rollout gates recheck absence of unpaid bindings and pending legacy deletion cleanup; leave poisoned receipts and historical ledger data untouched. No migration or rollback-floor change is introduced beyond the existing Starter-compatible floor.

## Tasks

1. Remove unpaid conversion and cancellation effects from existing Stripe owners.
2. Remove unused runtime migration debit initialization and phone-transfer scaffold alternative.
3. Update focused proof and durable owners to describe the retained compatibility boundary.
4. Run focused tests, coordinated Web typecheck, complexity guard, and diff review.
5. Complete the plan, scoped commit, push, and open a draft PR for parent review.

## Decisions

- Use an empty existing activation outcome for verified retired unpaid trial input; no new receipt status, replay age policy, or queue.
- Retain paid normalization and all immutable historical data contracts.

## Verification

- Implemented the scoped removals and reviewed the retained paid/history boundary.
- Initial focused proof: 12 suites / 399 tests passed; the account-deletion suite required the declared changelog generation wrapper, then passed 117 tests. Web `typecheck:prepared` passed after Prisma/Health Commons generation and the existing device-syncd/vault-usecases build prerequisites.
- The renamed retained legacy-policy validator initially exceeded the per-file complexity ratchet. Removing the redundant one-item filter and expressing the exact item predicate directly reduced it from 22 to 20; explicit valid/invalid policy-shape cases cover the simplification. The final prepared 14-suite batch passes all 535 tests, including those new policy cases and the preserved Checkout identity guard.
- `pnpm complexity:diff --base 62609d5a09bf169eacd6e8be108e26fd41275035` passes: total changed-source debt 254 to 211. All 21 retained hotspots were inspected: billing identity/checkout acceptance, current Starter phone-transfer allowlists, invoice and Family financial authority, receipt effects/retry classification, and billing phase/receipt projections retain current consumers; broader changes are outside this contraction.
- Final `pnpm --dir apps/web typecheck:prepared` passes. `pnpm docs:drift` and `pnpm docs:gardening` pass; `git diff --check` is clean.
- Bounded review found a paid delinquency-to-cancellation edge: exact bound terminal updates must remain authoritative when delinquency has cleared the paid phase. The implementation retains that projection and adds phase/status cases. No grant or new paid authority is inferred.
- Hotspot inspection also removed the unused billing-identity replacement option; no runtime caller opted into it. The retained negative Checkout test proves an existing identity cannot be replaced through a matching legacy attempt.
- Parent candidate review and required exact-head CI remain separate completion gates.
- Deployment: ordinary compatibility-first Web rollout; no schema change. Recheck unpaid/deletion drain and reconcile ordinary paid events after deploy. Forward-only repair remains the existing post-Starter rollback policy.
Completed: 2026-09-10
