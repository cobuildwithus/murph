Goal (incl. success criteria):
- Fix Eragon round 31 PR 320 finding: malformed JSON body previews from native `Response.json()` errors must not leak in fail-open logs.

Constraints/Assumptions:
- Preserve useful parse-error cause summaries.
- Keep provider body redaction centralized in the shared log string sanitizer.
- Cover the actual runtime `Response.json()` error shape.

Key decisions:
- Redact both old-style `Unexpected token ... in JSON at position ...: <body>` messages and native `Unexpected token ..., "<preview>"... is not valid JSON` messages in `sanitizeJsonLogString`.
- Drive the fail-open regression with a real `Response(raw).json()` SyntaxError so it covers the runtime parser shape.
- Preserve the cause summary while replacing body-derived excerpts with a stable redaction placeholder.

State:
- Ready to commit.

Done:
- Round 31 finding received from Eragon.
- Confirmed local runtime error shape for invalid JSON response bodies.

Now:
- Commit and push the round 31 fix, then rerun Eragon.

Next:
- Run Eragon round 32 on the pushed PR head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/http.ts
- apps/web/test/http.test.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/http.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/http.test.ts
- pnpm --dir apps/web typecheck:prepared
- git diff --check
- pnpm --dir apps/web verify
- pnpm typecheck (fails unrelated assistant/operator-config baseline)
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
