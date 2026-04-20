## Title

Land the greenfield code-quality follow-ups for route helpers, neutral web utilities, and Cloudflare storage crypto naming.

## Goal

Resolve the non-UI quality findings without changing product behavior: remove brittle deep relative imports in the targeted App Router slices, centralize POST-only JSON method handling, move generic web utilities out of the device-sync owner module, and rename Cloudflare hosted-storage envelope helpers so storage failures report the correct scope.

## Scope

- targeted `apps/web/app/api/device-sync/**` and `apps/web/app/api/linq/**` route files plus the shared route HTTP helper layer
- `apps/web/src/lib/{http,device-sync/shared,hosted-onboarding/shared,...}` plus directly coupled neutral utility call sites
- `apps/cloudflare/src/{crypto,hosted-email,bundle-store,user-key-store}` and directly coupled tests
- `apps/cloudflare/src/runner-outbound/codec.ts` if typecheck confirms it is unused

## Constraints

- Preserve unrelated dirty-tree edits and work carefully on top of overlapping active rows in `apps/web` hosted onboarding/device-sync and `apps/cloudflare`.
- Keep behavior stable; this is a cleanup lane, not a product change.
- Do not widen package boundaries or add dependencies.
- Prefer alias imports (`@/src/...`) over deep relative imports inside `apps/web`.
- Latest user instruction narrowed this landing away from UI and hosted-onboarding component work; leave those files out of the commit even if related diffs are present in the worktree.

## Verification

- focused pass: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-phone-auth-support.test.ts apps/web/test/device-sync-shared.test.ts apps/web/test/agent-session-service.test.ts apps/web/test/agent-route.test.ts apps/web/test/agent-session-routes.test.ts apps/web/test/settings-email-settings.test.ts apps/web/test/hosted-existing-account-sign-in-dialog.test.ts apps/web/test/hosted-linq-agent-pair-route.test.ts`
- focused pass: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/crypto.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/storage-path-rotation.test.ts`
- focused pass: `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`
- scoped verification attempt: `bash scripts/workspace-verify.sh test:diff <scoped task paths>` blocked by unrelated pre-existing `apps/cloudflare verify` / `apps/web test/next-config.test.ts` failures already present in the branch
- planned: `git diff --check`

## Notes

- The route-helper cleanup should stay small: one reusable `methodNotAllowedJson()` / `postOnlyJson()` helper, not a larger routing framework.
- The hosted phone-auth/controller cleanup and the UI-root hard cut remain intentionally out of scope for this landing after the latest user instruction.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
