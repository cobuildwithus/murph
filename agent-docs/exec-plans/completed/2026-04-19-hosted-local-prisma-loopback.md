## Title

Make hosted-local Prisma setup treat repo-local loopback Postgres dev databases as schema-sync targets instead of migration-deploy targets.

## Goal

Fix the local hosted setup/e2e regression where `scripts/dev-hosted-local/stack.ts` still runs `pnpm --dir apps/web prisma:migrate:deploy` against custom repo-local dev databases and fails with Prisma migration-history errors such as `P3009`.

## Scope

- `scripts/dev-hosted-local/{environment,environment.test,stack,stack.test}.ts`
- directly necessary hosted-local docs only if the behavior contract needs an explicit note

## Constraints

- Preserve the current non-local safety boundary: remote/non-loopback databases must stay on `prisma migrate deploy`.
- Do not revert or overwrite unrelated hosted-local edits already in flight in `scripts/dev-hosted-local/stack.ts`.
- Keep the fix local-harness-only; do not change `apps/web` Prisma runtime behavior.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/stack.ts scripts/dev-hosted-local/stack.test.ts`

## Notes

- Prisma docs recommend `db push` for local-development prototyping and `migrate deploy` for non-development environments.
- The immediate regression is a too-narrow local heuristic, not a request to auto-repair non-local migration history.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
