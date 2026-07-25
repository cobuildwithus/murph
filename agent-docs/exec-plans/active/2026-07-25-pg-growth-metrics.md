# PG-style growth metrics and usage top-up total

## Outcome

Make `/ops/growth` answer the weekly founder questions directly:

1. Is Murph's weekly MRR growth at or above the explicit 10% target?
2. Is revenue or active usage the strongest honest signal?
3. Which part of the path from signup to retained paid use is the current
   bottleneck?
4. How many successful usage top-ups have occurred in total?

The page remains a read-only operator view. It does not create a second metric
store, growth target owner, billing authority, or lifecycle.

## Evidence and design

- Paul Graham's `Startup = Growth` treats weekly growth rate as the number a
  founder should know, prefers revenue, and uses active users as the next-best
  proxy.
- `Do Things that Don't Scale` reinforces weekly rate rather than raw early
  totals and the importance of direct engagement with early users.
- The local YC notes require acquisition, activation, retention, and
  monetization evidence to identify the bottleneck instead of building a
  dashboard for its own sake.
- Existing Murph growth snapshots and current-period queries remain the source
  of truth. Successful usage top-ups are counted from fulfilled
  `HostedUsageCreditPurchase` rows, whose fulfillment is already webhook-owned.

## Scope

- Refine the growth metric projection and `/ops/growth` presentation.
- Make weekly MRR growth the single dominant score, green at 10% or above and
  red below 10%.
- Add total fulfilled usage top-ups as a lifetime supporting metric.
- Add or update focused tests for metric definitions and page rendering.
- Add the production composition to the design catalog with synthetic data.
- Record the explicit target-color exception in the durable design system.

## Invariants

- No raw member, payer, beneficiary, Stripe, or purchase identifiers leave the
  server or appear in the UI.
- Checkout attempts, open sessions, pending payments, failures, and expiries do
  not count as completed top-ups.
- The new read path performs no Stripe I/O and does not reinterpret the
  append-only usage-credit ledger.
- Growth rates use explicit current and prior windows and remain honest when a
  baseline is zero.
- The page stays useful on mobile and does not become a generic card dashboard.

## Verification

- Focused hosted-web growth metric and page tests.
- Canonical `pnpm test:diff` for the changed paths.
- `pnpm verify:acceptance`.
- Desktop and mobile browser proof for the design-catalog study and the real
  operator page where the local authenticated runtime permits it.
- Product-experience review, preliminary specialist ReviewGPT, and final
  ReviewGPT per the frontend completion workflow.

### Evidence so far

- Focused growth suite: 21 tests passed.
- Hosted-web typecheck passed.
- Canonical affected-path verification passed in Crabbox testbox
  `tbx_01kydp8vss52m0skq6k7pyxejx`: build, lint/typecheck, development
  smoke, and 6,508 tests passed.
- Repository acceptance completed all changed hosted-web coverage successfully.
  Its sole failure is an unchanged `packages/cli` prompt-contract assertion:
  the test still expects an earlier invalid-artifact sentence while the
  unchanged review preset uses the current invalid-evidence wording. The
  branch and `origin/main` are the same commit for both untouched files.
- Read-only production aggregate confirmed the fulfilled-status query has
  current rows without retrieving purchase or member identifiers.
- Product-experience review accepted two presentation corrections: explicitly
  name the top-up total as lifetime and delete repeated target framing. Re-review
  returned `NO FINDINGS`.
- Playwright proof covers target-hit, below-target, no-MRR-baseline, and
  no-supporting-baselines states at 1440x1200, 1100x1000, and 390x844. Each
  study had no horizontal overflow, and its four accessible title IDs were
  unique.
- The Opus UI double-check's accepted findings were resolved: target verdicts
  now use the displayed precision, missing snapshots make no source claim,
  helper prose and stat units use the intended type registers, trial maturity
  is defined, and the literal-red product exception is documented. Its final
  low-severity catalog-only synthetic-data inconsistency was corrected by
  pairing zero current payers with zero current MRR.
- Reviewer-readable Cloudflare Images hosting is blocked: the linked
  development project has no Images upload variables, and the connected
  Cloudflare API identity lacks Images write permission. The redacted captures
  remain in the ignored review-evidence path for exact-head specialist
  packaging; the draft PR must record this hosted-proof gap until a
  least-privilege Images token is available.
