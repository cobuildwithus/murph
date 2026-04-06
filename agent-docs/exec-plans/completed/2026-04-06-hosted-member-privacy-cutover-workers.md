# Hosted Member Privacy Cutover Workers

## Goal

Review the live hosted-onboarding schema and service seams, refine the requested privacy-cutover worker split to match the real repo coupling, then launch the first safe parallel batch with `codex-workers`.

## Why this plan exists

- The requested privacy migration is cross-cutting across Prisma schema, hosted onboarding auth, messaging routing, Stripe billing, and privacy-retention surfaces.
- The user explicitly asked for fleshed-out parallel worker prompts plus a `codex-workers` launch.
- The live repo does not support the original Batch 1 split cleanly: additive Prisma models, backfill migration, and the new helper layer all converge on the same owned surface.

## Live-tree findings that drive the split

- `HostedMember` is still the wide row holding phone lookup/hint, Privy identity, wallet identity, billing refs, Linq chat state, and Telegram linkage in `apps/web/prisma/schema.prisma`.
- `HostedSession` does not currently appear in hosted runtime code paths; direct references found during review were limited to Prisma schema relations and Stripe-session revocation tests. Treat runtime removal as proof-required, not assumed.
- Verified email already syncs through hosted execution user env rather than a Postgres account field via `apps/web/app/api/settings/email/sync/route.ts` and `apps/web/src/lib/hosted-execution/control.ts`.
- Revnet remains environment-gated rather than universally enabled; wallet coupling must therefore stay conditional on actual Revnet enablement, not on the mere presence of a wallet field.
- The current worktree is dirty, but the unrelated edits are mostly outside the hosted-onboarding schema/privacy surface. Shared-worktree workers are acceptable if their scopes stay narrow.

## Batch decisions

### Batch 1

- Merge the original schema/migration and repository-helper prompts into one accountable implementation lane.
- Keep a separate proof/docs lane for the architecture note plus the proof-required seams (`HostedSession`, Revnet gating, email boundary).
- Launch Batch 1 now in the shared live worktree.

### Batch 2

- Keep separate auth/onboarding and messaging-routing lanes after Batch 1 lands.
- Keep the email/runtime-boundary lane as a narrow docs/tests guardrail lane because the current architecture already keeps verified email out of Postgres.
- Prepare the prompts now, but do not launch until Batch 1 is reviewed and integrated.

### Batch 3

- Keep Stripe billing cutover separate from the hard cleanup lane.
- Keep the final proof lane test-heavy and late, after the legacy wide-row assumptions have been removed.
- Prepare the prompts now, but do not launch until Batch 2 is reviewed and integrated.

## Shared constraints for every worker

- Treat the prompt as behavioral intent; discover the live tree before editing.
- Preserve unrelated dirty edits.
- Use the current shared worktree unless a concrete collision appears.
- Do not widen the repo further with new helper grab-bags.
- Keep email identity out of Postgres.
- Keep wallet storage/logic conditional on Revnet enablement rather than treating it as unconditional identity state.

## Prompt inventory

- Batch 1 launch now:
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch1-foundation-schema-and-store.md`
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch1-proof-and-docs.md`
- Batch 2 prepared only:
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch2-auth-onboarding.md`
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch2-messaging-routing.md`
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch2-email-runtime-boundary.md`
- Batch 3 prepared only:
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch3-billing-stripe.md`
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch3-cleanup-retention.md`
  - `agent-docs/exec-plans/active/hosted-member-privacy-cutover-prompts/batch3-final-proof.md`

## Launch standard

- Use the installed `codex-workers` helper from the active `CODEX_HOME`.
- Use `--raw-prompts`, `--sandbox workspace-write`, and `--full-auto`.
- Launch only Batch 1 in this turn because later batches depend on integrated earlier diffs.
- Capture the output run directory for later review.

## Outcome

- Batch 1 foundation and proof/docs were launched and integrated from the shared live worktree.
- Batch 2 auth/onboarding, messaging-routing, and email-boundary changes were integrated, with the messaging lane finished by local integration after the worker stalled in close-out.
- Batch 3 billing-ref cutover was completed locally after the worker bootstrap stalled.
- Safe cleanup landed:
  - `HostedSession` removed after direct runtime-proof review.
  - durable routing-side `telegram_username` removed.
- Explicit deferral remains:
  - the full identity-column hard cut on `HostedMember` is still blocked by live readers and should be treated as follow-up work, not silently assumed complete.

Status: completed
Updated: 2026-04-06
