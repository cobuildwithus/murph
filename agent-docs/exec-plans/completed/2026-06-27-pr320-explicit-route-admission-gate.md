Goal (incl. success criteria):
- Fix Eragon round 29 PR 320 finding: explicit Linq thread-route delivery must not append/wake while a reclaimed first-contact processing receipt has no terminal allow decision.

Constraints/Assumptions:
- Preserve admitted stale first-contact behavior from round 28: consume as stale-first-contact before active routing.
- Preserve normal explicit thread-route behavior for ordinary active routed messages.
- Keep the fix scoped to planner gating and regression coverage.

Key decisions:
- Reuse a single `first-contact-admission-required` planner helper for normal and explicit route gates.
- Check processing first-contact receipts before explicit thread-route delivery when admission is required and no allow decision is present.
- Validate through the full webhook service path by making the classifier return a terminal block.

State:
- Ready to commit.

Done:
- Round 29 finding received from Eragon.
- Added explicit route admission-required gate.
- Added regression for stale processing receipt with no recorded decision and explicit route present.
- Verification completed.

Now:
- Commit and push the round 29 fix, then rerun Eragon.

Next:
- Run Eragon round 30 on the pushed PR head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts
- pnpm --dir apps/web typecheck:prepared
- git diff --check
- pnpm --dir apps/web verify
- pnpm typecheck (fails unrelated assistant/operator-config baseline)
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
