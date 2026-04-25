# Hosted First-Contact Inbound Gate

## Goal

Prevent hosted signup first-contact welcomes from opening a new Linq/iMessage conversation to an arbitrary phone-only contact. For now, first-contact delivery over the Linq phone channel should require an existing inbound conversation chat signal; otherwise activation can proceed without queuing that welcome.

## Scope

- Hosted onboarding activation route selection in `apps/web/src/lib/hosted-onboarding/**`.
- Focused hosted onboarding tests that prove the phone/Linq welcome is skipped without inbound chat state and still delivered when an inbound chat exists.
- No schema changes unless the current code lacks an existing inbound-chat signal.

## Constraints

- Do not log or fixture real phone numbers, chat ids, member ids, or message text from production.
- Preserve unrelated dirty work and active hosted Linq/Cloudflare rows.
- Keep Telegram activation welcomes intact unless the traced code proves they share the unsafe phone-only behavior.
- Do not widen into assistant prompt wording or outbound delivery implementation unless the activation gate cannot safely own the behavior.

## Verification

- Focused hosted onboarding activation/Linq route tests.
- `pnpm --dir apps/web lint` if apps/web production code changes.
- `pnpm typecheck` or scoped verification with named unrelated blockers if the dirty tree prevents the full lane.
- Required completion audits for contact identifiers and hosted external messaging.

## State

- Done: traced first-contact signup replies to the Linq inbound webhook path and activation welcome participant routing.
- Done: gated unknown/inactive first-contact signup replies to parsed inbound iMessage service only.
- Done: prevented activation welcome routing from materializing a new Linq participant thread when only a home line is assigned.
- Done: focused hosted-onboarding regression tests, apps/web lint, workspace typecheck, scoped diff whitespace check, and diff-scoped app verification passed.
- Done: required coverage, security/privacy, and task-finish audits completed; coverage gaps were addressed with additional inactive non-iMessage and active RCS/SMS tests.
- Now: closing the active plan while preserving unrelated dirty ledger work.
- Next: hand off the scoped change and verification summary.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
