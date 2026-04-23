# Stop hosted Linq typing immediately after delivery drain

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Stop runner-owned hosted Linq typing as soon as the committed assistant delivery drain finishes instead of waiting for the rest of finalize-side exports and snapshot work.
- Add regression coverage that proves Linq typing clears before finalize fully returns in the hosted-local end-to-end path.

## Success criteria

- Hosted finalize stops executor-owned Linq typing immediately after `drainHostedCommittedAssistantDeliveriesAfterCommit(...)` completes and before usage export or later finalize work continues.
- The hosted-local Linq e2e can delay post-send finalize work and proves a `/typing` stop arrives after the reply send but before hosted completion returns.
- Focused verification for the touched hosted runtime/Cloudflare/apps-web slices is green, or any unrelated pre-existing failure is called out explicitly.
- Required completion audits run before handoff, and the final scoped commit contains only this task's files plus plan closeout.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/{execution.ts,typing.ts}`
  - `packages/assistant-runtime/test/hosted-runtime-finalize-coverage.test.ts`
  - `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
  - `apps/web/app/api/internal/hosted-execution/usage/record/route.ts`
  - plan bookkeeping for this task
- Out of scope:
  - broader typing ownership redesigns outside the executor-owned hosted Linq path
  - Cloudflare runner callback protocol changes
  - unrelated hosted observability work outside the exact finalize delivery seam
  - provider behavior changes for Telegram/email

## Constraints

- Preserve unrelated dirty-tree edits and overlapping active rows.
- Keep the fix focused on the earliest safe stop signal after delivery drain; do not widen into a larger finalize protocol redesign.
- Treat local logs and stub payloads as sensitive; do not copy personal identifiers or secrets into repo files or handoff.

## Risks and mitigations

1. Risk: a runtime-side direct stop could diverge from typing ownership and miss the executor-owned path.
   Mitigation: guard the new stop to executor-owned Linq wakes only, keep the existing finalize-end cleanup as a fallback, and cover ordering in hosted-runtime tests.

2. Risk: the hosted-local e2e could pass without actually creating a post-send window large enough to catch regressions.
   Mitigation: inject a deliberate post-send delay in the local harness and assert stop ordering against the observed Linq request stream plus hosted completion timing.

3. Risk: overlapping Linq helper and hosted cleanup work in the dirty tree could widen the commit beyond this regression.
   Mitigation: keep the proof self-contained in the e2e file, avoid shared helper edits in the scoped commit, and preserve unrelated dirty-tree work.

## Tasks

1. Register the active plan and ledger row.
2. Stop executor-owned Linq typing directly inside hosted runtime finalize immediately after committed delivery drain.
3. Add focused hosted-runtime coverage proving typing stop precedes later post-send exports.
4. Extend hosted-local Linq e2e with delayed post-send finalize work and assert typing stop happens before hosted completion.
5. Run truthful scoped verification, required audits, and finish through the scoped commit flow.

## Decisions

- Switched from the original runtime-to-runner callback plan to a runtime-side direct Linq `DELETE /typing` after delivery drain because the callback seam widened into risky Cloudflare protocol plumbing.
- Kept the existing finalize-end stop path as idempotent cleanup and moved only the earliest safe Linq stop earlier.
- Kept the hosted-local proof focused on reply-send versus typing-stop ordering and intentionally avoided overlapping zero-retention cleanup assertions.

## Verification

- Commands to run:
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-finalize-coverage.test.ts`
  - `env -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts -t "sends a Linq reply after a later inbound Linq message" --no-coverage`
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/execution.ts packages/assistant-runtime/src/hosted-runtime/typing.ts packages/assistant-runtime/test/hosted-runtime-finalize-coverage.test.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts apps/web/app/api/internal/hosted-execution/usage/record/route.ts`
  - targeted hosted-local Linq e2e rerun proving send-before-stop-before-finalize-complete ordering
  - `git diff --check`
  - required `coverage-write` and `task-finish-review` audit passes
- Direct scenario proof to capture:
  - one hosted-local Linq reply run where the observed request stream shows `POST /messages`, then `DELETE /typing`, while hosted completion is still intentionally delayed
Completed: 2026-04-23
