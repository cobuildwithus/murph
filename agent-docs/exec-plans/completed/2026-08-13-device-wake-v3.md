# Device scheduled-wake recovery cutover

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Restore provider reconcile cadence for connections whose exact scheduled wake
  was already consumed under the pre-retention runtime semantics, without
  mutating production rows or adding another scheduler.

## Success criteria

- New due-reconcile retries use one deterministic `v3` event identity that is
  distinct from the consumed `v2` identity for the same connection deadline.
- Focused tests prove the compatibility cutover, deterministic retry identity,
  bounded sweep behavior, and existing wake admission behavior.
- The compatibility contract documents why the revision moved and preserves
  exact mailbox duplicate comparison.
- The exact pushed candidate passes required ReviewGPT gates and GitHub checks.
- The merged Web deployment is live and bounded production evidence shows new
  wake admission and deadline advancement, or the remaining external blocker is
  reported precisely.

## Scope

- In scope: scheduled-reconcile event identity, focused Web tests, the owning
  orchestration contract, and a privacy-safe public reliability note.
- Out of scope: provider token or account mutation, database repair writes,
  Cloudflare runtime changes, a second scheduling owner, and unrelated runtime
  checkpoint churn.

## Constraints

- Technical constraints: Web remains the source of canonical device-sync facts;
  Temporal remains the only global due-reconcile cadence owner; event IDs remain
  stable within the new revision; the sweep stays limited and concurrency-capped.
- Product/process constraints: preserve consent and privacy boundaries, keep the
  recovery generic, use the isolated PR lane, and verify live state before
  describing production as recovered.

## Risks and mitigations

1. Risk: old and new envelopes are both pending during deploy skew.
   Mitigation: existing runtime dedupe keeps provider jobs deterministic, and a
   stale deadline cannot regress the canonical later deadline.
2. Risk: the cutover restores cadence but the provider still returns no data.
   Mitigation: verify scheduler recovery separately from upstream data arrival
   and continue provider-specific diagnosis if the deadline advances without
   usable records.
3. Risk: the recovery cohort adds pressure while production database capacity is
   already elevated.
   Mitigation: retain the existing limit of 25 and concurrency of 5, deploy only
   the identity cutover, and watch bounded aggregate health during convergence.

## Tasks

1. Advance the scheduled-reconcile compatibility revision from `v2` to `v3`.
2. Add focused regression coverage for distinct legacy/current identities and
   update sweeper expectations.
3. Update the owning compatibility contract and public changelog fragment.
4. Run focused tests, prepared Web typecheck, documentation checks, and inspect
   the privacy-safe diff.
5. Push the exact candidate, run specialist and final ReviewGPT with CI, resolve
   findings, merge, and verify the production deployment and recovery cohort.

## Decisions

- Use the existing revision seam instead of database mutation or new runtime
  machinery because the defect is an event-identity collision across changed
  canonical handling semantics.
- Keep the rollout Web-only; the deployed Cloudflare runtime already understands
  the unchanged wake envelope and treats the event ID as opaque identity.

## Verification

- Commands to run: focused Web Vitest files, prepared Web typecheck, changelog
  fragment validation, docs checks, exact-head CI, ReviewGPT gates, Vercel
  deployment inspection, and narrow read-only production database/log queries.
- Expected outcomes: `v3` identity assertions pass; all required gates are green;
  production inserts/consumes the new wake revision and advances stale deadlines
  without new scheduler or database-capacity errors.
- Local results before candidate publication:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts` passed 133 tests.
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/changelog-fragments.test.ts apps/web/test/changelog.test.ts` passed 45 tests.
  - `pnpm --dir apps/web typecheck:prepared` passed after generating the existing Health Commons build artifacts required by a clean checkout.
  - `pnpm docs:drift` passed.
Completed: 2026-08-13
