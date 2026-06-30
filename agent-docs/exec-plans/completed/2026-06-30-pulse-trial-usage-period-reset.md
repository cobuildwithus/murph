Goal (incl. success criteria):
- Extend the Pulse Trial ops reset so it resets the matching AI usage allowance period, not only Stripe/local billing dates.
- Success means an apply run creates or resets a `hosted_ai_usage_period` row for the new trial window with the Pulse Trial limit and zero spend, and the ops result exposes a count for that reset.

Constraints/Assumptions:
- Keep Stripe as the first external write; local billing and usage period updates should happen together after Stripe succeeds.
- Do not expose member ids, customer ids, subscription ids, or secrets in UI/API output.
- Preserve historical usage ledger rows; reset the allowance period counter/window without deleting usage events.
- Use the existing hosted ops route and page; no new script or separate admin path.

Key decisions:
- Add usage-period reset to the Prisma-backed candidate source so custom tests can still isolate core Stripe ordering.
- Upsert the new trial-window usage period instead of mutating historical usage rows.

State:
- In progress.

Done:
- Verified production billing rows reset, while matching AI usage periods were not updated by the first ops-button run.

Now:
- Patch the hosted-ops reset service and focused tests.

Next:
- Run focused Vitest, hosted-web typecheck, diff verification, then commit and push.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-ops/pulse-trial-reset.ts
- apps/web/app/(dashboard)/ops/pulse-trial-reset/pulse-trial-reset-client.tsx
- apps/web/test/hosted-pulse-trial-reset.test.ts
- apps/web/test/hosted-ops-pulse-trial-reset.test.ts
- pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-pulse-trial-reset.test.ts apps/web/test/hosted-ops-pulse-trial-reset.test.ts
- pnpm --dir apps/web typecheck
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
