Goal (incl. success criteria):
- Fix Eragon round 30 PR 320 logging contract issue: fail-open Linq first-contact admission logs should retain the shared redacted cause summary.

Constraints/Assumptions:
- Do not log raw provider bodies or secrets.
- Keep sanitization in the shared hosted-onboarding logging formatter/redactor.
- Keep the fix scoped to logging and the existing fail-open test.

Key decisions:
- Preserve `errorCauseMessage` in the Linq fail-open warning by removing the caller-local deletion.
- Redact JSON parser body excerpts in the shared `sanitizeJsonLogString` path, not in the Linq caller.
- Keep the existing raw-provider-body leakage assertion and add a shared sanitizer unit assertion.

State:
- Ready to commit.

Done:
- Round 30 finding received from Eragon.
- Removed local cause-message deletion.
- Added shared JSON parse body excerpt redaction.
- Updated fail-open and HTTP sanitizer coverage.
- Verification completed.

Now:
- Commit and push the logging contract fix, then rerun Eragon.

Next:
- Run Eragon round 31 on the pushed PR head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- apps/web/src/lib/http.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- apps/web/test/http.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/http.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/http.test.ts
- pnpm --dir apps/web typecheck:prepared
- git diff --check
- pnpm --dir apps/web verify
- pnpm typecheck (fails unrelated assistant/operator-config baseline)
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
