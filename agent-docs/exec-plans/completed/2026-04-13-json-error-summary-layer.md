# Shared JSON Error Summary Layer

Goal (incl. success criteria):
- Replace route-by-route warning log detail wiring with a shared sanitized error-summary path in `apps/web/src/lib/http.ts`.
- Keep route helpers composable: routes should be able to inherit useful production diagnostics cleanly and still layer route-specific sanitization or extras when needed.
- Preserve API responses while improving prod log detail for unexpected 400/500 paths.

Constraints/Assumptions:
- Do not log secrets, tokens, emails, raw URLs, or absolute paths.
- Preserve the current response mapping behavior for syntax/type/range/uri/internal errors.
- Preserve unrelated dirty worktree files in the local hosted-dev lane.

Key decisions:
- Standardize a shared summarized-error envelope in the base JSON helper.
- Keep route-specific providers for domain extras, but merge them on top of the shared envelope instead of replacing it.
- Reuse hosted-onboarding sanitization where it already exists rather than widening development-only logging.

State:
- in_progress

Done:
- Confirmed the prior prod-debug commit only added a hosted-onboarding warning opt-in and not a true shared summary layer.

Now:
- Implementing the shared sanitized summary helper and updating tests.

Next:
- Run focused verification, required audit passes, and finish with a scoped commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any non-hosted routes need a route-specific string sanitizer immediately, or whether the generic shared redactor is sufficient for now.

Working set (files/ids/commands):
- `apps/web/src/lib/http.ts`
- `apps/web/src/lib/hosted-onboarding/http.ts`
- `apps/web/test/http.test.ts`
- `apps/web/test/hosted-onboarding-routes.test.ts`
- `pnpm typecheck`
- `pnpm test:diff ...`
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
