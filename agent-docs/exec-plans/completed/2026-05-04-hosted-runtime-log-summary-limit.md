# Hosted Runtime Log Summary Limit

## Goal

Let sanitized hosted runtime logs preserve device-sync validation summaries long enough to debug WHOOP importer failures, without persisting provider-sourced free-form error text on durable connection rows.

## Scope

- `apps/web/src/lib/hosted-workspace/store.ts`
- `apps/web/test/hosted-workspace-store.test.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`

## Constraints

- Keep hosted log redacted JSON safety checks for local paths, emails, phone numbers, and secret-shaped content.
- Do not change token, OAuth, or device connection credential persistence.
- Preserve unrelated active work in the checkout.

## Verification

- `pnpm --dir apps/web test -- test/hosted-workspace-store.test.ts` passed.
- `pnpm --dir packages/hosted-execution test -- test/hosted-runtime-control.test.ts` passed.
- `pnpm --dir apps/web test -- test/hosted-workspace-store.test.ts test/hosted-runtime-internal-routes.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-workspace/store.ts apps/web/test/hosted-workspace-store.test.ts` reached `apps/web verify`; logging guard, lint, and app tests passed, then `next build` failed on unrelated hosted usage typing in `apps/web/src/lib/hosted-execution/usage.ts`.
- `pnpm typecheck` failed on unrelated runtime-state usage test typing from active usage-accounting work.
