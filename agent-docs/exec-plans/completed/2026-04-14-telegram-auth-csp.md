# Add Telegram auth CSP allowlist for hosted web

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Confirm whether hosted Telegram auth in `apps/web` requires additional CSP sources and add them if the current policy is missing them.

## Success criteria

- `apps/web` CSP includes the Telegram origins required for the Privy Telegram login flow actually used by the homepage and settings surfaces.
- Hosted-web tests cover the added CSP sources.
- Hosted-web operator docs mention the Telegram CSP requirement alongside the existing Privy CSP notes.
- Required verification and completion-workflow audits pass, or any unrelated blocker is documented.

## Scope

- In scope:
- `apps/web/next.config.ts`
- `apps/web/test/next-config.test.ts`
- `apps/web/README.md`
- `agent-docs/exec-plans/active/**`
- Out of scope:
- Telegram webhook or routing backend behavior
- Broader Privy or onboarding refactors
- Non-`apps/web` CSP handling

## Constraints

- Technical constraints:
- Keep the change limited to the hosted-web CSP owner and matching tests/docs.
- Preserve the existing Privy and Turnstile CSP behavior.
- Product/process constraints:
- Do not widen unrelated CSP directives beyond the documented Telegram requirement.
- Do not disturb other active worktree changes.

## Risks and mitigations

1. Risk: widening the CSP more than necessary.
   Mitigation: add only the exact Telegram origins documented for the Privy Telegram widget flow.
2. Risk: the hosted-web docs drift from the actual CSP behavior.
   Mitigation: update `apps/web/README.md` in the same change.
3. Risk: missing regression coverage on the central header builder.
   Mitigation: extend the existing `next-config` CSP test instead of adding a separate ad hoc check.

## Tasks

1. Confirm the Telegram auth implementation and vendor CSP requirement.
2. Add the missing Telegram sources to the hosted-web CSP builder.
3. Update hosted-web CSP tests and operator docs.
4. Run the required hosted-web verification and completion audits.
5. Commit only the touched paths with the closed plan artifact.

## Decisions

- Treat this as a hosted-web auth/trust-boundary change because it affects the browser CSP protecting Privy Telegram auth.
- Use the exact Privy-documented Telegram CSP origins instead of adding broader wildcard sources.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- apps/web/test/next-config.test.ts`
- `pnpm exec tsx --eval "import { buildHostedWebContentSecurityPolicy } from './apps/web/next.config.ts'; ..."`
- `pnpm verify:acceptance`
- Required completion-workflow audit passes: `coverage-write` and `task-finish-review`
- Expected outcomes:
- Hosted-web CSP tests cover the Telegram sources and the app-level verify lane passes.
- Results:
- `pnpm --dir apps/web test -- apps/web/test/next-config.test.ts` passed.
- The direct production-CSP check passed and confirmed both Telegram origins are present in the generated header.
- `pnpm verify:acceptance` failed for a pre-existing unrelated `apps/web` typecheck error in `apps/web/test/hosted-onboarding-privy-service.test.ts:79`, outside this change's touched files.
Completed: 2026-04-14
