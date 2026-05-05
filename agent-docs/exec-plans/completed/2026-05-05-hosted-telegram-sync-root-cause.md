# Hosted Telegram sync root cause

Status: completed
Created: 2026-05-05
Updated: 2026-05-06

## Goal

- Determine why the hosted join messaging setup shows "Unable to update Telegram" after email signup when Telegram is selected, verify the production state with redacted logs/DB evidence, and land the smallest safe fix if the root cause is in repo code.

## Success criteria

- The root cause is supported by code, production log, and/or DB evidence without exposing raw personal identifiers, invite codes, or secrets.
- If a code fix is needed, the join Telegram sync path succeeds when Privy has linked Telegram data that is not immediately present in the initial client user snapshot.
- Required hosted-web tests/typecheck run, or any blocked verification is reported with a concrete unrelated blocker.

## Scope

- In scope:
  - `apps/web` join invite messaging setup and shared Telegram sync components.
  - `apps/web` hosted onboarding/settings Telegram sync route and helpers.
  - Redacted production Vercel logs and DB inspection for the reported failure.
- Out of scope:
  - Broad hosted onboarding redesign.
  - Unrelated dirty hosted web, Cloudflare, assistant, or Health Commons work already present in the checkout.

## Constraints

- Technical constraints:
  - Keep hosted auth/session and Privy identity boundaries intact.
  - Do not persist or log raw Telegram identifiers, emails, invite codes, phone numbers, tokens, or secrets.
  - Preserve unrelated working-tree edits.
- Product/process constraints:
  - Use evidence-first debugging before changing code.
  - Keep user-facing recovery copy neutral and actionable.

## Risks and mitigations

1. Risk: Production debugging could expose high-sensitivity identifiers.
   Mitigation: Query only minimal metadata, redact outputs in notes/handoff, and avoid writing raw production identifiers to repo files.
2. Risk: A client-only workaround could hide a server/session mismatch.
   Mitigation: Check server route behavior, Vercel logs, and DB state before finalizing a UI/client fix.

## Tasks

1. Trace the join Telegram sync call path and its tests.
2. Check Vercel logs for the failed sync/status requests.
3. Inspect production DB state for the reported invite/member/session using redacted identifiers.
4. Implement the smallest fix if code is at fault.
5. Run focused hosted-web verification and update/close this plan.

## Decisions

- Do not record the reported invite code or any raw account identifiers in this plan.
- Production Vercel logs showed the Telegram sync route receiving a request during the relevant window without a server error for that route.
- Production DB metadata for the reported invite/member showed Telegram routing and private Telegram state present after the user refreshed; no hosted runtime logs or mailbox items were present for that member in the checked window.
- Root cause is client sequencing: the Telegram UI treated Privy's `linkTelegram` launcher as an awaitable completion signal, then read `refreshUser` before the linked Telegram account was reliably available. Refreshing worked because the next server render loaded the now-persisted Telegram account and the component's background resync path ran.
- Fix the manual link path to use `useLinkAccount` success/error callbacks and to fall back from stale `refreshUser` data to the Privy success callback user payload before calling `/api/settings/telegram/sync`.

## Verification

- `pnpm --dir apps/web test settings-telegram-settings.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm test:diff apps/web/src/components/settings/hosted-telegram-settings.tsx apps/web/src/components/settings/hosted-telegram-card-settings.tsx apps/web/test/settings-telegram-settings.test.ts` expanded to `apps/web verify`: dependency policy, workspace boundary checks, hosted stale-name guard, raw health log guard, legal PDF generation, Prisma generation, Health Commons generation, dev smoke, lint, and Next build passed.
- The same `apps/web verify` run failed in `apps/web/test/hosted-execution-usage-allowance.test.ts` on two hosted-execution model-pricing assertions. Those files are outside this plan's working set and were not modified by this Telegram fix; treat as an unrelated existing workspace failure.
Completed: 2026-05-06
