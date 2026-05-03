# Browser Vault Client Auth Gate

## Goal

Stop anonymous browser sessions from calling `/api/browser-vault/session`, and rename the client auth provider/hook surface from dialog-specific naming to a general auth context.

Success criteria:
- Anonymous dashboard/public Health Commons pages do not POST to `/api/browser-vault/session`.
- Authenticated sessions still load the browser-vault replica through the existing server-auth-gated route.
- Existing auth dialog behavior remains available through the same context.
- Focused browser-vault/auth tests cover the anonymous skip, anonymous refresh skip, auth-to-anonymous clearing, and renamed hook surface.

## Constraints

- Keep the API route's server-side app-session gate intact.
- Do not touch active hosted phone auth files or unrelated hosted onboarding dirty work.
- Preserve the existing root server-seeded authenticated snapshot.
- This is a client-side request suppression and naming cleanup, not a trust-boundary relaxation.

## Plan

1. Rename `AuthDialogProvider`/`useAuthDialog` to `AuthProvider`/`useAuth` at the public provider/hook level.
2. Update current callers to the renamed symbols.
3. Teach `BrowserVaultProvider` to read `useAuth().authenticated` and resolve anonymous state as `empty` without a fetch.
4. Add focused tests for anonymous browser-vault skip and the auth provider hook surface.
5. Run focused verification, required audits, and scoped commit.

## Verification

Completed:
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/browser-vault-context.test.tsx test/auth-button.test.ts --no-coverage` passed, including anonymous mount, anonymous refresh, and auth-to-anonymous no-stale-data regressions.
- `pnpm --dir apps/web lint` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/app/layout.tsx apps/web/src/components/dashboard/sidebar.tsx apps/web/src/components/hosted-onboarding/auth-dialog-provider.tsx apps/web/src/components/ui/auth-button.tsx apps/web/src/lib/browser-vault/context.tsx apps/web/test/auth-button.test.ts apps/web/test/browser-vault-context.test.tsx` passed before the final auth-transition follow-up. The final rerun after that follow-up was blocked by unrelated dirty hosted-onboarding Linq webhook tests outside this task; lint, dev smoke, Next build, and the focused browser-vault/auth tests passed.
- `git diff --check -- <task paths>` passed.

Audit results:
- `security-privacy-review` found anonymous `refresh()` still reached the loader; fixed by gating `load()` itself and adding a refresh regression test.
- `coverage-write` found no further test changes needed.
- `frontend-review` found no issues; no manual browser/network-panel spot-check was run.
- `task-finish-review` found one render-timing privacy gap on authenticated-to-anonymous transitions; fixed by deriving public browser-vault context values from auth state and adding a transition regression test.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
