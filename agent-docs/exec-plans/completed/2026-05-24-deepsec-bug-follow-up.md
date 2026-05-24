# DeepSec bug follow-up

Status: completed
Created: 2026-05-24
Updated: 2026-05-24

## Goal

- Fix actionable subagent findings from the active DeepSec `BUG` batch review without expanding the runtime design.

## Success criteria

- Same-second WhatsApp `START` / `STOP` commands can apply in observed order instead of treating equal timestamps as stale.
- Stale WhatsApp consent writes do not leave consent-event history that failed to update the grant.
- Edge upgrade re-validates the post-Stripe-update subscription item shape before metadata repair and local reconciliation.
- Focused tests pin the fixed behavior and important lock-order invariants.
- Required focused verification and completion audits pass, or unrelated blockers are documented.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/whatsapp-consent.ts`
  - `apps/web/src/lib/hosted-onboarding/billing-plan-change-service.ts`
  - Focused hosted web tests for consent, billing plan changes, account deletion lock order, and usage allowance lock ordering if needed.
- Out of scope:
  - Backfilling legacy `_minimized_` webhook traces without provider-account blind indexes.
  - The active `HIGH_BUG` contact/Linq/runtime/core slice.
  - Broad billing or consent redesign.

## Constraints

- Preserve unrelated dirty worktree edits and existing active ledger rows.
- Prefer existing transaction and helper boundaries over new services or abstractions.
- Do not expose local identifiers, direct user identifiers, secrets, raw provider payloads, or private contact values in files or handoff.

## Risks and mitigations

1. Risk: Consent ordering fixes introduce a larger event/grant abstraction.
   Mitigation: Keep the change inside the existing write helper with precomputed event ids and conditional grant writes.
2. Risk: Stripe hardening performs more provider mutations than needed.
   Mitigation: Reuse the existing cleanup/unsupported-item helper and fail before metadata reconciliation when the returned shape is unsafe.

## Tasks

1. Register plan and ledger row.
2. Patch WhatsApp consent stale/duplicate/event ordering.
3. Patch Stripe post-update item validation.
4. Add focused regression tests.
5. Run focused verification and required audits.
6. Close the plan through the repo commit workflow.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-whatsapp-service.test.ts apps/web/test/hosted-onboarding-billing-plan-change-service.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts` (4 files, 105 tests).
  - `pnpm --dir apps/web exec eslint src/lib/hosted-onboarding/whatsapp-consent.ts src/lib/hosted-onboarding/billing-plan-change-service.ts test/hosted-onboarding-whatsapp-service.test.ts test/hosted-onboarding-billing-plan-change-service.test.ts test/hosted-account-data-service.test.ts test/hosted-execution-usage-allowance.test.ts`.
  - `pnpm --dir apps/web typecheck:prepared`.
  - `git diff --check`.
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/whatsapp-consent.ts apps/web/src/lib/hosted-onboarding/billing-plan-change-service.ts apps/web/test/hosted-onboarding-whatsapp-service.test.ts apps/web/test/hosted-onboarding-billing-plan-change-service.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts agent-docs/exec-plans/active/2026-05-24-deepsec-bug-follow-up.md` (`apps/web verify` passed: app tests, lint, dev smoke, production build).
- Audits:
  - Simplify: low cleanup suggestions applied where they reduced drift.
  - Security/privacy: found post-grant event-create duplicate race; fixed by throwing to roll back transaction and added regression.
  - Coverage-write: added duplicate preflight and Stripe cleanup-return regression tests.
  - Final review: no findings; residuals are live Postgres concurrency proof, live Stripe behavior, and out-of-scope legacy `_minimized_` traces.
Completed: 2026-05-24
