# PR 219 ReviewGPT Follow-Up

## Goal

Fix the accepted ReviewGPT findings on PR 219 before merge:

- Surface deterministic Stripe `subscriptions.update` failures instead of converting them into indefinite `billing_pending`.
- Collapse the duplicated Start Pulse client mutation protocol into the hosted onboarding client API helper.
- Reject terminal Stripe subscriptions before returning stale hosted invoice URLs.
- Reuse Settings as the payment-method portal return surface and delete the dedicated Start Pulse return route.
- Stop maintaining the dead period-level `lastUsageAt` copy in the usage allowance hot path.

## Constraints

- Only retrieve/reconcile after genuinely ambiguous Stripe trial-ending mutation failures.
- Keep deterministic Stripe 4xx failures visible to route error reporting.
- Preserve view-specific state and success navigation in each component.
- Keep the client helper small; do not add a hook or new service layer.
- Do not expose payable invoice URLs for `canceled` or `incomplete_expired` subscriptions.
- Keep `HostedAiUsage` as the spend and recent-usage authority; retain only metadata still needed for notice claiming.

## Implementation Notes

- Classify ambiguous Stripe failures by safe Stripe error metadata: network/connection/timeouts and 5xx responses are ambiguous; deterministic 4xx responses rethrow.
- Add focused regression coverage for a Stripe `statusCode: 400` update rejection.
- Move the shared Start Pulse POST/response validation/redirect switch into `src/components/hosted-onboarding/client-api.ts`.
- Update the settings button and settings action to call the shared helper.
- Whitelist recoverable Stripe subscription statuses before invoice recovery and after ambiguous-update reconciliation.
- Return the Stripe payment-method portal to `/settings`, deleting the dedicated finish page and component.
- Remove `lastUsageAt` selection, aggregation, comparison, and writes from usage allowance period maintenance.

## Verification Plan

- Focused hosted onboarding billing service tests.
- Focused hosted billing settings component tests.
- Focused hosted usage allowance and account-data export tests.
- Hosted web typecheck.
- `pnpm test:diff` over touched files.
- `git diff --check`.
- Push and rerun the PR ReviewGPT loop before merge readiness.

## Verification Evidence

- Focused hosted billing service, hosted onboarding client API, hosted billing settings, usage allowance, and account-data export Vitest passed: 5 files, 146 tests.
- `pnpm -C apps/web typecheck:prepared` passed.
- `pnpm test:diff -- ...` over the touched files passed through hosted web verify, including lint, dev smoke, hosted web Vitest, and Next build. Reran after the final Stripe guard-order hardening; it passed again with the same existing Turbopack NFT warning.
- `git diff --check` passed.
- Diff privacy scan for local identifiers passed.
- Required local audit subagents were attempted, but they reviewed the already-pushed PR head instead of this uncommitted worktree and returned stale findings that this diff fixes. Parent final review covered the local diff before commit; external ReviewGPT will review the pushed head after this commit.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
