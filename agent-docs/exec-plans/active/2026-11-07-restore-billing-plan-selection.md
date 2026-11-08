# Restore billing plan selection and renewal switches

Status: active
Created: 2026-11-07
Updated: 2026-11-08

## Goal

Restore a usable selected-plan Checkout for terminally canceled direct members, and distinguish renewal switches from payment-method management.

## Scope and constraints

Website only. Keep Stripe authoritative for billing and renewal timing. Retain the existing customer and checkout attempt owner; verify terminal subscription ownership before admitting replacement Checkout. Never alter live subscriptions, cards, or payments while developing. No new dependency or background job. Review identified that replaying an accepted predecessor after replacement could incorrectly enter refundable-loser cleanup. A narrowly scoped encrypted accepted-subscription receipt is therefore required; it preserves canonical predecessors atomically and distinguishes historical acceptance from mere Checkout creation.

## Product UX

- Outcome: a canceled member chooses a plan and reviews its actual Stripe Checkout instead of reaching a payment-method-only Portal page.
- Entry and promise: Settings presents eligible plan choices. A paid Max member can schedule Edge at renewal with a visible confirmation; cancellation is unnecessary. Portal stays clearly labeled as billing management.
- Affected people: canceled direct members, active Max and Edge members, pending or delinquent billing, sponsored/Family owners, stale or concurrently changing subscription authority.
- Proof: focused UI, route, service, store and webhook tests, plus synthetic rendering. Verify expired/replayed Checkout, rejected nonterminal subscriptions, customer mismatch, concurrent owner changes and existing Family/effect guards.
- Done when: exact-target Checkout and renewal-schedule journeys work without duplicate subscription admission or optimistic entitlement changes.

## Tasks

1. Prove canceled-state dead end and trace existing downgrade paths.
2. Restore terminal-canceled checkout through existing authority owners and test races.
3. Remove misleading plan-choice Portal fallbacks and make renewal switches explicit.
4. Verify saved-payment-method reuse without deleting existing cards.
5. Complete focused proof, review, changelog and draft PR; report separate deployment gaps.

## Findings

- Canceled accounts are navigation-recoverable but were denied new checkout, leaving generic Portal fallback under Choose Pulse/Edge.
- Max-to-Edge already uses a Stripe renewal schedule. Preserve this owner and prove the composed plan-card action.
- Card count and the cause of the original failed downgrade remain unverified. Do not invent a duplicate-card cleanup fix.

## Verification

- UI and downgrade paths: 124 focused tests passed; after presentation-only extraction, the 78 component tests passed again.
- Scoped web UI lint and diff whitespace checks passed. Combined authored-source complexity guard passed with no debt increase.
- Native browser inspection: real production billing component in synthetic account study, desktop plan grid and narrow stacked cards at 400% browser zoom. Canceled Choose Edge remains distinct from Manage billing; active Max shows renewal switch copy and Switch to Edge/Pulse.
- Backend final suite: 278 tests across service, Settings page, Stripe lookup, Checkout completion and event reconciliation passed after event-ordering and completion-replay corrections. Final web typecheck and scoped lint passed (existing unused-variable warnings only).
- PR: https://github.com/cobuildwithus/murph/pull/4735. All 36 code/build checks passed on the initial candidate. Hosted design evidence and final external billing review remain release gates. No live billing changes performed.
- Preview build succeeded, but an existing Telegram welcome study loaded the full hosted environment merely to format a public bot URL. Reuse the narrow username parser so synthetic rendering requires no privacy secrets; preserve full runtime validation for webhook and authenticated paths.

- Historical-acceptance remediation: 255 focused tests passed across browser success, billing service/store, Checkout completion/loser cleanup and privacy deletion/schema coverage. Composed browser proof covers two replacements, pre-receipt canonical acceptance, current/prior lookup rotation, canceled and stale-active historical replay, and genuine loser refund retry. Provider calls and database state are synthetic; invoice entitlement projection is represented by canonical fixture state. Final web typecheck, scoped lint, complexity guard and diff whitespace checks passed. The plan remains active pending the required second final review.

## Deployment contract

The Web app owns both checkout admission and Stripe reconciliation. Workflow input is an immutable event ID; old in-flight workflows cannot consume later-created replacement events. A minute cron also processes due receipts. Promote new checkout, webhook and cron admissions together and allow old invocations to drain. Once recovery checkout is enabled, do not roll back the consumer below replacement-aware code. If new-request routing cannot guarantee this, deploy the consumer before the producer. Deploy the additive accepted-subscription receipt migration before the new Web writer. No live migration is performed during development. Receipt-aware consumers are the rollback floor once replacement checkout is enabled; no persistent flag or iOS release is needed. Prior-key retirement requires re-deriving all retained receipt lookups from their same-member encrypted subscription source, as specified by the contact-privacy rotation owner.

## Remaining evidence limits

Live Stripe Dashboard is not signed in. Historical card count and original failed downgrade cannot be verified, and no card cleanup is claimed. Checkout keeps the existing customer and existing saved-card consent policy. UI tests use synthetic provider responses; no real subscription, payment, card or entitlement was changed.
