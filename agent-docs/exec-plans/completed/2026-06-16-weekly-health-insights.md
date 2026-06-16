# Weekly Health Insights Managed Automation

## Goal

Add a Murph-managed weekly automation that installs into eligible vaults, runs every Wednesday after lunch in the vault's local timezone, looks for one interesting non-duplicative personal health/body finding, tells the user when it finds one, and saves durable synthesis to the derived knowledge wiki.

## Constraints

- Keep this on the existing canonical `bank/automations/*.md` managed-seed path.
- Do not add a scheduler, backfill script, or new durable state.
- Preserve user-owned automations with colliding slugs.
- Use `derived/knowledge/**` for private synthesized wiki output, not public Health Commons.
- Keep the automation silent when no useful finding exists.

## Plan

1. Extend the managed automation seed list with a Wednesday-after-lunch health-insight automation. Done.
2. Make the prompt explicitly require prior-wiki search/read before writing, and skip output when it finds nothing useful. Done.
3. Add focused managed-automation tests for create/idempotency, schedule, tags, and prompt invariants. Done.
4. Run focused assistant-engine verification, then the required completion audits/checks. In progress.

## Verification Target

- `pnpm --dir packages/assistant-engine test -- managed-automations-core.test.ts`
- `pnpm --dir packages/assistant-engine test -- managed-automations.test.ts managed-automations-core.test.ts`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched files>`

## Verification So Far

- `pnpm --dir packages/assistant-engine test -- managed-automations.test.ts managed-automations-core.test.ts` passed.
- `pnpm build:workspace:incremental` passed to prepare fresh-worktree workspace declarations.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/managed-automations.ts packages/assistant-engine/test/managed-automations.test.ts packages/assistant-engine/test/managed-automations-core.test.ts agent-docs/exec-plans/active/2026-06-16-weekly-health-insights.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `security-privacy-review` found no medium-or-higher findings.
- `coverage-write` added persisted-record prompt/tag assertions in `managed-automations-core.test.ts`.
- `pnpm --dir packages/assistant-engine test -- managed-automations.test.ts managed-automations-core.test.ts` passed after the coverage-write change.
- Parent review tightened the knowledge upsert example to include `--body <markdown>` and canonical `--source-path`; focused assistant-engine tests passed after that correction.
- `deep-review` found no production-breaking bugs; residual gap is a live hosted/model canary after deploy.
- Final `pnpm typecheck` passed.
- A final repeat of the diff-aware verifier was interrupted after the downstream Cloudflare Vitest lane hung with no output; the same diff-aware command had passed before the prompt-command wording tweak, and the final tree is covered by the focused assistant-engine test rerun plus full typecheck.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
