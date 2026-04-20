## Title

Remove `assistant.cron.tick` from live hosted-execution contracts and docs.

## Goal

Make the hosted run-centric hard cut unambiguous: `assistant.cron.tick` is not a supported hosted ingress kind, not a supported hosted runtime event kind, and not an admin/manual carve-out in current live docs. Runtime timers stay internal as `runtime.timer`, and any future explicit external/manual/admin trigger should use a different ingress kind.

## Scope

- `agent-docs/references/hosted-run-protocol.md`
- `docs/hosted-hard-cut-migration-guide.md`
- `apps/web/src/lib/hosted-ingress/queue.ts`
- `apps/web/test/hosted-ingress-queue.test.ts`
- `packages/hosted-execution/src/parsers.ts`
- directly coupled `packages/hosted-execution/test/**`

## Constraints

- Preserve unrelated dirty-tree hosted-run, Cloudflare, and onboarding work.
- Do not edit immutable completed execution plans.
- Keep the change narrow: remove the live contract/documentation residue without broadening into new ingress kinds.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-ingress/queue.ts apps/web/test/hosted-ingress-queue.test.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/test agent-docs/references/hosted-run-protocol.md docs/hosted-hard-cut-migration-guide.md`
- planned: `git diff --check`

## Notes

- Historical review docs and completed plans may still mention `assistant.cron.tick` as past state; this lane only removes it from current live contracts and source-of-truth docs.
