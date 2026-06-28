# Managed Insight Skip

## Goal

Ensure Murph-managed weekly health insight automations feel free to skip when
they cannot find a genuinely useful, interesting, user-specific insight.

Success criteria:

- The weekly health insight managed seed explicitly uses the notification skip
  path for weak, stale, repeated, or housekeeping-only findings.
- Existing runtime/send gating remains unchanged.
- Focused managed-automation tests prove the prompt contract.

## Constraints / Assumptions

- Keep this prompt-primary and narrow to managed automation seed text plus
  directly coupled tests.
- Do not add scheduler state, delivery state, or a second send gate.
- Preserve existing weekly health digest behavior.
- Health insight stays without `system:assistant-require-send`.

## Key Decisions

- Use the notification turn's `{"kind":"skip","privateSummary":"..."}`
  decision as the explicit suppression mechanism; cron notification turns do not
  expose `murph.finish_without_reply`.
- Do not send from an existing dated insight section unless it still clears the
  current interestingness bar.

## State

Implementation and verification complete; ready to close.

## Done

- Read repo routing, verification, architecture, product, security,
  reliability, and messaging-deliverability docs.
- Confirmed cron already treats explicit no-reply as no delivery, and health
  insight is not force-send tagged.
- Updated the weekly health insight seed to explicitly allow zero or one note,
  use structured notification skip decisions for weak/no-useful-info outcomes,
  and gate same-day existing sections before sending.
- Updated managed automation prompt assertions.
- Prompt-review audit found that `murph.finish_without_reply` is unavailable in
  notification turns; accepted and fixed by switching the prompt to
  `{"kind":"skip","privateSummary":"..."}`.
- Focused tests, assistant-engine typecheck, and diff-aware verification passed
  after the fix.
- Prompt-review rerun returned no findings.

## Now

- Close the plan and commit with `scripts/finish-task`.

## Next

- Handoff with verification results and the unrelated repo-wide typecheck
  blocker.

## Open Questions

- None.

## Working Set

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/managed-automations.test.ts test/managed-automations-core.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/managed-automations.ts packages/assistant-engine/test/managed-automations.test.ts packages/assistant-engine/test/managed-automations-core.test.ts`
- `pnpm typecheck` (blocked by unrelated `apps/web/src/lib/phone-calls/retell-runtime.ts` Retell SDK/type errors)
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
