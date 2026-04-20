# Restore Cloudflare hosted-local e2e lanes after the run-centric hard cut

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Restore the focused hosted-local Cloudflare e2e commands so the documented Linq, Telegram, and duplicate-commit lanes pass again on the current run-centric hosted protocol.

## Success criteria

- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local` passes.
- `pnpm --dir apps/cloudflare test:e2e:telegram:local` passes.
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local` passes.
- The duplicate-commit e2e lane uses the current internal `runtime.timer` seam instead of the removed persisted `assistant.cron.tick` ingress shape.

## Scope

- `apps/cloudflare/package.json`
- `apps/cloudflare/scripts/run-hosted-local-e2e.ts`
- `apps/cloudflare/test/hosted-local-*.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-*.ts`
- directly coupled `apps/cloudflare` test contracts only if required to keep the restored lanes truthful

## Constraints

- Preserve unrelated dirty-tree work across `apps/cloudflare`, `apps/web`, and shared hosted packages.
- Keep the fix narrow to the missing focused e2e layer and the hard-cut protocol delta it depends on.
- Do not reintroduce removed durable hosted-wake or `assistant.cron.tick` compatibility paths.

## Verification

- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
- `pnpm --dir apps/cloudflare test:e2e:telegram:local`
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/package.json apps/cloudflare/scripts/run-hosted-local-e2e.ts apps/cloudflare/test`
Completed: 2026-04-20
